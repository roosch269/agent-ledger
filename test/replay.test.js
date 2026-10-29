import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openLedger } from '../src/index.js';
import { load, newEntry } from '../src/ledger.js';
import { citations } from '../src/check.js';
import { todayString } from '../src/decide.js';
import { temp, env, model, cli } from './helpers.js';

const T0 = '2026-01-01T00:00:00.000Z', T1 = '2026-02-01T00:00:00.000Z', T2 = '2026-03-01T00:00:00.000Z';
const MID01 = '2026-01-15T00:00:00.000Z', MID12 = '2026-02-15T00:00:00.000Z';

// Fix 1: keep the model's error tail, optional retry.
test('a failed model keeps its stderr tail in the UNKNOWN reason and stderrTail field', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('stderr-fail') }) });
  ledger.init();
  const result = await ledger.check('Bake a loaf.');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.attempts, 1);
  assert.match(result.reason, /exit 1/);
  assert.match(result.reason, /rate limited/);
  assert.match(result.stderrTail, /oven offline: rate limited/);
});
test('a flaky model that succeeds on the second attempt returns GO with retries=1', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('flaky'), RETRY_COUNTER: counter, RETRY_SUCCEED_AT: '2', LEDGER_MODEL_RETRIES: '1' }) });
  ledger.init();
  const result = await ledger.check('Bake a loaf.');
  assert.equal(result.verdict, 'GO', result.reason);
  assert.equal(result.attempts, 2);
  assert.equal(Number(fs.readFileSync(counter, 'utf8')), 2);
});
test('exhausted retries return UNKNOWN reporting attempts used and the last stderr tail', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('flaky'), RETRY_COUNTER: counter, RETRY_SUCCEED_AT: '99' }) });
  ledger.init();
  const result = await ledger.check('Bake a loaf.', { modelRetries: 1 });
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /exit 1/);
  assert.match(result.reason, /after 2 attempts/);
  assert.match(result.reason, /warming up/);
  assert.equal(Number(fs.readFileSync(counter, 'utf8')), 2);
});
test('a parse failure is never retried, even with retries available', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('junk'), LEDGER_MODEL_RETRIES: '3' }) });
  ledger.init();
  const result = await ledger.check('Bake a loaf.');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.attempts, 1);
});
test('an invalid retry count is UNKNOWN without invoking the command', async (t) => {
  const file = temp(t), marker = path.join(path.dirname(file), 'called');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: `touch '${marker}'` }) });
  ledger.add({ claim: 'Loaves cool for 10 minutes.', scope: 'rules' });
  for (const retries of ['4', '-1', '1.5', 'oops', '', ' ', true, false, [], Symbol('retry'), {}, '0x1', '1e0']) {
    const result = await ledger.check('Slice a loaf.', { modelRetries: retries });
    assert.equal(result.verdict, 'UNKNOWN');
    assert.match(result.reason, /LEDGER_MODEL_RETRIES.*integer from 0 to 3/);
    assert.equal(result.attempts, 0);
    assert.equal(result.standingRules.length, 1);
  }
  assert.equal(fs.existsSync(marker), false);
});

