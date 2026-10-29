import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const bin = path.join(root, 'bin/ledger.js');
export const fixture = path.join(root, 'test/fixtures/fake-model.mjs');
const temporary = path.join(root, '.agent-ledger', 'tmp');
fs.mkdirSync(temporary, { recursive: true });
export function temp(t) {
  const dir = fs.mkdtempSync(path.join(temporary, 'test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'ledger.jsonl');
}
export function env(overrides = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LEDGER_') && key !== 'NODE_TEST_CONTEXT'));
  return { ...clean, TMPDIR: temporary, LEDGER_MODEL_CMD: '', LEDGER_TZ: 'UTC', ...overrides };
}
export const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
export const model = (mode) => `${quote(process.execPath)} ${quote(fixture)} ${mode}`;
function capture() {
  const dir = fs.mkdtempSync(path.join(temporary, 'capture-'));
  const stdout = path.join(dir, 'stdout'), stderr = path.join(dir, 'stderr');
  const out = fs.openSync(stdout, 'w'), err = fs.openSync(stderr, 'w');
  return { stdio: ['ignore', out, err], finish(status) {
    fs.closeSync(out); fs.closeSync(err);
    const result = { status, stdout: fs.readFileSync(stdout, 'utf8'), stderr: fs.readFileSync(stderr, 'utf8') };
    fs.rmSync(dir, { recursive: true, force: true }); return result;
  } };
}
export function runNode(args, overrides = {}) {
  const output = capture();
  const result = spawnSync(process.execPath, args, { cwd: root, env: env(overrides), timeout: 15000, stdio: output.stdio });
  const captured = output.finish(result.status);
  if (result.error) throw result.error;
  return captured;
}
export function cli(args, overrides = {}) { return runNode([bin, ...args], overrides); }
export function child(args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const output = capture();
    const processHandle = spawn(process.execPath, [bin, ...args], { cwd: root, env: env(overrides), stdio: output.stdio });
    let error;
    processHandle.on('error', (value) => { error = value; });
    processHandle.on('close', (status) => {
      const result = output.finish(status);
      if (error) reject(error); else resolve(result);
    });
  });
}
