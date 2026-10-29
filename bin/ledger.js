#!/usr/bin/env node
import fs from 'node:fs';
import { openLedger } from '../src/index.js';
import { plainData } from '../src/decide.js';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `agent-ledger ${version} — a shared append-only decision log

Usage: agent-ledger <command> [arguments] [options]
Alias: ledger

Commands:
  init                             Create the ledger if absent
  add "<claim>"                    Record a claim; clashes contest both entries
  supersede <id> "<new claim>"      Replace an active or contested entry
  contest <id> --note "<reason>"    Mark an entry disputed
  resolve <id> --note "<evidence>"  Return a disputed entry to active
  check "<proposed action>"        Ask one model to check the whole ledger
  list                             List entries, oldest first
  show <id>                        Show an entry and its evidence
  audit                            Summarize contested and stale entries
  path                             Print the resolved ledger path

Common options (every command):
  --file <path>                    Override the ledger path
  --json                           Emit {ok, command, data}; errors use {ok, command, error, usage}
  --help, -h                       Show this help
  --version                        Print the release version (without a command)

add / supersede options:
  --agent <label>                  Source label (LEDGER_AGENT or anonymous)
  --scope <scope>                  Scope label (default: general; rules = standing rule)
  --kind <decision|fact|rule>       Optional metadata only
  --ref <source>                   Source reference
  --evidence "<note>"              Evidence note; repeatable
  --force                          Skip deterministic clash detection
  --supersedes <id>                add only: same operation as supersede

contest / resolve: --agent <label>
check:             --agent <label> --model-cmd <command> --as-of <ISO date/time>
                   Model command overrides LEDGER_MODEL_CMD; --as-of checks the
                   ledger as it stood then and treats that instant as "today".
list:              --scope <scope> --status <active|contested|superseded>
                   --as-of <ISO date/time>  Reconstruct the ledger at that instant
audit:             --stale-days <number>  Default: 14
                   --model [--model-cmd <command>]  Report semantic contradictions
                   Reports only; never changes entries. Without --model, no model call.

Model contract:
  LEDGER_MODEL_CMD is a shell command. The complete prompt goes to stdin.
  PROMPT_FILE contains instructions; DECISIONS_FILE and ACTION_FILE contain data.
  check stdout must contain exactly one VERDICT: STOP or VERDICT: GO line,
  optionally followed by WHY: <explanation>. Markdown bold/backticks are accepted.
  Either stdout or stderr exceeding 1 MiB fails without retry.
  LEDGER_MODEL_TIMEOUT_MS defaults to 120000 (integer 1..2147483647).
  LEDGER_MODEL_RETRIES (integer 0..3, default 0) retries only a non-zero exit or
  timeout, never bad output; the last ~2 KB of stderr is kept in the UNKNOWN
  reason and in the --json stderrTail field.
  No model, invalid timeout or retry count, or failed/ambiguous output
  means UNKNOWN; ACTIVE and CONTESTED standing rules and lexical matches remain visible.
  The WHY line's cited ledger ids are returned as cited / unknownCitations; a GO
  citing only ids absent from the check is downgraded to UNKNOWN, and unknown
  citations print a warning (stderr in text mode).
  audit --model expects PAIR: <id> <id> | <reason> lines, or exactly NONE.
  Pairs must name distinct ACTIVE/CONTESTED entries with no supersession link.
  Missing models, failed commands or invalid responses are audit errors (exit 3).
  add-time clashes are lexical and conservative; use audit --model for reworded reversals.
  check fallback matches use action-token containment (minimum 0.34 and 2 shared
  tokens); one-token actions yield no hints. Hints never authorize an action.
  Asking humans for approval or clarification is never a violation by itself.

Paths and environment:
  --file > LEDGER_FILE > LEDGER_DIR/ledger.jsonl >
  XDG_DATA_HOME/agent-ledger/ledger.jsonl (default: ~/.local/share/agent-ledger/ledger.jsonl).
  LEDGER_TZ selects the prompt time zone; default: system zone.
  LEDGER_LOG_CHECKS=1 enables checks.jsonl next to the ledger (off by default).

Safety and exit codes:
  check: 0 GO, 2 STOP, 3 UNKNOWN, 1 usage/storage/configuration error.
  check requires an existing ledger; run init or set LEDGER_FILE if it is missing.
  audit --model: 0 successful report (including pairs), 3 model error, 1 usage/storage error.
  audit --model also requires an existing ledger.
  mutations: 2 recorded clash or attempted change to a superseded entry;
             1 usage/storage error.
  Other successful commands: 0. Usage/storage errors go to stderr, including JSON.
  Model failures appear in check/audit results on stdout.
  Mutations lock <ledger>.lock, wait up to 5 seconds, and reclaim locks older
  than 5 minutes only when the recorded PID is no longer alive. Use a local
  filesystem shared by processes on the same host. Replaced entries cannot
  be resolved back to active; supersede their current successor explicitly.
  Library mutations are synchronous: I/O and the lock wait block the event loop.
  Opt-in check logging also uses a synchronous lock (up to 5 seconds).
`;
const schemas = {
  init: [], path: [], add: ['agent', 'scope', 'kind', 'ref', 'evidence', 'force', 'supersedes'],
  supersede: ['agent', 'scope', 'kind', 'ref', 'evidence', 'force'],
  contest: ['agent', 'note'], resolve: ['agent', 'note'], check: ['agent', 'model-cmd', 'as-of'],
  list: ['scope', 'status', 'as-of'], show: [], audit: ['stale-days', 'model', 'model-cmd'],
};
const boolean = new Set(['json', 'help', 'version', 'force', 'model']);
const known = new Set(['file', ...boolean, ...Object.values(schemas).flat()]);
const raw = process.argv.slice(2);
let command = null;
let json = raw.includes('--json');
function parse() {
  const flags = {}, args = [];
  let literal = false;
  for (let index = 0; index < raw.length; index++) {
    const value = raw[index];
    if (value === '--' && !literal) { literal = true; continue; }
    if (!literal && value.startsWith('-')) {
      const [key, ...tail] = (value === '-h' ? '--help' : value).slice(2).split('=');
      if (!value.startsWith('--') && value !== '-h' || !known.has(key)) throw new Error(`unknown option: ${value}`);
      if (flags[key] !== undefined && key !== 'evidence') throw new Error(`option repeated: --${key}`);
      let data = true;
      if (boolean.has(key)) {
        if (tail.length) throw new Error(`--${key} does not take a value`);
      } else {
        data = tail.length ? tail.join('=') : raw[++index];
        if (typeof data !== 'string' || !data.trim() || (!tail.length && data.startsWith('-'))) throw new Error(`--${key} requires a value`);
      }
      if (key === 'evidence') (flags[key] ??= []).push(data);
      else flags[key] = data;
    } else if (command === null) command = value;
    else args.push(value);
  }
  json = flags.json || false;
  if (command !== null && !Object.hasOwn(schemas, command)) throw new Error(`unknown command: ${command}`);
  const allowed = new Set(['file', 'json', 'help', ...(schemas[command] || []), ...(!command ? ['version'] : [])]);
  for (const key of Object.keys(flags)) if (!allowed.has(key)) throw new Error(`--${key} is not supported by ${command || 'this invocation'}`);
  return { flags, args };
}
const line = (entry) => `${entry.id} ${entry.status.toUpperCase()} ${plainData(entry.scope)}  ${plainData(entry.claim)}${entry.superseded_by ? ` -> ${entry.superseded_by}` : ''}`;
function emit(data, text) {
  console.log(json ? JSON.stringify({ ok: true, command, data }) : text);
}
try {
  const { flags, args } = parse();
  if (flags.help || (!command && !flags.version)) {
    if (!command && raw.length && !flags.help) throw new Error('a command is required');
    command ||= 'help'; emit({ usage }, usage);
  } else if (flags.version) { command = 'version'; emit({ version }, version); }
  else {
    const arity = { add: 1, supersede: 2, contest: 1, resolve: 1, check: 1, show: 1 }[command] || 0;
    if (args.length !== arity) throw new Error(`${command} expects ${arity} argument${arity === 1 ? '' : 's'}; quote claims and actions containing spaces`);
    const ledger = openLedger({ file: flags.file });
    const agent = flags.agent || process.env.LEDGER_AGENT || 'anonymous';
    if (command === 'init') {
      const result = ledger.init(); emit(result, `${result.created ? 'Created' : 'Ready'}: ${ledger.file}`);
    } else if (command === 'path') emit({ file: ledger.file }, ledger.file);
    else if (command === 'add' || command === 'supersede') {
      const fields = { source_agent: agent, scope: flags.scope, kind: flags.kind, source_ref: flags.ref,
        evidence: (flags.evidence || []).map((note) => ({ note, by: agent, ts: new Date().toISOString() })) };
      const options = { force: flags.force || false };
      const result = command === 'add' ? ledger.add({ ...fields, claim: args[0], supersedes: flags.supersedes }, options) : ledger.supersede(args[0], args[1], fields, options);
      emit(result, [line(result.entry), ...result.conflicts.map((item) => `CONTESTED ${item.entry.id}: ${item.reason}`)].join('\n'));
      if (result.conflicts.length) process.exitCode = 2;
    } else if (command === 'contest' || command === 'resolve') {
      const entry = ledger[command](args[0], { note: flags.note, agent }); emit({ entry }, line(entry));
    } else if (command === 'show') {
      const entry = ledger.get(args[0]);
      if (!entry) throw new Error(`unknown entry: ${args[0]}`);
      emit({ entry }, [line(entry), `Timestamp: ${plainData(entry.ts)}`, `Agent: ${plainData(entry.source_agent)}`,
        ...(entry.source_ref ? [`Source: ${plainData(entry.source_ref)}`] : []),
        ...(entry.kind ? [`Kind: ${plainData(entry.kind)}`] : []),
        ...(entry.supersedes ? [`Replaces: ${entry.supersedes}`] : []),
        `Evidence (${entry.evidence?.length || 0}):`, ...(entry.evidence || []).map((item) => `  ${plainData(JSON.stringify(item))}`)].join('\n'));
    } else if (command === 'list') {
      const entries = ledger.list({ scope: flags.scope, status: flags.status, asOf: flags['as-of'] });
      emit({ entries }, entries.map(line).join('\n') || 'No entries.');
    } else if (command === 'audit') {
      if (flags['model-cmd'] !== undefined && !flags.model) throw new Error('audit --model-cmd requires --model');
      const result = await ledger.audit({ staleDays: flags['stale-days'] === undefined ? 14 : Number(flags['stale-days']), model: flags.model, modelCmd: flags['model-cmd'] });
      const lines = [`${result.total} entries: ${result.active} active, ${result.contested.length} contested, ${result.superseded} superseded.`,
        `Contested (${result.contested.length}):`, ...result.contested.map(line), `Stale (${result.stale.length}; ${result.staleDays} days):`, ...result.stale.map(line)];
      if (flags.model) {
        if (result.error) lines.push(`Audit error: ${result.error}`);
        else lines.push(`Semantic contradictions (${result.contradictions.length}):`,
          ...result.contradictions.map((pair) => `PAIR: ${pair.ids.join(' ')} | ${plainData(pair.reason)}`));
        if (result.warning && !json) console.error(result.warning);
      }
      emit(result, lines.join('\n'));
      if (result.error) process.exitCode = 3;
    } else if (command === 'check') {
      const result = await ledger.check(args[0], { modelCmd: flags['model-cmd'], agent, asOf: flags['as-of'] });
      const lines = [`VERDICT: ${result.verdict}`, result.reason || `WHY: ${result.why}`];
      if (result.verdict === 'UNKNOWN') lines.push(`Standing rules (ACTIVE or CONTESTED; ${result.standingRules.length}):`, ...result.standingRules.map(line),
        `Lexical matches (${result.matches.length}):`, ...result.matches.map(line));
      emit(result, lines.join('\n'));
      if (!json) {
        if (result.unknownCitations.length) console.error(`Warning: model cited unknown ledger id(s): ${result.unknownCitations.join(', ')}`);
        if (result.warning) console.error(result.warning);
      }
      process.exitCode = { GO: 0, STOP: 2, UNKNOWN: 3 }[result.verdict];
    }
  }
} catch (error) {
  const code = error.exitCode || 1;
  console.error(json ? JSON.stringify({ ok: false, command, error: { message: error.message, code }, usage }) : `Error: ${error.message}\nRun 'agent-ledger --help' for usage.`);
  process.exitCode = code;
}
