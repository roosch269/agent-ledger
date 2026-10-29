import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const LOCK_WAIT_MS = 5000;
export const LOCK_STALE_MS = 300000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function stale(file) {
  try {
    const stat = fs.statSync(file);
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Incomplete lock: use mtime. */ }
    const timestamp = Number.isFinite(owner?.timestamp) ? owner.timestamp : stat.mtimeMs;
    return Date.now() - timestamp > LOCK_STALE_MS && !alive(owner?.pid);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function release(file, token) {
  try {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** Exclusive local-filesystem lock. Wait at most 5 seconds; reclaim after 5 minutes
 * only if the recorded process is no longer alive. A live PID is never evicted.
 * Synchronous: both filesystem I/O and lock waiting block the event loop.
 * Reclamation itself is serialized so two waiters cannot unlink a new owner's lock.
 */
export function withLock(file, fn, { deadline = Date.now() + LOCK_WAIT_MS } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = randomUUID();
  let delay = 15;
  for (;;) {
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (stale(lock)) {
        // A second lock protects the read/check/unlink sequence. Its own stale
        // recovery uses the same protocol, only when needed after a crash.
        withLock(lock, () => { if (stale(lock)) fs.unlinkSync(lock); }, { deadline });
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`ledger is locked: ${lock}; waited ${LOCK_WAIT_MS} ms`);
      pause(Math.min(delay, remaining));
      delay = Math.min(200, Math.ceil(delay * 1.5));
      continue;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, timestamp: Date.now(), token }) + '\n');
      return fn();
    } finally {
      fs.closeSync(fd);
      // If writing the owner record failed, the open file still belongs to us.
      try { release(lock, token); }
      catch (error) {
        if (error instanceof SyntaxError) fs.unlinkSync(lock);
        else throw error;
      }
    }
  }
}
