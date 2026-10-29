#!/usr/bin/env python3
"""Call agent-ledger's `check` from Python using only the standard library.

This shows the universal integration pattern: run `check --json`, read the JSON
payload, and branch on the *exit code* (0 = GO, 2 = STOP, 3 = UNKNOWN). An agent
should proceed only on GO; UNKNOWN and STOP both mean "do not act".

Run the self-test (offline, uses the repository's bundled fake model):

    python3 examples/python_agent.py

Requires Node.js >= 20 and Python 3.8+.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LEDGER_BIN = REPO_ROOT / "bin" / "ledger.js"

# Exit codes are the contract. See the README's "Exit codes" table.
GO, STOP, UNKNOWN = 0, 2, 3


@dataclass
class Verdict:
    verdict: str          # "GO", "STOP" or "UNKNOWN"
    why: str              # model explanation, or the reason for UNKNOWN
    code: int             # process exit code
    data: dict            # the full {ok, command, data} -> data payload

    @property
    def is_go(self) -> bool:
        return self.code == GO


def check(action: str, *, ledger_file: str | None = None,
          env: dict | None = None) -> Verdict:
    """Run `ledger check <action> --json` and return a parsed Verdict."""
    cmd = ["node", str(LEDGER_BIN), "check", action, "--json"]
    if ledger_file:
        cmd += ["--file", ledger_file]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    # Both success and error JSON go to stdout/stderr respectively; `check`
    # prints its JSON payload to stdout even for STOP/UNKNOWN.
    payload = json.loads(proc.stdout) if proc.stdout.strip() else {}
    data = payload.get("data", {})
    error = json.loads(proc.stderr).get("error", {}) if not payload and proc.stderr.strip() else {}
    return Verdict(
        verdict=data.get("verdict", "UNKNOWN"),
        why=data.get("why") or data.get("reason") or error.get("message", ""),
        code=proc.returncode,
        data=data,
    )


def guard(action: str, **kwargs) -> bool:
    """Return True only when the ledger returns GO; other checks may still apply."""
    v = check(action, **kwargs)
    print(f"{v.verdict}: {action}\n  -> {v.why}")
    return v.is_go


def _self_test() -> int:
    """Set up a throwaway ledger and exercise GO, STOP and UNKNOWN."""
    fake_model = f"node {shlex.quote(str(REPO_ROOT / 'test' / 'fixtures' / 'fake-model.mjs'))}"
    with tempfile.TemporaryDirectory() as tmp:
        ledger_file = os.path.join(tmp, "ledger.jsonl")
        base_env = {k: v for k, v in os.environ.items() if not k.startswith("LEDGER_")}
        base_env.update(TMPDIR=tmp, LEDGER_MODEL_TIMEOUT_MS="5000", LEDGER_TZ="UTC")
        subprocess.run(["node", str(LEDGER_BIN), "init", "--file", ledger_file],
                       check=True, capture_output=True, text=True, env=base_env)
        subprocess.run(["node", str(LEDGER_BIN), "add",
                        "Never deploy to production on a Friday.",
                        "--scope", "rules", "--agent", "agent-a",
                        "--file", ledger_file],
                       check=True, capture_output=True, text=True, env=base_env)

        go_env = {**base_env, "LEDGER_MODEL_CMD": f"{fake_model} go"}
        stop_env = {**base_env, "LEDGER_MODEL_CMD": f"{fake_model} stop"}
        no_model_env = {k: v for k, v in base_env.items()
                        if k != "LEDGER_MODEL_CMD"}

        print("== UNKNOWN (no model) ==")
        unknown = check("Deploy to production now.",
                        ledger_file=ledger_file, env=no_model_env)
        print(f"  verdict={unknown.verdict} code={unknown.code}")
        assert unknown.verdict == "UNKNOWN" and unknown.code == UNKNOWN

        print("== STOP ==")
        stop = check("Deploy to production now.",
                     ledger_file=ledger_file, env=stop_env)
        print(f"  verdict={stop.verdict} code={stop.code}")
        assert stop.verdict == "STOP" and stop.code == STOP

        print("== GO ==")
        go = check("Read the project changelog.",
                   ledger_file=ledger_file, env=go_env)
        print(f"  verdict={go.verdict} code={go.code}")
        assert go.verdict == "GO" and go.code == GO

        print("== Storage error (blocked) ==")
        Path(ledger_file).write_text("{}\n", encoding="utf-8")
        error = check("Read the project changelog.", ledger_file=ledger_file, env=go_env)
        print(f"  verdict={error.verdict} code={error.code}")
        assert not error.is_go and error.code == 1 and "id" in error.why

        print("\nAll verdicts behaved as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(_self_test())
