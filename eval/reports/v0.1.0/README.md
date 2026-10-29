# v0.1.0 eval reports

Raw `npm run eval` output for the four runs quoted in the main README (29 October 2026,
one run per model, run in parallel on one machine; latency includes CLI start-up).

| File | Model command |
| --- | --- |
| `claude-sonnet.json` | `claude -p --model sonnet --tools ''` (Claude Code 2.1) |
| `claude-haiku.json` | `claude -p --model haiku --tools ''` (Claude Code 2.1) |
| `codex-gpt-6.1-sol-medium.json` | `examples/codex-model.sh` with `CODEX_MODEL=gpt-6.1-sol CODEX_EFFORT=medium` (Codex CLI 0.163) |
| `codex-gpt-6-luna-low.json` | `examples/codex-model.sh` with `CODEX_MODEL=gpt-6-luna CODEX_EFFORT=low` (Codex CLI 0.163) |
