// Append-only snapshots: the last snapshot of each ID is its current state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withLock } from './lock.js';
import { clashReason } from './match.js';

export const STATUSES = ['active', 'superseded', 'contested'];
const ID = /^L-[0-9a-f]{10}$/;
export class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; this.exitCode = 2; }
}
export function ledgerPath(env = process.env) {
  return path.resolve(env.LEDGER_FILE || (env.LEDGER_DIR ? path.join(env.LEDGER_DIR, 'ledger.jsonl') :
    path.join(env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share'), 'agent-ledger', 'ledger.jsonl')));
}
export function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}
/** Parse a date/time to epoch ms, or throw. Used by --as-of / the asOf option. */
export function parseInstant(value, label = 'date') {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new Error(`invalid ${label}: ${JSON.stringify(String(value))}`);
  return t;
}
export function validate(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['entry must be an object'];
  const errors = [];
  for (const key of ['id', 'claim', 'scope', 'source_agent', 'ts', 'status']) {
    if (typeof entry[key] !== 'string' || !entry[key].trim()) errors.push(`${key} must be a non-empty string`);
  }
  if (!ID.test(entry.id)) errors.push('id must be L- followed by 10 lowercase hex digits');
  if (!STATUSES.includes(entry.status)) errors.push('status must be active, superseded or contested');
  if (typeof entry.ts !== 'string' || !Number.isFinite(Date.parse(entry.ts))) errors.push('ts must be a valid date');
  if (entry.updated_at != null && (typeof entry.updated_at !== 'string' || !Number.isFinite(Date.parse(entry.updated_at)))) errors.push('updated_at must be a valid date');
  for (const key of ['supersedes', 'superseded_by']) {
    if (entry[key] != null && (typeof entry[key] !== 'string' || !ID.test(entry[key]))) errors.push(`${key} must be a ledger id`);
    if (entry[key] === entry.id) errors.push(`${key} cannot reference itself`);
  }
  if (entry.status === 'superseded' && !entry.superseded_by) errors.push('superseded entry must name superseded_by');
  if (entry.kind != null && !['decision', 'fact', 'rule'].includes(entry.kind)) errors.push('kind must be decision, fact or rule');
  for (const key of ['source_ref', 'subject', 'predicate']) {
    if (entry[key] != null && typeof entry[key] !== 'string') errors.push(`${key} must be a string or null`);
  }
  if (entry.evidence != null && (!Array.isArray(entry.evidence) || entry.evidence.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))) errors.push('evidence must be an array of objects');
  return errors;
}
function parseSnapshots(file, allowMissing) {
  let contents;
  try { contents = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') {
      if (allowMissing) return [];
      throw new Error(`ledger not found at ${file}; run init or set LEDGER_FILE`);
    }
    throw error;
  }
  const snapshots = [];
  contents.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let entry;
    try { entry = JSON.parse(line); } catch { throw new Error(`${file}:${index + 1}: invalid JSON`); }
    const errors = validate(entry);
    if (errors.length) throw new Error(`${file}:${index + 1}: ${errors.join('; ')}`);
    snapshots.push(entry);
  });
  return snapshots;
}
/** Effective time of a snapshot: when its recorded state took effect.
 * Snapshots written since this version carry updated_at. Legacy snapshots without
 * it fall back to the entry's ts, lifted to its successor's ts (for a superseded
 * snapshot) or its latest evidence ts (for contest/resolve) when those are known;
 * a legacy status change with none of these cannot be dated before the entry itself.
 */
function effectiveTime(entry, tsById, first) {
  if (entry.updated_at != null) return Date.parse(entry.updated_at);
  let t = Date.parse(entry.ts);
  if (entry.status === 'superseded' && entry.superseded_by && tsById.has(entry.superseded_by)) t = Math.max(t, tsById.get(entry.superseded_by));
  // Evidence supplied with the initial active entry does not date a state change.
  for (const item of first && entry.status === 'active' ? [] : entry.evidence || []) {
    const e = Date.parse(item?.ts);
    if (Number.isFinite(e)) t = Math.max(t, e);
  }
  return t;
}
/** Replay the append-only file. Without asOf, keep each id's last snapshot.
 * With asOf (ISO date/time), reconstruct the ledger at that instant: ignore
 * entries created after it, and for each remaining id keep the latest snapshot
 * whose effective time is at or before it.
 */
