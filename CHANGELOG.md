# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

First public release.

### Added

- **Append-only JSONL decision log** shared by cooperating agents. One JSON object per
  line, one line per snapshot; the latest snapshot of an id is its current state.
- **CLI** (`agent-ledger`, alias `ledger`) with `init`, `add`, `supersede`, `contest`,
  `resolve`, `check`, `list`, `show`, `audit` and `path`, a `--json` output mode, and
  `--help` on every command.
- **Whole-ledger `check`**: renders the entire ledger and makes a single, provider-neutral
  model call for one `STOP`/`GO` verdict, with strict parsing. No model, a failed command, an invalid or elapsed timeout,
  or ambiguous output yields `UNKNOWN` — never a fallback `GO`.
- **Fail-safe exit codes** for `check`: `0` GO, `2` STOP, `3` UNKNOWN, `1` error.
- **Deterministic clash detection** on `add`: an overlapping claim that flips a negation or
  changes a number contests both entries; `--force` skips it.
- **Opt-in semantic audit.** `audit --model` / `audit({ model: true })` uses the model
  command contract to report contradictory ACTIVE/CONTESTED pairs without changing the
  ledger. Strict `PAIR: <id> <id> | <reason>` / `NONE` parsing rejects unknown/ineligible
  IDs, supersession chains, duplicate pairs and malformed output; failures are explicit
  audit errors (CLI exit 3). Ordinary audit remains synchronous and model-free.
- **Single-host file locking** with a bounded wait and stale-lock reclamation guarded by a
  liveness check on the recorded PID.
- **Model-command contract**: `LEDGER_MODEL_CMD` / `--model-cmd` is any shell command; the
  full prompt arrives on stdin, with `PROMPT_FILE`, `DECISIONS_FILE` and `ACTION_FILE` also
  provided, and a configurable timeout (`LEDGER_MODEL_TIMEOUT_MS`).
- **Diagnosable model failures and opt-in retries.** On a failed model command the last
  ~2 KB of its `stderr` (control characters neutralised) is kept in the UNKNOWN `reason` and
  in a `stderrTail` result/`--json` field. `LEDGER_MODEL_RETRIES` (integer `0`–`3`, default
  `0`; also the `modelRetries` library option) retries only a non-zero exit or a timeout —
  never a parse failure or other bad output — and the `reason` reports the attempts used.
  Invalid values return UNKNOWN.
- **Citation validation.** The ledger ids a `WHY` line cites are returned as `cited`
  (present in the check) and `unknownCitations` (absent); the CLI warns about unknown
  citations (stderr in text mode, a field in `--json`). A `GO` whose cited ids are **all**
  absent is downgraded to UNKNOWN; a `STOP` is never downgraded but still warns.
- **Point-in-time reconstruction.** Every new snapshot records `updated_at` (when its state
  took effect: equal to `ts` for a new entry, the change time for supersede/contest/resolve).
  `check` and `list` accept `--as-of <ISO date/time>` (and the `asOf` library option) to
  replay the append-only file as it stood at that instant; `check --as-of` also uses it as
  "today" in the prompt. Legacy snapshots without `updated_at` fall back to a documented
  effective time. Unparseable dates are rejected (exit 1).
- **Prompt hardening**: ledger and action content are passed as data, and embedded
  `VERDICT` markers, including whitespace before the colon, are neutralised.
- **Readable human output** with single-line claims and scopes; JSON retains original text.
- **Lexical hints** tolerate simple plurals and `-ment`, exclude superseded entries, and
  rank ACTIVE before CONTESTED. `check` returns entry objects in both `standingRules`
  and `matches`, with a `similarity` field added to each match. Clash detection is unchanged.
- **Legacy loading** tolerates `subject`/`predicate`; new entries omit those fields.
- **Library API** (`openLedger`, `ConflictError`) exported from `src/index.js`; mutations are synchronous
  and can block the event loop for the 5-second lock wait.
- **Zero dependencies**; requires Node.js >= 20.
- **Synthetic eval** (`eval/bakery-42`, 42 frozen cases) runnable with `npm run eval`.
- **Package metadata export** at `agent-ledger/package.json`, alongside the public API.
- **Offline example self-tests in CI** after `npm test`, for both Bash and Python integrations.
- **Visible README title** below the hero image.

### Pre-release hardening

- **Strict response markup.** Balanced Markdown wrappers (`**` or a backtick) are
  accepted only around a whole `VERDICT`/`WHY` line, its key or its value; markup inside
  them (for example ``VERDICT: G`O` ``) is malformed output and yields UNKNOWN. A reply
  wrapped in a code fence may carry a language tag, unless the tag is itself a
  verdict word (`STOP`, `GO`, `VERDICT` or `WHY`). Every line terminator (including a
  bare CR and Unicode line separators) splits lines, so no second verdict can hide inside
  `WHY`; `WHY` text keeps its own inner Markdown.
- **Codex adapter diagnostics.** `examples/codex-model.sh` keeps Codex's progress output
  suppressed but prints the last ~2 KB of it to stderr when the call fails or returns no reply.
- **Frozen eval check.** The test suite verifies the `eval/bakery-42` files against
  `EXPECTED.lock` and checks `expected.tsv` against the case definitions.
- **Fallback hint containment.** Short actions can match long rules using shared tokens
  divided by action tokens, with the existing 0.34 floor and a minimum of two shared
  tokens. One-token actions return no hints; add-time clash scoring stays symmetric.
- **Approval questions in the check prompt.** A new prompt line clarifies that asking the
  humans the ledger serves for approval or clarification is never a violation by itself.
- **Retry failure boundaries.** Oversized output cannot become retryable on a non-zero
  exit or timeout; empty/coerced retry settings are rejected. Parse failures also retain
  stderr-tail and attempt diagnostics.
- **Bounded stderr capture.** Either output stream exceeding 1 MiB fails without retry,
  preventing a noisy model from filling temporary storage until its timeout.
- **Citation token boundaries.** A known ID embedded in a longer identifier cannot mask
  an unknown citation and preserve a GO.
- **Historical replay edge cases.** Initial legacy evidence cannot hide an existing
  entry; replay respects append order when clocks move backwards. Backdated additions
  do not backdate supersede/clash changes to existing entries.
- **Disputes cannot neutralise prohibitions in the check prompt.** CONTESTED entries cannot
  grant permission; if one would forbid the action, or the action depends on its resolution,
  the prompt requires STOP until resolved. UNKNOWN includes ACTIVE and CONTESTED standing
  rules with status labels, even without lexical matches.
- **Missing ledgers fail closed.** `check` reports `ledger not found at <path>; run init or set LEDGER_FILE`
  (CLI exit 1; library promise rejection), before invoking a model. `init` and `add` still
  create missing files.

[0.1.0]: https://github.com/roosch269/agent-ledger/releases/tag/v0.1.0
