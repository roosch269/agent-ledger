# Contributing to agent-ledger

Thanks for your interest in improving `agent-ledger`. This document covers everything you
need to get set up and land a change.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need **Node.js >= 20** and nothing else. `agent-ledger` has **zero runtime and zero
dev dependencies**, so there is no install step for the code itself.

```bash
git clone https://github.com/roosch269/agent-ledger.git
cd agent-ledger
node bin/ledger.js --help
```

`npm ci` checks the dependency-free lockfile in CI. You do not need to run it locally
to develop or test.

## Tests

```bash
npm test
```

This runs the full suite (`node test/run.mjs`), which covers the library, the CLI, the
locking protocol and verdict parsing, entirely offline using a bundled fake model fixture
(`test/fixtures/fake-model.mjs`). Every test must pass on Node 20, 22 and 24 — the same
matrix CI runs. Add or update tests for any behaviour you change.

## Eval

```bash
export LEDGER_MODEL_CMD='…your model command…'
npm run eval
```

The eval (`node eval/run.mjs`) runs the frozen `eval/bakery-42` cases against whatever
model `LEDGER_MODEL_CMD` points at and writes a JSON report to `eval/results/`. With no
model configured, every case is `UNKNOWN` by design (exit 3). Exit 1 signals an error;
exit 0 means all verdicts were usable, not that all expectations passed. The eval is a
design aid, not a gate; it does not run in CI.

## The zero-dependency rule

This is a hard constraint, not a preference: **no runtime or development dependencies.**

- Use only the Node standard library and built-in test runner (`node:test`).
- Do not add anything to `dependencies`, `devDependencies` or `peerDependencies`.
- `package-lock.json` must stay effectively empty.

A change that adds a dependency will not be merged. If you think you need one, open an
issue first to discuss the design.

## Style

- Match the surrounding code: ES modules, modern JavaScript, small focused functions,
  no transpilation.
- Keep comments sparse and about *why*, not *what*; the existing files set the density.
- Favour clear, deterministic behaviour. The check must **never** fall back to `GO`:
  anything uncertain is `UNKNOWN`.
- Match the spelling and tone of the surrounding documentation.

## Commits and pull requests

- Branch off `main`; keep each PR focused on one change.
- Write imperative, scoped commit subjects, e.g. `check: reject multi-verdict output`.
- Explain the *why* in the body, and note any user-visible or format change.
- Before opening a PR: `npm test` passes on your machine, docs are updated to match any
  behaviour change, and no dependency was added.
- Fill in the pull-request template. CI (Node 20/22/24) must be green.

## Adding eval cases

The 42 `eval/bakery-42` cases are **frozen** so published numbers stay reproducible.

- **Do not edit** the existing `eval/bakery-42/cases/c01`…`c42`, `expected.tsv`,
  `cases.json`, `world.json` or `EXPECTED.lock`.
- To contribute new scenarios, add a **new** case set in its own directory (for example
  `eval/<your-set>/`) following the same layout — one directory per case with
  `action.txt` and `ledger.jsonl`, plus an `expected.tsv` listing `id`, `type` and the
  expected `STOP`/`GO` verdict.
- The current runner is fixed to `bakery-42`; a new set also needs a separate runner or
  an explicit runner change before it can be evaluated.
- Describe in your PR what each case exercises and why the expected verdict is correct.

If you believe a frozen case is genuinely wrong, open an issue explaining it rather than
changing the file — correcting a frozen case is a deliberate, documented decision.
