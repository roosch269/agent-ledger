# Model commands

`agent-ledger`'s `check` is provider-neutral: it does not call any vendor API itself.
Instead you set `LEDGER_MODEL_CMD` (or pass `--model-cmd`) to **any shell command**, and
`agent-ledger` runs it once per check when the command and timeout are configured correctly.

## The contract (recap)

On each `check`, `agent-ledger`:

- writes the **complete prompt to the command's stdin**;
- exports `PROMPT_FILE`, `DECISIONS_FILE` and `ACTION_FILE` in the environment, each
  holding one part of the prompt as a file (use stdin, the files, or both);
- reads the command's **stdout**, which must contain exactly one line
  `VERDICT: STOP` or `VERDICT: GO`, optionally followed by one `WHY:` line.

Anything else — no command, an invalid timeout, a non-zero exit, a timeout
(`LEDGER_MODEL_TIMEOUT_MS`, default `120000` ms), output over 1 MiB, zero/multiple
verdict lines, or extra text — becomes **UNKNOWN**, never a fallback GO. Surrounding
Markdown bold (`**`), backticks, and an unlabelled or `text` code fence around the
whole reply are tolerated. Timeouts must be integers from 1 to 2147483647 ms.

Full details are in the [README](../README.md#the-model-command-contract).

> The Claude Code and Codex commands below are the ones we tested. The local and HTTP
> patterns are **examples, not tested by us**. Adjust
> the binary name, model and flags to your environment, and make sure the tool prints the
> verdict (and nothing else) to stdout. Keep API keys in environment variables, never in
> the ledger.

## Claude Code CLI

Tested by us with Claude Code 2.1 (the README results use this form):

```bash
export LEDGER_MODEL_CMD="claude -p --model sonnet --tools ''"
```

`-p` reads the prompt from stdin and prints only the final reply. `--tools ''` disables
tool use, so the model answers from the prompt alone. Swap `sonnet` for any model your
plan offers.

## OpenAI Codex CLI

Tested by us with Codex CLI 0.163 (the README results use this wrapper):

```bash
export LEDGER_MODEL_CMD="$PWD/examples/codex-model.sh"
export CODEX_MODEL=<model-id>   # optional
export CODEX_EFFORT=low         # optional, default low
```

[`codex-model.sh`](codex-model.sh) runs `codex exec` read-only and ephemeral, sends
progress output away, and prints only the final message, so the verdict parser sees
nothing else. A bare `codex exec` also prints session output, which may make the
verdict unparsable (UNKNOWN).

## Local models

Via [Ollama](https://ollama.com):

```bash
export LEDGER_MODEL_CMD='ollama run llama3.1'
```

Via the [`llm`](https://llm.datasette.io) CLI (works with local or hosted models):

```bash
export LEDGER_MODEL_CMD='llm'
# or pin a model supported by your installation: llm -m <model-id>
```

These patterns expect stdin input and completion text on stdout. Model availability
and flags depend on your installation.

## Generic HTTP (any OpenAI-compatible endpoint)

Requires Bash, `jq` and `curl` in addition to Node. Save this as `my-model-http.sh`.
It JSON-encodes stdin, sends it to the endpoint, and fails if any pipeline stage fails:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${OPENAI_BASE_URL:?Set the API base URL}"
: "${OPENAI_API_KEY:?Set the API key}"
: "${MODEL_ID:?Set a model supported by the endpoint}"
jq -Rs --arg model "$MODEL_ID" '{model:$model,messages:[{role:"user",content:.}]}' \
  | curl --fail-with-body -sS "${OPENAI_BASE_URL%/}/chat/completions" \
      -H "Authorization: Bearer $OPENAI_API_KEY" -H 'Content-Type: application/json' -d @- \
  | jq -er '.choices[0].message.content | select(type == "string" and length > 0)'
```

```bash
export LEDGER_MODEL_CMD='bash /path/to/my-model-http.sh'
```

Set `OPENAI_BASE_URL` (the API base URL including any `/v1` prefix), `OPENAI_API_KEY`
and `MODEL_ID` first. This is an untested endpoint pattern; verify the provider's request
and response format. The full ledger is sent to that provider.

## Wrapping a command in a script

For anything non-trivial, put the command in a small script and point
`LEDGER_MODEL_CMD` at it. The script can read the prompt from stdin or from the exported
files:

```bash
#!/usr/bin/env bash
# my-model.sh — read the prompt from stdin, print one VERDICT line to stdout.
prompt="$(cat)"                 # or read all three exported prompt files
# ... call your model with "$prompt" ...
# Ensure stdout ends up as exactly:
#   VERDICT: <STOP|GO>
#   WHY: <short reason>
```

```bash
export LEDGER_MODEL_CMD='bash /path/to/my-model.sh'
```

## Testing your command offline

The repository ships a fake model you can use to verify the wiring without any network:

```bash
# Run from the repository root. These fixtures do not judge the action.
export LEDGER_MODEL_CMD='node test/fixtures/fake-model.mjs stop'   # always STOP
export LEDGER_MODEL_CMD='node test/fixtures/fake-model.mjs go'     # always GO
```

See [`quickstart.sh`](quickstart.sh) for a complete offline run.