// Fix 2: validate cited ids.
test('citations split WHY ids into those present and absent from the check', () => {
  const entries = [{ id: 'L-0123456789' }, { id: 'L-abcdef0123' }];
  const { cited, unknownCitations } = citations('Allowed per L-0123456789 and L-ffffffffff; see L-0123456789.', entries);
  assert.deepEqual(cited, ['L-0123456789']);
  assert.deepEqual(unknownCitations, ['L-ffffffffff']);
});
test('a GO citing only unknown ids is downgraded to UNKNOWN', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('cite'), CITE_VERDICT: 'GO', CITE_IDS: 'L-0000000000' }) });
  ledger.add({ claim: 'Deliveries leave at noon.', scope: 'rules' });
  const result = await ledger.check('Send a delivery.');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.reason, /absent from this check/);
  assert.deepEqual(result.cited, []);
  assert.deepEqual(result.unknownCitations, ['L-0000000000']);
});
test('a GO citing a mix of known and unknown ids stays GO', async (t) => {
  const file = temp(t), ledger = openLedger({ file, env: env() });
  const rule = ledger.add({ claim: 'Deliveries leave at noon.', scope: 'rules' }).entry;
  const cited = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('cite'), CITE_VERDICT: 'GO', CITE_IDS: `${rule.id}, L-0000000000` }) });
  const result = await cited.check('Send a delivery.');
  assert.equal(result.verdict, 'GO', result.reason);
  assert.deepEqual(result.cited, [rule.id]);
  assert.deepEqual(result.unknownCitations, ['L-0000000000']);
});
test('a STOP citing an unknown id stays STOP and still warns', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('cite'), CITE_VERDICT: 'STOP', CITE_IDS: 'L-0000000000' }) });
  ledger.add({ claim: 'Deliveries leave at noon.', scope: 'rules' });
  const result = await ledger.check('Send a delivery.');
  assert.equal(result.verdict, 'STOP');
  assert.deepEqual(result.unknownCitations, ['L-0000000000']);
});
test('CLI warns about unknown citations on stderr in text mode and as a field in JSON', (t) => {
  const file = temp(t);
  openLedger({ file }).add({ claim: 'Deliveries leave at noon.', scope: 'rules' });
  const common = ['check', 'Send a delivery.', '--file', file];
  const overrides = { LEDGER_MODEL_CMD: model('cite'), CITE_VERDICT: 'STOP', CITE_IDS: 'L-0000000000' };
  const text = cli(common, overrides);
  assert.equal(text.status, 2);
  assert.match(text.stderr, /Warning: model cited unknown ledger id\(s\): L-0000000000/);
  const json = cli([...common, '--json'], overrides);
  assert.equal(json.status, 2);
  assert.equal(json.stderr, '');
  assert.deepEqual(JSON.parse(json.stdout).data.unknownCitations, ['L-0000000000']);
});

