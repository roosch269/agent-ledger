#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLedger } from '../src/index.js';

const base = fileURLToPath(new URL('./bakery-42/', import.meta.url));
const output = fileURLToPath(new URL('./results/', import.meta.url));
try {
  if (process.argv.length > 2) throw new Error('Usage: npm run eval (configure LEDGER_MODEL_CMD and optional LEDGER_MODEL_TIMEOUT_MS)');
  const cases = fs.readFileSync(path.join(base, 'expected.tsv'), 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
    const [id, type, expected] = line.split('\t');
    if (!/^c\d{2}$/.test(id) || !['STOP', 'GO'].includes(expected)) throw new Error(`Invalid expected case: ${id}`);
    return { id, type, expected };
  });
  if (cases.length !== 42 || new Set(cases.map((item) => item.id)).size !== 42) throw new Error('Expected 42 unique frozen cases');
  // Frozen scenario date: keep relative dates reproducible across future runs.
  const now = new Date('2026-10-17T12:00:00Z');
  const results = [];
  for (const item of cases) {
    const file = path.join(base, 'cases', item.id, 'ledger.jsonl');
    const actionFile = fs.readFileSync(path.join(base, 'cases', item.id, 'action.txt'), 'utf8').trim();
    const parts = /^Agent: (.*)\r?\nProposed action: ([\s\S]*)$/.exec(actionFile);
    const action = parts ? parts[2] : actionFile;
    const agent = parts ? parts[1] : 'anonymous';
    const started = performance.now();
    try {
      // Eval must never add check logs to the frozen case directories.
      const ledger = openLedger({ file, env: { ...process.env, LEDGER_TZ: 'UTC', LEDGER_LOG_CHECKS: '0' } });
      const result = await ledger.check(action, { now, agent });
      results.push({ ...item, verdict: result.verdict, reason: result.reason, why: result.why, ms: performance.now() - started });
    } catch (error) {
      results.push({ ...item, verdict: 'UNKNOWN', reason: error.message, why: '', ms: performance.now() - started, error: true });
    }
  }
  const stopCases = cases.filter((item) => item.expected === 'STOP').length;
  const goCases = cases.length - stopCases;
  const latencies = results.map((item) => item.ms).sort((a, b) => a - b);
  const summary = {
    stopped: results.filter((item) => item.expected === 'STOP' && item.verdict === 'STOP').length,
    stopCases,
    falseBlocks: results.filter((item) => item.expected === 'GO' && item.verdict === 'STOP').length,
    goCases,
    unknown: results.filter((item) => item.verdict === 'UNKNOWN').length,
    medianLatencyMs: (latencies[20] + latencies[21]) / 2,
  };
  fs.mkdirSync(output, { recursive: true });
  const resultFile = path.join(output, `run-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ version: '0.1.0', scenarioDate: now.toISOString(), runAt: new Date().toISOString(), summary, results }, null, 2) + '\n');
  console.log('Metric          Result');
  console.log(`Stopped         ${summary.stopped}/${stopCases}`);
  console.log(`False blocks    ${summary.falseBlocks}/${goCases}`);
  console.log(`Unknown         ${summary.unknown}`);
  console.log(`Median latency  ${summary.medianLatencyMs.toFixed(1)} ms`);
  console.log(`Results: ${path.relative(process.cwd(), resultFile)}`);
  if (!process.env.LEDGER_MODEL_CMD?.trim()) console.error('Set LEDGER_MODEL_CMD to evaluate a model; unconfigured checks are UNKNOWN.');
  process.exitCode = results.some((item) => item.error) ? 1 : summary.unknown ? 3 : 0;
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
