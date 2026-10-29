import path from 'node:path';
import { add, init, ledgerPath, load, parseInstant, setStatus, STATUSES } from './ledger.js';
import { check } from './check.js';
import { audit } from './audit.js';
export { ConflictError } from './ledger.js';

/** Open an append-only local ledger. Opening does not create files.
 * @param {{file?: string, env?: Object}} [options] Explicit path overrides env defaults.
 * @returns {object} Synchronous storage methods plus asynchronous check() and audit({model:true}).
 * init/add/supersede/contest/resolve block the event loop during I/O and can wait
 * up to 5 seconds for a lock. check() also uses synchronous I/O; opt-in check
 * logging can block for the same lock wait. Use a worker/process for isolation.
 * Storage/validation errors throw; superseded-target conflicts have exitCode 2.
 */
export function openLedger({ file, env = process.env } = {}) {
  if (file != null && (typeof file !== 'string' || !file.trim())) throw new Error('file must be a non-empty path');
  const resolved = file == null ? ledgerPath(env) : path.resolve(file);
  return {
    file: resolved,
    /** Create the file if absent; never truncate an existing ledger. */
    init: () => init(resolved),
    /** Add {claim, scope?, source_agent?, source_ref?, kind?, evidence?, ts?, supersedes?}.
     * Returns {entry, duplicate, conflicts}; {force:true} skips lexical clash detection.
     * kind is metadata only. source_agent defaults to "anonymous", scope to "general".
     */
    add: (fields, options) => add(resolved, fields, options),
    /** Replace a currently active or contested entry; refuse an already replaced ID. */
    supersede: (id, claim, fields = {}, options) => add(resolved, { ...fields, claim, supersedes: id }, options),
    /** Dispute a current entry. Requires {note}; optional {agent} labels evidence. */
    contest: (id, options) => setStatus(resolved, id, 'contested', options),
    /** Return a current entry to active with {note, agent?}; never resurrect a replaced ID. */
    resolve: (id, options) => setStatus(resolved, id, 'active', options),
    /** Return Promise<{verdict, reason, why, cited, unknownCitations, stderrTail, attempts, ms, standingRules, matches, action, agent, warning?}>.
     * Options: {modelCmd?, timeoutMs?, modelRetries?, agent?, now?, asOf?}. UNKNOWN is never permission to act.
     * modelRetries (0..3, default 0) retries only a non-zero exit or timeout, never bad output.
     * cited / unknownCitations list ledger ids the WHY line names that are present / absent here;
     * a GO citing only absent ids is downgraded to UNKNOWN. asOf reconstructs the ledger at that
     * instant and uses it as "today" in the prompt. Rejects if the ledger file is missing; run init() or add() first.
     * standingRules: active and contested rules-scope entry[];
     * matches: {...entry, similarity: number}[], excluding
     * superseded entries, ACTIVE before CONTESTED, then descending similarity.
     * similarity is a lexical hint from 0 to 1, never permission to act.
     */
    check: async (action, options = {}) => {
      const now = options.asOf != null ? new Date(parseInstant(options.asOf, 'as-of date')) : options.now;
      return check(action, load(resolved, { allowMissing: false, asOf: options.asOf }), { ...options, now, env, file: resolved });
    },
    /** Latest snapshots, oldest first; optional exact {scope, status} filters and {asOf}
     * to reconstruct the ledger as it stood at an ISO date/time. */
    list: ({ scope, status, asOf } = {}) => {
      if (status != null && !STATUSES.includes(status)) throw new Error('status must be active, superseded or contested');
      return load(resolved, { asOf }).filter((entry) => (scope == null || entry.scope === scope) && (status == null || entry.status === status));
    },
    /** Get the latest snapshot for an ID, or null if absent. */
    get: (id) => load(resolved).find((entry) => entry.id === id) || null,
    /** Return counts, contested entries and stale active entries; {staleDays=14, now?}.
     * {model:true, modelCmd?, timeoutMs?, modelRetries?} returns a Promise adding
     * {contradictions: {ids, reason}[], error, stderrTail, attempts, ms, warning?}.
     * Model failures are explicit errors, never a clean audit. No ledger writes.
     */
    audit: (options = {}) => audit(load(resolved, { allowMissing: !options.model }), { ...options, env }),
  };
}