// Fix 3: status-change times and as-of queries.
test('new entries record updated_at equal to ts; changes stamp the change time', (t) => {
  const file = temp(t), ledger = openLedger({ file });
  const first = ledger.add({ claim: 'The batch limit is 10 loaves.', ts: T0 }).entry;
  assert.equal(first.updated_at, T0);
  const before = Date.now();
  const next = ledger.supersede(first.id, 'The batch limit is 12 loaves.', { ts: T1 }).entry;
  assert.equal(next.updated_at, T1);
  assert.ok(Date.parse(ledger.get(first.id).updated_at) >= before);
  assert.ok(Date.parse(ledger.get(first.id).updated_at) <= Date.now());
  const contested = ledger.contest(next.id, { note: 'Under review.' });
  assert.ok(Number.isFinite(Date.parse(contested.updated_at)));
  assert.notEqual(contested.updated_at, T1);
});
test('as-of hides entries created later', (t) => {
  const file = temp(t), ledger = openLedger({ file });
  ledger.add({ claim: 'Morning loaf is sourdough.', ts: T0 });
  ledger.add({ claim: 'Afternoon loaf is rye.', ts: T2 }, { force: true });
  assert.equal(ledger.list({ asOf: MID12 }).length, 1);
  assert.equal(ledger.list({ asOf: MID12 })[0].claim, 'Morning loaf is sourdough.');
  assert.equal(ledger.list().length, 2);
});
test('as-of shows an entry ACTIVE before it was superseded and SUPERSEDED after', (t) => {
  const file = temp(t), ledger = openLedger({ file });
  const old = newEntry({ claim: 'The batch limit is 10 loaves.', ts: T0 });
  const next = newEntry({ claim: 'The batch limit is 12 loaves.', ts: T1, supersedes: old.id });
  writeSnapshots(file, [old, { ...old, status: 'superseded', superseded_by: next.id, updated_at: T1 }, next]);

  const before = ledger.list({ asOf: MID01 });
  assert.deepEqual(before.map((e) => e.id), [old.id]);
  assert.equal(before[0].status, 'active');

  const after = ledger.list({ asOf: MID12 });
  assert.equal(after.find((e) => e.id === old.id).status, 'superseded');
  assert.equal(after.find((e) => e.id === next.id).status, 'active');
});
test('as-of tolerates legacy snapshots that lack updated_at', (t) => {
  const file = temp(t);
  const legacy = [
    { id: 'L-aaaaaaaaaa', claim: 'Bakery closes at 5pm.', scope: 'rules', source_agent: 'baker', source_ref: null, ts: T0, status: 'active', supersedes: null, evidence: [] },
    { id: 'L-aaaaaaaaaa', claim: 'Bakery closes at 5pm.', scope: 'rules', source_agent: 'baker', source_ref: null, ts: T0, status: 'superseded', superseded_by: 'L-bbbbbbbbbb', supersedes: null, evidence: [] },
    { id: 'L-bbbbbbbbbb', claim: 'Bakery closes at 6pm.', scope: 'rules', source_agent: 'baker', source_ref: null, ts: T1, status: 'active', supersedes: 'L-aaaaaaaaaa', evidence: [] },
  ];
  fs.writeFileSync(file, legacy.map((e) => JSON.stringify(e)).join('\n') + '\n');
  assert.ok(load(file).every((e) => e.updated_at === undefined));

  const before = load(file, { asOf: MID01 });
  assert.deepEqual(before.map((e) => e.id), ['L-aaaaaaaaaa']);
  assert.equal(before[0].status, 'active', 'legacy supersede dated by its successor ts');

  const after = load(file, { asOf: MID12 });
  assert.equal(after.find((e) => e.id === 'L-aaaaaaaaaa').status, 'superseded');
  assert.equal(after.find((e) => e.id === 'L-bbbbbbbbbb').status, 'active');
});
test('check --as-of reconstructs the ledger and uses that instant as today', async (t) => {
  const file = temp(t), ledger = openLedger({ file, env: env() });
  const early = ledger.add({ claim: 'Loaves cool for 10 minutes.', scope: 'rules', ts: T0 }).entry;
  ledger.add({ claim: 'Deliveries leave at noon.', scope: 'rules', ts: T2 }, { force: true });
  const asOf = MID01;
  const checker = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('today'), EXPECT_TODAY: todayString(new Date(asOf), 'UTC') }) });
  const result = await checker.check('Slice a loaf.', { asOf });
  // The later rule is invisible; only the early rule stands, and the prompt date matched (GO).
  assert.equal(result.verdict, 'GO', result.reason);
  assert.deepEqual(result.standingRules.map((r) => r.id), [early.id]);
});
test('an unparseable --as-of date is rejected', (t) => {
  const file = temp(t);
  openLedger({ file }).add({ claim: 'Loaves cool for 10 minutes.' });
  assert.throws(() => openLedger({ file }).list({ asOf: 'not-a-date' }), /invalid as-of date/);
  const result = cli(['list', '--file', file, '--as-of', 'not-a-date', '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).error.message, /invalid as-of date/);
});


function writeSnapshots(file, snapshots) {
  fs.writeFileSync(file, snapshots.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}
test('oversized output on a nonzero exit is never retried into GO', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('retry-output'), RETRY_COUNTER: counter, RETRY_FAILURE: 'large', LEDGER_MODEL_RETRIES: '3' }) });
  ledger.init();
  const result = await ledger.check('Bake bread');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.reason, /exceeded 1 MiB/);
  assert.equal(result.attempts, 1);
  assert.equal(fs.readFileSync(counter, 'utf8'), '1');
});
test('timeout retries are bounded and can recover with a clean GO', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('retry-output'), RETRY_COUNTER: counter, RETRY_FAILURE: 'timeout' }) });
  ledger.init();
  const result = await ledger.check('Bake bread', { timeoutMs: 500, modelRetries: 1 });
  assert.equal(result.verdict, 'GO', result.reason);
  assert.equal(result.attempts, 2);
  const exhausted = await ledger.check('Bake bread', { modelCmd: model('timeout'), timeoutMs: 150, modelRetries: 1 });
  assert.equal(exhausted.verdict, 'UNKNOWN');
  assert.equal(exhausted.attempts, 2);
  assert.match(exhausted.reason, /after 2 attempts/);
});
test('parse failure after a retry keeps stderr and attempt diagnostics without another retry', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('retry-output'), RETRY_COUNTER: counter, RETRY_OUTPUT: 'oven ready', LEDGER_MODEL_RETRIES: '3' }) });
  ledger.init();
  const result = await ledger.check('Bake bread');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /after 2 attempts.*oven diagnostic/);
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
});
test('stderr diagnostics retain only a bounded, sanitised tail', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('stderr-tail') }) });
  ledger.init();
  const result = await ledger.check('Bake bread');
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.stderrTail, /^…/);
  assert.match(result.reason, /oven offline/);
  assert.doesNotMatch(result.stderrTail, /prefix|[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(Buffer.byteLength(result.stderrTail) <= 2051);
});
test('citation tokens are case-insensitive and deduplicated, with identifier boundaries', () => {
  const entries = [{ id: 'L-abcdef0123' }];
  const parsed = citations('l-ABCDEF0123, L-abcdef0123. XL-abcdef0123 L-abcdef0123suffix L-abcdef0123a', entries);
  assert.deepEqual(parsed, { cited: ['L-abcdef0123'], unknownCitations: [] });
});
test('a known ID prefix inside another identifier cannot mask an unknown GO citation', async (t) => {
  const file = temp(t), ledger = openLedger({ file, env: env() });
  const entry = ledger.add({ claim: 'Loaves cool before slicing.' }).entry;
  const checker = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('cite'), CITE_IDS: `${entry.id}suffix L-0000000000` }) });
  assert.equal((await checker.check('Slice bread')).verdict, 'UNKNOWN');
});
test('legacy initial evidence cannot hide an existing entry in historical checks', (t) => {
  const file = temp(t), entry = newEntry({ claim: 'Cool loaves before slicing.', ts: T0, evidence: [{ ts: T2, note: 'Next review' }] });
  delete entry.updated_at;
  writeSnapshots(file, [entry]);
  assert.deepEqual(load(file, { asOf: MID01 }), [entry]);
});
test('legacy contest and resolve evidence dates reconstruct each state', (t) => {
  const file = temp(t), entry = newEntry({ claim: 'Cool loaves before slicing.', ts: T0 });
  delete entry.updated_at;
  const contested = { ...entry, status: 'contested', evidence: [{ ts: T1, note: 'Under review' }] };
  const resolved = { ...entry, evidence: [...contested.evidence, { ts: T2, note: 'Confirmed' }] };
  writeSnapshots(file, [entry, contested, resolved]);
  assert.deepEqual(load(file, { asOf: MID01 }), [entry]);
  assert.deepEqual(load(file, { asOf: T1 }), [contested]);
  assert.deepEqual(load(file, { asOf: MID12 }), [contested]);
  assert.deepEqual(load(file, { asOf: T2 }), [resolved]);
});
test('replay preserves append order when a writer clock moves backwards', (t) => {
  const file = temp(t), entry = newEntry({ claim: 'Cool loaves before slicing.', ts: T0 });
  const contested = { ...entry, status: 'contested', updated_at: T2 };
  const resolved = { ...entry, updated_at: T1 };
  writeSnapshots(file, [entry, contested, resolved]);
  assert.deepEqual(load(file, { asOf: T2 }), load(file));
  assert.deepEqual(load(file, { asOf: T2 }), [resolved]);
});
test('backdated adds cannot retroactively supersede or contest existing entries', (t) => {
  const ledger = openLedger({ file: temp(t) });
  const old = ledger.add({ claim: 'The batch limit is 10 loaves.', ts: T0 }).entry;
  ledger.add({ claim: 'The batch limit is 12 loaves.', ts: T1 });
  assert.equal(ledger.list({ asOf: MID12 }).find((entry) => entry.id === old.id).status, 'active');
  assert.equal(ledger.get(old.id).status, 'contested');
  ledger.supersede(old.id, 'The batch limit is 14 loaves.', { ts: T1 }, { force: true });
  assert.equal(ledger.list({ asOf: MID12 }).find((entry) => entry.id === old.id).status, 'active');
  assert.equal(ledger.get(old.id).status, 'superseded');
});
test('as-of validates updated_at and all historical lines, even beyond the cutoff', (t) => {
  const file = temp(t), entry = newEntry({ claim: 'Cool loaves before slicing.', ts: T0 });
  writeSnapshots(file, [entry, { ...entry, updated_at: 'not-a-date' }]);
  assert.throws(() => load(file, { asOf: T0 }), /updated_at/);
  writeSnapshots(file, [entry, { ...entry, ts: T2, future_field: { ok: true } }]);
  assert.equal(load(file, { asOf: T0 }).length, 1);
});


