import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openLedger } from '../src/index.js';
import { parsePairs } from '../src/audit.js';
import { temp, env, model, cli } from './helpers.js';

const left = 'L-0123456789', right = 'L-abcdef0123', old = 'L-0000000000';
const entries = [{ id: left, status: 'active' }, { id: right, status: 'contested' }, { id: old, status: 'superseded' }];
const pair = `PAIR: ${left} ${right} | The bakery orders cannot both be paused and resumed.`;

test('semantic pairs accept exact NONE or eligible pairs with reasons', () => {
  assert.deepEqual(parsePairs('NONE\n', entries), []);
  assert.deepEqual(parsePairs(pair + '\r\n', entries), [{ ids: [left, right], reason: 'The bakery orders cannot both be paused and resumed.' }]);
});
for (const output of ['', 'none', 'VERDICT: GO', `NONE\n${pair}`, `${pair}\nNONE`, `Here are the pairs:\n${pair}`,
  `\x60\x60\x60text\n${pair}\n\x60\x60\x60`, `PAIR: ${left} ${right} | `, `PAIR: ${left} ${right} | reason\nextra`,
  `PAIR: ${left} ${left} | same`, `PAIR: ${left} L-ffffffffff | unknown`, `PAIR: ${left} ${old} | replaced`,
  `PAIR: ${left}suffix ${right} | invalid`, `${pair}\nPAIR: ${right} ${left} | repeated`, `${pair}\n\n${pair}`]) {
  test(`semantic audit rejects invalid response ${JSON.stringify(output)}`, () => {
    assert.throws(() => parsePairs(output, entries));
  });
}
test('semantic audit rejects direct and transitive supersession, including cycles', () => {
  assert.throws(() => parsePairs(pair, [{ ...entries[0], supersedes: right }, entries[1]]), /supersede/);
  assert.throws(() => parsePairs(pair, [{ ...entries[0], supersedes: old }, entries[1], { ...entries[2], supersedes: right }]), /supersede/);
  assert.throws(() => parsePairs(pair, [{ ...entries[0], superseded_by: old }, entries[1], { ...entries[2], superseded_by: right }]), /supersede/);
  const cycle = [{ ...entries[0], supersedes: old }, entries[1], { ...entries[2], supersedes: left }];
  assert.equal(parsePairs(pair, cycle).length, 1, 'unrelated cycle terminates without hiding a valid pair');
});
test('ordinary audit remains synchronous and does not invoke a configured model', (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('flaky'), RETRY_COUNTER: counter }) });
  ledger.init();
  const report = ledger.audit();
  assert.equal(report.total, 0);
  assert.equal(report.then, undefined);
  assert.equal(Object.hasOwn(report, 'contradictions'), false);
  assert.equal(fs.existsSync(counter), false);
});
test('semantic audit finds reworded reversals through the model contract without writes', async (t) => {
  const file = temp(t), ledger = openLedger({ file });
  const paused = ledger.add({ claim: 'Wholesale orders are paused.' }).entry;
  const resumed = ledger.add({ claim: 'Resume wholesale orders from Monday.' }).entry;
  assert.ok(ledger.list().every((entry) => entry.status === 'active'), 'lexical clash detection stays conservative');
  const before = fs.readFileSync(file, 'utf8');
  const expected = `PAIR: ${paused.id} ${resumed.id} | Orders are both paused and resumed.`;
  const auditor = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('audit'), AUDIT_OUTPUT: expected, EXPECT_IDS: `${paused.id},${resumed.id}`, LEDGER_LOG_CHECKS: '1' }) });
  const pending = auditor.audit({ model: true });
  assert.ok(pending instanceof Promise);
  const report = await pending;
  assert.equal(report.error, null);
  assert.deepEqual(report.contradictions, [{ ids: [paused.id, resumed.id].sort(), reason: 'Orders are both paused and resumed.' }]);
  assert.equal(report.attempts, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(path.dirname(file), 'checks.jsonl')), false);
  const clean = await openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('audit'), AUDIT_OUTPUT: 'NONE' }) }).audit({ model: true });
  assert.equal(clean.error, null);
  assert.deepEqual(clean.contradictions, []);
});
test('semantic audit reports missing commands and command failures explicitly', async (t) => {
  const file = temp(t), ledger = openLedger({ file, env: env() });
  ledger.init();
  for (const [mode, expected] of [['', /No model/], ['stderr-fail', /oven offline/], ['timeout', /timed out/], ['large', /exceeded 1 MiB/], ['large-stderr', /stderr exceeded 1 MiB/], ['go', /expected PAIR/]]) {
    const report = await ledger.audit({ model: true, modelCmd: mode ? model(mode) : '', timeoutMs: mode === 'timeout' ? 150 : 5000 });
    assert.match(report.error, expected);
    assert.deepEqual(report.contradictions, []);
    assert.equal(fs.readFileSync(file, 'utf8'), '');
  }
  for (const options of [{ modelRetries: '' }, { timeoutMs: 0 }]) {
    const report = await ledger.audit({ model: true, modelCmd: model('audit'), ...options });
    assert.match(report.error, /Invalid/);
    assert.equal(report.attempts, 0);
  }
});
test('semantic audit uses bounded retries but never retries malformed pairs', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('retry-output'), RETRY_COUNTER: counter, RETRY_OUTPUT: 'NONE' }) });
  ledger.init();
  const report = await ledger.audit({ model: true, modelRetries: 1 });
  assert.equal(report.error, null);
  assert.deepEqual(report.contradictions, []);
  assert.equal(report.attempts, 2);
  const malformed = await ledger.audit({ model: true, modelCmd: model('junk'), modelRetries: 3 });
  assert.match(malformed.error, /expected PAIR/);
  assert.equal(malformed.attempts, 1);
});
test('CLI semantic audit reports pairs, NONE and errors in text and JSON', (t) => {
  const file = temp(t), ledger = openLedger({ file });
  const first = ledger.add({ claim: 'Wholesale orders are paused.' }).entry;
  const second = ledger.add({ claim: 'Resume wholesale orders from Monday.' }).entry;
  const common = ['audit', '--model', '--file', file, '--model-cmd', model('audit')];
  const response = `PAIR: ${first.id} ${second.id} | Orders conflict.`;
  const before = fs.readFileSync(file, 'utf8');
  for (const json of [false, true]) {
    for (const [output, status] of [[response, 0], ['NONE', 0], [`${response}\nPAIR: ${first.id} L-0000000000 | Unknown`, 3], ['VERDICT: GO', 3]]) {
      const result = cli([...common, ...(json ? ['--json'] : [])], { LEDGER_MODEL_CMD: model('fail'), AUDIT_OUTPUT: output });
      assert.equal(result.status, status, result.stderr);
      assert.equal(result.stderr, '');
      if (json) {
        const { data } = JSON.parse(result.stdout);
        assert.equal(Boolean(data.error), status === 3);
        assert.equal(data.contradictions.length, output === response ? 1 : 0);
      } else {
        assert.match(result.stdout, status === 3 ? /Audit error:/ : /Semantic contradictions/);
        if (status === 3) assert.doesNotMatch(result.stdout, /Semantic contradictions \(0\)/);
      }
    }
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(cli(['audit', '--file', file, '--model-cmd', model('audit')]).status, 1);
  assert.equal(cli(['audit', '--file', file, '--model']).status, 3);
});
test('model audit requires an existing ledger and help documents its contract', (t) => {
  const file = temp(t), ledger = openLedger({ file, env: env() });
  assert.throws(() => ledger.audit({ model: true }), /ledger not found/);
  assert.equal(cli(['audit', '--model', '--file', file]).status, 1);
  assert.equal(fs.existsSync(file), false);
  const help = cli(['audit', '--help']);
  for (const pattern of [/--model/, /PAIR:/, /NONE/, /audit --model: 0/, /2 shared/, /--as-of/, /LEDGER_MODEL_RETRIES/, /Asking humans for approval/]) assert.match(help.stdout, pattern);
});
