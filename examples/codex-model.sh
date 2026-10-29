#!/usr/bin/env bash
# LEDGER_MODEL_CMD adapter for the OpenAI Codex CLI.
# Reads the ledger prompt on stdin and prints only the model's final reply on stdout.
# Usage: export LEDGER_MODEL_CMD="$PWD/examples/codex-model.sh"
# Optional: CODEX_MODEL (model id) and CODEX_EFFORT (default: low).
set -euo pipefail
out=$(mktemp)
err=$(mktemp)
trap 'rm -f "$out" "$err"' EXIT
args=(exec --skip-git-repo-check --ephemeral -s read-only --color never -o "$out"
      -c "model_reasoning_effort=\"${CODEX_EFFORT:-low}\"")
[ -n "${CODEX_MODEL:-}" ] && args+=(-m "$CODEX_MODEL")
# Suppress Codex's progress output, but surface the end of it if the call fails,
# so agent-ledger can report it in the UNKNOWN reason.
if ! codex "${args[@]}" - >/dev/null 2>"$err"; then
  tail -c 2048 "$err" >&2
  exit 1
fi
if [ ! -s "$out" ]; then
  echo "codex returned no final reply" >&2
  tail -c 2048 "$err" >&2
  exit 1
fi
cat "$out"
