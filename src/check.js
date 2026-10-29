import fs from 'node:fs';
import path from 'node:path';
import { decide, failureReason } from './decide.js';
import { lexicalMatches } from './match.js';
import { requireText } from './ledger.js';
import { withLock } from './lock.js';

// Match whole ID tokens, never a known ID embedded in a longer identifier.
const CITATION = /(?<![\p{L}\p{N}_-])L-[0-9a-f]{10}(?![\p{L}\p{N}_-])/giu;
/** Split the ids a WHY line cites into those present in this check and those absent. */
export function citations(why, entries) {
  const known = new Set(entries.map((entry) => entry.id));
  const seen = new Set(), cited = [], unknownCitations = [];
  for (const match of String(why || '').matchAll(CITATION)) {
    const id = 'L-' + match[0].slice(2).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    (known.has(id) ? cited : unknownCitations).push(id);
  }
  return { cited, unknownCitations };
}

/** Check the entire ledger with one model call. Rules and lexical matches are
 * always returned, especially when a model cannot provide a usable verdict.
 * standingRules contains entry objects; matches contains {...entry, similarity}.
 * Matches exclude superseded entries and sort ACTIVE before CONTESTED, then by
 * descending similarity. Optional check logging synchronously waits for its lock.
 */
export async function check(action, entries, options = {}) {
  requireText(action, 'action');
  const agent = requireText(options.agent ?? (options.env || process.env).LEDGER_AGENT ?? 'anonymous', 'agent');
  const standingRules = entries.filter((entry) => entry.scope === 'rules' && ['active', 'contested'].includes(entry.status));
  const matches = lexicalMatches(action, entries);
  const decided = await decide(action, entries, { ...options, agent });
  const { cited, unknownCitations } = citations(decided.why, entries);
  let { verdict, reason } = decided;
  // A GO whose only cited ids are absent from this check cannot be trusted; STOP is left as the safe side.
  if (verdict === 'GO' && cited.length === 0 && unknownCitations.length > 0) {
    verdict = 'UNKNOWN';
    reason = failureReason(`Model returned GO but every ledger id it cited (${unknownCitations.join(', ')}) is absent from this check; treating as UNKNOWN.`, decided.attempts, decided.stderrTail);
  }
  const result = { action, agent, ...decided, verdict, reason, cited, unknownCitations, standingRules, matches };
  if ((options.env || process.env).LEDGER_LOG_CHECKS === '1' && options.file) {
    const log = path.join(path.dirname(options.file), 'checks.jsonl');
    try {
      if (path.resolve(log) === path.resolve(options.file)) throw new Error('check log path is also the ledger path');
      withLock(log, () => fs.appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), ...result }) + '\n', { mode: 0o600 }));
    } catch (error) { result.warning = `Could not log check: ${error.message}`; }
  }
  return result;
}
