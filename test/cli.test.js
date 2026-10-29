import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openLedger } from '../src/index.js';
import { temp, cli, model, root, runNode } from './helpers.js';

function success(args, environment) {
  const result = cli([...args, '--json'], environment);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.ok, true); return parsed.data;
}
test('CLI end-to-end init, rule, UNKNOWN, GO, STOP, list, show, audit, path', (t) => {
  const file = temp(t), common = ['--file', file];
  assert.equal(success(['init', ...common]).created, true);
  const rule = success(['add', 'Publishing requires approval.', '--scope', 'rules', '--kind', 'rule', '--agent', 'worker', '--evidence', 'Recorded policy', ...common]).entry;
  assert.equal(rule.kind, 'rule'); assert.equal(rule.evidence.length, 1);
  const unknown = cli(['check', 'Publish a report', ...common, '--json']);
  assert.equal(unknown.status, 3); assert.equal(JSON.parse(unknown.stdout).data.standingRules[0].id, rule.id);
  const go = success(['check', 'Read a report', '--agent', 'worker-3', ...common], { LEDGER_MODEL_CMD: model('go') });
  assert.equal(go.verdict, 'GO'); assert.equal(go.agent, 'worker-3'); assert.equal(go.standingRules[0].id, rule.id);
  const stop = cli(['check', 'Publish a report', ...common, '--json'], { LEDGER_MODEL_CMD: model('stop') });
  assert.equal(stop.status, 2); assert.equal(JSON.parse(stop.stdout).data.verdict, 'STOP');
  assert.equal(success(['list', ...common]).entries.length, 1);
  assert.equal(success(['show', rule.id, ...common]).entry.id, rule.id);
  assert.equal(success(['audit', ...common]).total, 1);
  assert.equal(success(['path', ...common]).file, file);
  assert.equal(success(['contest', rule.id, '--note', 'Needs review', ...common]).entry.status, 'contested');
  assert.equal(success(['resolve', rule.id, '--note', 'Confirmed', ...common]).entry.status, 'active');
  const next = success(['supersede', rule.id, 'Private drafts may be edited.', ...common]).entry;
  assert.equal(next.supersedes, rule.id);
});
test('CLI --model-cmd overrides the environment and supports shell composition', (t) => {
  const file = temp(t); success(['init', '--file', file]);
  const result = cli(['check', 'Read a report', '--file', file, '--model-cmd', model('go') + ' && :', '--json'], { LEDGER_MODEL_CMD: model('stop') });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.verdict, 'GO');
});
test('CLI missing ledger is a storage error with and without a model, in text and JSON', (t) => {
  const file = temp(t), message = `ledger not found at ${file}; run init or set LEDGER_FILE`;
  for (const command of ['', model('go')]) {
    for (const json of [false, true]) {
      const result = cli(['check', 'Read a report', ...(json ? ['--json'] : [])], { LEDGER_FILE: file, LEDGER_MODEL_CMD: command });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      if (json) {
        const error = JSON.parse(result.stderr);
        assert.equal(error.ok, false);
        assert.deepEqual(error.error, { message, code: 1 });
      } else assert.ok(result.stderr.startsWith(`Error: ${message}\n`), result.stderr);
      assert.equal(fs.existsSync(file), false);
    }
  }
});
test('contradicting add preserves contested standing rules in UNKNOWN and model input', (t) => {
  const file = temp(t), common = ['--file', file];
  const rule = success(['add', 'Publishing reports is not allowed', '--scope', 'rules', ...common]).entry;
  const clash = cli(['add', 'Publishing reports is allowed', ...common, '--json']);
  assert.equal(clash.status, 2, clash.stderr);
  const contradictory = JSON.parse(clash.stdout).data.entry;
  const entries = success(['list', ...common]).entries;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.status === 'contested'));
  // An unrelated action ensures the rule is visible independently of lexical hints.
  const unknown = cli(['check', 'Inspect invoices', ...common, '--json']);
  assert.equal(unknown.status, 3, unknown.stderr);
  const data = JSON.parse(unknown.stdout).data;
  assert.equal(data.verdict, 'UNKNOWN');
  assert.deepEqual(data.standingRules, [entries.find((entry) => entry.id === rule.id)]);
  assert.equal(data.matches.length, 0);
  const text = cli(['check', 'Inspect invoices', ...common]);
  assert.equal(text.status, 3);
  assert.ok(text.stdout.includes(`${rule.id} CONTESTED rules  ${rule.claim}`));
  assert.match(text.stdout, /Standing rules \(ACTIVE or CONTESTED; 1\):/);
  const stop = cli(['check', 'Publish reports', ...common, '--json'], {
    LEDGER_MODEL_CMD: model('contested'), EXPECT_IDS: `${rule.id},${contradictory.id}`,
  });
  assert.equal(stop.status, 2, stop.stderr || stop.stdout);
  assert.equal(JSON.parse(stop.stdout).data.verdict, 'STOP');
});
test('CLI model failure and timeout return UNKNOWN/3 with standing rules', (t) => {
  const file = temp(t); openLedger({ file }).add({ claim: 'Permission is required.', scope: 'rules' });
  for (const mode of ['fail', 'timeout', 'ambiguous']) {
    const result = cli(['check', 'Read a file', '--file', file, '--json'], { LEDGER_MODEL_CMD: model(mode), LEDGER_MODEL_TIMEOUT_MS: mode === 'timeout' ? '150' : '5000' });
    assert.equal(result.status, 3, result.stderr); assert.equal(JSON.parse(result.stdout).data.standingRules.length, 1);
  }
});
test('CLI deterministic clash exits 2; explicit force remains active', (t) => {
  const file = temp(t);
  success(['add', 'The batch limit is 10 items.', '--file', file]);
  const conflict = cli(['add', 'The batch limit is 12 items.', '--file', file, '--json']);
  assert.equal(conflict.status, 2); assert.equal(JSON.parse(conflict.stdout).data.entry.status, 'contested');
  assert.equal(success(['add', 'The batch limit is 15 items.', '--force', '--file', file]).entry.status, 'active');
});
test('human output shows readable claims and scopes while JSON preserves their text', (t) => {
  const file = temp(t), common = ['--file', file];
  const claim = 'Never deploy\non Fridays', scope = 'release\nrules';
  const added = cli(['add', claim, '--scope', scope, ...common]);
  assert.equal(added.status, 0);
  const entry = openLedger({ file }).list()[0];
  const expected = `${entry.id} ACTIVE release rules  Never deploy on Fridays`;
  assert.equal(added.stdout.trim(), expected);
  for (const args of [['list'], ['show', entry.id], ['audit', '--stale-days', '0'], ['check', 'Deploy Friday']]) {
    const result = cli([...args, ...common]);
    assert.ok(result.stdout.includes(expected), result.stdout);
    assert.doesNotMatch(result.stdout, /Never deploy\\n|"release/);
  }
  assert.equal(success(['show', entry.id, ...common]).entry.claim, claim);
  assert.equal(success(['show', entry.id, ...common]).entry.scope, scope);
  for (const command of ['contest', 'resolve']) {
    const result = cli([command, entry.id, '--note', 'Reviewed', ...common]);
    assert.match(result.stdout, /release rules  Never deploy on Fridays/);
  }
  const replacement = cli(['supersede', entry.id, 'Deploy\non Mondays', '--scope', scope, ...common]);
  assert.match(replacement.stdout, /release rules  Deploy on Mondays/);
});
test('CLI invalid timeout exits 3 and JSON rules and matches share entry fields', (t) => {
  const file = temp(t);
  const entry = success(['add', 'Never deploy on Fridays', '--scope', 'rules', '--file', file]).entry;
  for (const timeout of ['', 'NaN', '0', '-1', '1.5', '2147483648']) {
    const result = cli(['check', 'Friday deployment', '--file', file, '--json'], {
      LEDGER_MODEL_CMD: model('go'), LEDGER_MODEL_TIMEOUT_MS: timeout,
    });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, '');
    const { ok, data } = JSON.parse(result.stdout);
    assert.equal(ok, true);
    assert.equal(data.verdict, 'UNKNOWN');
    assert.match(data.reason, /Invalid model timeout.*LEDGER_MODEL_TIMEOUT_MS/);
    const { similarity, ...match } = data.matches[0];
    assert.equal(similarity, 1);
    assert.deepEqual(match, entry);
    assert.deepEqual(data.standingRules[0], entry);
  }
});
for (const args of [
  ['unknown'], ['list', '--unknown'], ['check'], ['check', ''], ['add'], ['add', ' '],
  ['add', 'claim', '--kind', 'invalid'], ['list', '--status', 'invalid'], ['list', '--agent', 'worker'],
  ['show'], ['show', 'L-0000000000'], ['init', 'extra'], ['add', 'claim', '--scope'],
  ['list', '--json=true'], ['list', '--file', '--json'], ['list', '--json', '--json'],
  ['list', '--force'], ['audit', '--stale-days', 'NaN'], ['contest', 'L-0000000000'],
]) {
  test(`CLI rejects invalid input ${JSON.stringify(args)}`, (t) => {
    const result = cli([...args, '--file', temp(t), ...(args.includes('--json') ? [] : ['--json'])]);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    const parsed = JSON.parse(result.stderr); assert.equal(parsed.ok, false); assert.ok(parsed.error.message); assert.match(parsed.usage, /Usage:/);
  });
}
test('CLI validates every loaded line and reports line numbers to stderr', (t) => {
  const file = temp(t); fs.writeFileSync(file, '\n{}\n');
  const result = cli(['check', 'Read a file', '--file', file, '--json'], { LEDGER_MODEL_CMD: model('go') });
  assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error.message, /:2:/);
});
test('help, version, global flags, equals values, and literal claims', (t) => {
  assert.match(cli(['-h']).stdout, /Model contract:/);
  assert.equal(success(['--version']).version, '0.1.0');
  const file = temp(t);
  const result = cli(['--json', `--file=${file}`, 'add', '--', '--this is literal data']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.entry.claim, '--this is literal data');
  assert.match(cli(['--help', '--json']).stdout, /"command":"help"/);
});
test('eval runner covers all frozen cases and writes separate results', () => {
  const resultsDir = path.join(root, 'eval/results');
  const before = fs.existsSync(resultsDir) ? new Set(fs.readdirSync(resultsDir)) : new Set();
  const result = runNode(['eval/run.mjs'], { LEDGER_LOG_CHECKS: '1' });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stdout, /Stopped\s+0\/28/); assert.match(result.stdout, /False blocks\s+0\/14/); assert.match(result.stdout, /Unknown\s+42/);
  const created = fs.readdirSync(resultsDir).filter((name) => !before.has(name));
  assert.equal(created.length, 1);
  const report = JSON.parse(fs.readFileSync(path.join(resultsDir, created[0]), 'utf8'));
  assert.equal(report.results.length, 42); assert.equal(report.summary.unknown, 42);
  for (const item of report.results) assert.equal(fs.existsSync(path.join(root, 'eval/bakery-42/cases', item.id, 'checks.jsonl')), false);
  fs.unlinkSync(path.join(resultsDir, created[0]));
});