test('oversized stderr fails without retry and still retains a diagnostic tail', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env({ LEDGER_MODEL_CMD: model('large-stderr') }) });
  ledger.init();
  const result = await ledger.check('Bake bread', { modelRetries: 3 });
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.reason, /stderr exceeded 1 MiB/);
  assert.equal(result.attempts, 1);
  assert.ok(result.stderrTail.length <= 2049);
  assert.equal(result.stderrTail[0], '…');
});

test('citation downgrades after retries retain attempt and stderr diagnostics', async (t) => {
  const file = temp(t), counter = path.join(path.dirname(file), 'counter');
  const ledger = openLedger({ file, env: env({ LEDGER_MODEL_CMD: model('retry-output'), RETRY_COUNTER: counter, RETRY_OUTPUT: 'VERDICT: GO\nWHY: See L-0000000000.' }) });
  ledger.init();
  const result = await ledger.check('Bake bread', { modelRetries: 1 });
  assert.equal(result.verdict, 'UNKNOWN');
  assert.match(result.reason, /after 2 attempts.*oven diagnostic/);
});

test('CLI as-of filters list snapshots and sets the check prompt date', (t) => {
  const file = temp(t), ledger = openLedger({ file });
  const early = ledger.add({ claim: 'Loaves cool before slicing.', scope: 'rules', ts: T0 }).entry;
  ledger.add({ claim: 'Label rye flour bags.', scope: 'rules', ts: T2 });
  const listed = cli(['list', '--file', file, '--as-of', MID01, '--scope', 'rules', '--status', 'active', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).data.entries.map((entry) => entry.id), [early.id]);
  const checked = cli(['check', 'Slice bread', '--file', file, '--as-of', MID01, '--json'], {
    LEDGER_MODEL_CMD: model('today'), EXPECT_TODAY: todayString(new Date(MID01), 'UTC'),
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout).data.standingRules.map((entry) => entry.id), [early.id]);
  const invalid = cli(['check', 'Slice bread', '--file', file, '--as-of', 'not-a-date', '--json']);
  assert.equal(invalid.status, 1);
  assert.match(JSON.parse(invalid.stderr).error.message, /invalid as-of date/);
});

test('non-text model command options fail closed with no invocation', async (t) => {
  const ledger = openLedger({ file: temp(t), env: env() });
  ledger.init();
  for (const modelCmd of [1, true, {}]) {
    const result = await ledger.check('Bake bread', { modelCmd });
    assert.equal(result.verdict, 'UNKNOWN');
    assert.equal(result.attempts, 0);
    assert.match(result.reason, /No model configured/);
  }
});
