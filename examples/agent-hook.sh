#!/usr/bin/env bash
# Gate any command behind the ledger: run it only if `check` returns GO.
#
# Usage:
#   bash examples/agent-hook.sh <command> [args...]
#
# Example:
#   LEDGER_MODEL_CMD='…your model command…' \
#     bash examples/agent-hook.sh printf '%s\n' 'Action would run here'
#
# Exit codes:
#   - the wrapped command's own exit code, on GO
#   - 2  if the ledger says STOP
#   - 3  if the ledger says UNKNOWN (no model, failure, or ambiguous output)
#   - 1  on a ledger usage/storage error; 64 if no command was supplied
#
# UNKNOWN is treated as "do not proceed", exactly like STOP.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

# Use this checkout's CLI so an unrelated `ledger` executable cannot be selected.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER=(node "$ROOT/bin/ledger.js")

action="$*"

# Capture the verdict so we can show it, and branch on the exit code.
verdict_output="$("${LEDGER[@]}" check "$action" 2>&1)"
code=$?

case "$code" in
  0)
    echo "GO: $action"
    exec "$@"
    ;;
  2)
    echo "STOP - not running: $action" >&2
    echo "$verdict_output" >&2
    exit 2
    ;;
  *)
    # 3 = UNKNOWN; anything else is a usage/storage error. Never proceed.
    echo "UNKNOWN/blocked - not running: $action" >&2
    echo "$verdict_output" >&2
    exit "$code"
    ;;
esac