export function load(file, { allowMissing = true, asOf } = {}) {
  const snapshots = parseSnapshots(file, allowMissing);
  const entries = new Map();
  if (asOf == null) {
    for (const entry of snapshots) entries.set(entry.id, entry);
  } else {
    const t = parseInstant(asOf, 'as-of date');
    const tsById = new Map();
    for (const entry of snapshots) if (!tsById.has(entry.id)) tsById.set(entry.id, Date.parse(entry.ts));
    const seen = new Set();
    for (const entry of snapshots) {
      const first = !seen.has(entry.id);
      seen.add(entry.id);
      if (Date.parse(entry.ts) > t) continue;
      const eff = effectiveTime(entry, tsById, first);
      if (eff > t) continue;
      // Append order remains authoritative even if the writer's clock moved back.
      entries.set(entry.id, entry);
    }
  }
  return [...entries.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}
export function newEntry(fields) {
  const entry = {
    claim: requireText(fields.claim, 'claim'), scope: fields.scope ?? 'general',
    source_agent: fields.source_agent ?? 'anonymous', source_ref: fields.source_ref ?? null,
    ts: fields.ts ?? new Date().toISOString(), status: 'active', supersedes: fields.supersedes ?? null,
    evidence: fields.evidence ?? [],
  };
  if (fields.kind != null) entry.kind = fields.kind;
  entry.id = 'L-' + createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 10);
  // updated_at is excluded from the id hash: a new entry's state took effect at ts.
  entry.updated_at = entry.ts;
  return entry;
}
function writeBatch(file, entries) {
  // Validate the serialized representation too, before a single append of the batch.
  const lines = entries.map((entry) => JSON.stringify(entry));
  for (const line of lines) {
    const errors = validate(JSON.parse(line));
    if (errors.length) throw new Error(`invalid entry: ${errors.join('; ')}`);
  }
  let prefix = '';
  if (fs.existsSync(file) && fs.statSync(file).size) {
    const fd = fs.openSync(file, 'r');
    try {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, fs.fstatSync(fd).size - 1);
      if (last[0] !== 10) prefix = '\n';
    } finally { fs.closeSync(fd); }
  }
  fs.appendFileSync(file, prefix + lines.join('\n') + '\n', { mode: 0o600 });
}
function current(entries, id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new Error(`unknown entry: ${id}`);
  if (entry.status === 'superseded') throw new ConflictError(`${id} is already superseded by ${entry.superseded_by}; use the newer entry`);
  return entry;
}
export function init(file) {
  return withLock(file, () => {
    load(file);
    const created = !fs.existsSync(file);
    if (created) fs.closeSync(fs.openSync(file, 'wx', 0o600));
    return { file, created };
  });
}
export function add(file, fields, { force = false } = {}) {
  return withLock(file, () => {
    const entries = load(file);
    const entry = newEntry(fields);
    const errors = validate(entry);
    if (errors.length) throw new Error(`invalid entry: ${errors.join('; ')}`);
    const previous = entry.supersedes ? current(entries, entry.supersedes) : null;
    const duplicate = entries.find((item) => item.id === entry.id);
    if (duplicate) {
      // A hash collision must never overwrite an unrelated entry.
      if (duplicate.claim !== entry.claim || duplicate.scope !== entry.scope || duplicate.source_agent !== entry.source_agent || duplicate.ts !== entry.ts) throw new Error(`id collision: ${entry.id}`);
      return { entry: duplicate, duplicate: true, conflicts: [] };
    }
    const conflicts = force ? [] : entries.filter((item) => item.id !== previous?.id && item.status !== 'superseded')
      .map((item) => ({ entry: item, reason: clashReason(entry.claim, item.claim) })).filter((item) => item.reason);
    const updates = [];
    // A caller-supplied creation timestamp must not backdate existing state changes.
    const changed = new Date().toISOString();
    if (previous) updates.push({ ...previous, status: 'superseded', superseded_by: entry.id, updated_at: changed });
    for (const conflict of conflicts) updates.push({ ...conflict.entry, status: 'contested', updated_at: changed });
    if (conflicts.length) entry.status = 'contested';
    writeBatch(file, [...updates, entry]);
    return { entry, duplicate: false, conflicts };
  });
}
export function setStatus(file, id, status, { note, agent = 'anonymous' } = {}) {
  if (!['active', 'contested'].includes(status)) throw new Error('status must be active or contested');
  requireText(note, 'note'); requireText(agent, 'agent');
  return withLock(file, () => {
    const old = current(load(file), id);
    const now = new Date().toISOString();
    const entry = { ...old, status, updated_at: now, evidence: [...(old.evidence || []), { note: note.trim(), by: agent, ts: now }] };
    writeBatch(file, [entry]);
    return entry;
  });
}
