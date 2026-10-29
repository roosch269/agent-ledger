import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalMatches, clashReason, similarity } from '../src/match.js';

test('lexical hints tolerate a small set of English plurals and suffixes', () => {
  for (const [a, b] of [['Friday', 'Fridays'], ['deploy', 'deploys'], ['deploy', 'deployment'],
    ['deploy', 'deployments'], ['policy', 'policies'], ['batch', 'batches']]) {
    const matches = lexicalMatches(`bakery ${a}`, [{ claim: `bakery ${b}`, status: 'active' }]);
    assert.equal(matches[0]?.similarity, 1, `${a} / ${b}`);
  }
  for (const [a, b] of [['bus', 'business'], ['class', 'clash'], ['ship', 'shipping'],
    ['deploy', 'deployed'], ['analysis', 'analysi'], ['2026', '2027']]) {
    assert.equal(lexicalMatches(`bakery ${a}`, [{ claim: `bakery ${b}`, status: 'active' }]).length, 0, `${a} / ${b}`);
  }
});

test('stemming does not change clash detection thresholds or negation handling', () => {
  assert.equal(similarity('deploy Friday', 'deployments Fridays'), 0);
  assert.equal(clashReason('Deploy Friday 10', 'Never deploys Fridays 12'), null);
  assert.equal(clashReason('Deploy Friday 10', 'Never deploy Friday 10'), 'negation flip');
  assert.equal(clashReason('Deploy Friday 10', 'Deploy Friday 12'), 'numbers differ');
  assert.equal(clashReason('Deploy Friday 10', 'Deploy Friday 10'), null);
});

test('lexical matches rank similarity within each status and omit superseded entries', () => {
  const entries = [
    { id: 'old', claim: 'bake rye loaves', status: 'superseded' },
    { id: 'disputed', claim: 'bake rye loaves', status: 'contested' },
    { id: 'partial', claim: 'bake rye', status: 'active' },
    { id: 'exact', claim: 'bake rye loaves', status: 'active' },
  ];
  assert.deepEqual(lexicalMatches('bake rye loaves', entries).map((entry) => entry.id), ['exact', 'partial', 'disputed']);
});

test('fallback containment finds a short action within a long rule', () => {
  const claim = 'Order flour from Millco only after the bakery manager confirms storage capacity, delivery hours, invoice details and the weekly baking schedule.';
  const matches = lexicalMatches('Order flour from Millco', [{ claim, status: 'active' }]);
  assert.equal(matches[0]?.similarity, 1);
  assert.ok(similarity('Order flour from Millco', claim) < 0.34);
  assert.equal(similarity('Order flour from Millco', claim), similarity(claim, 'Order flour from Millco'));
});
test('fallback requires two shared tokens and retains the 0.34 floor', () => {
  const entries = [{ claim: 'Order flour', status: 'active' }];
  for (const action of ['', 'the and', 'Order', 'Order rye', 'order flour sugar butter milk eggs']) {
    assert.deepEqual(lexicalMatches(action, entries), [], action);
  }
  assert.equal(lexicalMatches('order flour sugar butter milk', entries)[0].similarity, 0.4);
});
