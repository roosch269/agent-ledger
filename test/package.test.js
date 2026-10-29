import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openLedger, ConflictError } from 'agent-ledger';
import * as local from '../src/index.js';

test('package exports expose the public API and package metadata', () => {
  assert.equal(openLedger, local.openLedger);
  assert.equal(ConflictError, local.ConflictError);
  const metadata = createRequire(import.meta.url)('agent-ledger/package.json');
  assert.equal(metadata.name, 'agent-ledger');
  assert.equal(metadata.version, '0.1.0');
});
