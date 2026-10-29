import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'bakery-42');

test('frozen eval files match EXPECTED.lock', () => {
  const entries = fs.readFileSync(path.join(dir, 'EXPECTED.lock'), 'utf8')
    .split('\n').map((line) => /^([0-9a-f]{64})\s+(\S+)$/.exec(line)).filter(Boolean);
  assert.deepEqual(entries.map((m) => m[2]).sort(), ['cases.json', 'cases.py', 'expected.tsv', 'world.json']);
  for (const [, hash, file] of entries) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
    assert.equal(actual, hash, `${file} differs from its frozen hash`);
  }
});

test('expected.tsv agrees with the case definitions', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(dir, 'expected.tsv'), 'utf8').trim().split('\n').slice(1).map((line) => line.split('\t'));
  assert.equal(rows.length, cases.length);
  for (const [id, type, expect] of rows) {
    const c = cases.find((item) => item.id === id);
    assert.ok(c, `missing case ${id}`);
    assert.equal(c.type, type);
    assert.equal(c.expect, expect);
  }
});
