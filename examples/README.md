# Examples

Runnable examples and integration patterns for `agent-ledger`. The quickstart and
Python self-test run offline with fake models and need no API key. The hook uses your configured model;
external provider commands require their own tools, credentials and connectivity.

Run them from the repository root with Node.js >= 20. The shell examples require
Bash; the Python self-test requires Python 3.8+.

| File | What it shows | Run |
| --- | --- | --- |
| [`quickstart.sh`](quickstart.sh) | A full, self-contained tour: init, record a rule, and `check` producing UNKNOWN, STOP and GO. Cleans up after itself. | `bash examples/quickstart.sh` |
| [`agent-hook.sh`](agent-hook.sh) | Gate any command: run it only if the ledger says GO; STOP and UNKNOWN both block. | `bash examples/agent-hook.sh <command> [args...]` |
| [`python_agent.py`](python_agent.py) | Call `check --json` from Python (stdlib only) and branch on the exit code; includes an offline self-test. | `python3 examples/python_agent.py` |
| [`codex-model.sh`](codex-model.sh) | `LEDGER_MODEL_CMD` adapter for the OpenAI Codex CLI that prints only the final reply. | `export LEDGER_MODEL_CMD="$PWD/examples/codex-model.sh"` |
| [`model-commands.md`](model-commands.md) | How to wire `LEDGER_MODEL_CMD` to Claude Code, Codex, local models and a generic HTTP endpoint. | — |

## The pattern

Every integration is the same three steps:

1. Run `check "<proposed action>"` (optionally with `--json`).
2. Read the exit code: `0` = GO, `2` = STOP, `3` = UNKNOWN.
   Usage/storage errors return `1` and also block.
3. Proceed **only** on `0`. Treat UNKNOWN exactly like STOP — it is never permission to act.

To get real verdicts rather than UNKNOWN, set `LEDGER_MODEL_CMD` to a model command — see
[`model-commands.md`](model-commands.md).
