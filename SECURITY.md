# Security Policy

## Supported versions

`agent-ledger` is at an early stage. Security fixes are provided for the current `0.1.x`
line only.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub Security Advisories:

1. Go to the repository's **Security** tab:
   <https://github.com/roosch269/agent-ledger/security>
2. Choose **Report a vulnerability** if private reporting is enabled. Reports are shared
   with maintainers and any collaborators they invite.
3. Include affected version(s), a description, reproduction steps or a proof of concept,
   and the impact as you see it.

We aim to acknowledge a report within a few days and will coordinate a fix and disclosure
timeline with you. Please give us a reasonable chance to release a fix before any public
disclosure.

## Scope

`agent-ledger` runs model commands and renders a shared, potentially agent-written ledger
into a prompt. The configured shell command runs with the caller's permissions and
may send the full ledger to its provider; use only a trusted command. Reports in these
areas are especially welcome:

- **Prompt injection via claims, evidence or action text.** Ledger and action content are
  passed to the model as data, and embedded `VERDICT` markers with optional whitespace
  before `:` are neutralised. If you can make a crafted entry or action reliably flip a verdict (particularly turning a correct
  `STOP` into a `GO`) past these defences, that is in scope.
- Causing `check` to emit `GO` on invocation, timeout, parse or model failure (it must
  always be `UNKNOWN` instead).
- Flaws in the file locking that let concurrent writers corrupt or lose ledger entries.
- Path handling, the model-command invocation, or temp-file handling (e.g. leaking the
  prompt or ledger contents) that lead to unintended file access or disclosure.

## Out of scope

- `agent-ledger` is **not an access-control or security boundary.** Anyone who can write
  the ledger file can alter the data used to reach a verdict; that is by design and
  documented in the README. Reports that rely only on already having write access to the ledger or its
  directory are out of scope.
- A model simply returning a wrong-but-well-formed verdict (model quality, not a
  vulnerability).
