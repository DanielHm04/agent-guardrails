# Security notes

These are convenience guardrails, not a hard security boundary. They reduce the
blast radius of an AI coding agent that has shell access; they do not contain an
adversary who is actively trying to defeat them.

- The guard is a **denylist** of command patterns. Anything not listed passes.
  Known bypasses are documented in the README "Known gaps" section and reproduced
  as `todo` tests.
- Both hooks are **fail-open on malformed input** (exit 0) so they never wedge the
  agent. For a hard boundary, combine them with least-privilege: a restricted
  shell, non-production credentials in the session, and no production access from
  the agent at all.
- `secrets-guard.mjs` redacts gitleaks output so a detected secret never lands in
  the session transcript. It is fail-open if gitleaks is not installed.

## Reporting
Found another bypass? Open an issue with the exact command string and the expected
vs actual exit code. Do not include real secrets or credentials in the report.
