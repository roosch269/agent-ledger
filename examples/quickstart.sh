#!/usr/bin/env bash
# Self-contained, offline tour of agent-ledger.
#
# It creates a throwaway ledger, records a standing rule, and runs `check` three
# ways to show the three possible verdicts:
#
#   1. UNKNOWN  (exit 3) - no model configured
#   2. STOP     (exit 2) - a bundled fake model blocks the action
#   3. GO       (exit 0) - the fake model allows a harmless action
#
# A tiny bundled fake model (written into the temp dir below) stands in for a real
# model command so this runs with no network and no API key. Run it with:
#
#   bash examples/quickstart.sh
#
# It cleans up after itself and exits 0 on success.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER=(node "$ROOT/bin/ledger.js")

WORK="$(mktemp -d)" || exit 1
trap 'rm -rf "$WORK"' EXIT
export LEDGER_FILE="$WORK/ledger.jsonl"
# Isolate the demo from model configuration and keep all prompt files disposable.
unset LEDGER_MODEL_CMD
export LEDGER_MODEL_TIMEOUT_MS=5000 LEDGER_TZ=UTC LEDGER_LOG_CHECKS=0 TMPDIR="$WORK"

# A fake model command: STOP if the proposed action mentions production, else GO.
# A real command would ask an actual model; the contract is identical.
FAKE_MODEL="$WORK/fake-model.sh"
cat > "$FAKE_MODEL" <<'MODEL'
#!/usr/bin/env bash
# agent-ledger sets ACTION_FILE to the file holding the proposed action.
if grep -qi 'production' "$ACTION_FILE"; then
  printf 'VERDICT: STOP\nWHY: Offline fixture blocks actions mentioning production.\n'
else
  printf 'VERDICT: GO\nWHY: Offline fixture allows this action.\n'
fi
MODEL
chmod +x "$FAKE_MODEL"
export EXAMPLE_MODEL_SCRIPT="$FAKE_MODEL"

hr() { printf '\n=== %s ===\n' "$1"; }

hr "1. Create the ledger"
"${LEDGER[@]}" init || exit 1

hr "2. One agent records a standing rule"
"${LEDGER[@]}" add "Never deploy to production on a Friday." \
  --scope rules --agent agent-a --kind rule || exit 1

hr "3. check with NO model configured -> UNKNOWN (exit 3)"
"${LEDGER[@]}" check "Deploy the new build to production now."
code=$?
printf 'exit: %s\n' "$code"
[ "$code" -eq 3 ] || { echo "FAIL: expected exit 3, got $code" >&2; exit 1; }

hr "4. check with the fake model -> STOP (exit 2)"
LEDGER_MODEL_CMD='bash "$EXAMPLE_MODEL_SCRIPT"' \
  "${LEDGER[@]}" check "Deploy the new build to production now."
code=$?
printf 'exit: %s\n' "$code"
[ "$code" -eq 2 ] || { echo "FAIL: expected exit 2, got $code" >&2; exit 1; }

hr "5. check a harmless action with the fake model -> GO (exit 0)"
LEDGER_MODEL_CMD='bash "$EXAMPLE_MODEL_SCRIPT"' \
  "${LEDGER[@]}" check "Read the project changelog."
code=$?
printf 'exit: %s\n' "$code"
[ "$code" -eq 0 ] || { echo "FAIL: expected exit 0, got $code" >&2; exit 1; }

hr "Done"
echo "All three verdicts behaved as expected. Temporary ledger removed on exit."
