# agent-guardrails

Two dependency-free Node hooks that sit in front of an AI coding agent (Claude
Code) and block the handful of shell commands that destroy work or touch
production, before the agent can run them. They run as `PreToolUse` hooks on the
Bash tool. Exit code 2 blocks the command and hands the agent a message so it
picks another route; exit 0 lets it through.

I run these on my own machine in front of agents that operate with broad
permissions. I am publishing them because the honest story behind them is a good
one, and because the design has real, documented limits that are worth showing.

## Why this exists (the true story)

My first attempt at this guard was a bash/python hook. On my Windows box
`python3` resolved to the **Windows Store `python3` stub** (an app-execution
alias that opens the Store, not an interpreter). The hook called it, the call did
nothing useful, and the script fell through to `exit 0`. So the control was
**fail-open**: it looked like a guard and blocked nothing. I only caught it when a
command I expected to be stopped ran anyway.

The fix was to rewrite it as dependency-free Node (`guard.mjs`), which has no
interpreter-resolution surprise, and to **test it** by feeding it real tool-call
payloads and asserting the exit codes. That test suite is in `test/` and is the
main thing this repo demonstrates: a security control you have not tested is a
control you do not have.

## What is here

- `guard.mjs` - reads the PreToolUse JSON on stdin, pulls out the Bash command,
  and blocks a denylist of destructive / production-touching patterns (`rm -rf`,
  `Remove-Item -Recurse -Force`, `git push --force`, `git reset --hard`,
  `git clean -f`, `git filter-branch`, `git branch -D`, `DROP`/`TRUNCATE`,
  `format <drive>`, `vercel --prod`/`promote`, `supabase db reset/push` against
  prod). `--force-with-lease` is deliberately allowed.
- `secrets-guard.mjs` - on a `git commit`, runs `gitleaks` over the staged diff
  (redacted output) and blocks the commit if a secret is found. If gitleaks is not
  installed it is fail-open on purpose, so it never wedges every commit.
- `examples/settings.hooks.json` - how to register both hooks in a Claude Code
  `settings.json`.
- `test/` - a `node:test` suite that feeds JSON payloads on stdin and asserts exit
  codes, including bypass attempts.

## Threat model

These hooks defend against an agent with real shell access doing damage inside a
session. The risks they target:

- **Excessive agency.** The agent can run shell commands; a wrong one is
  destructive. The guard removes the most damaging commands from what the agent
  can actually execute.
- **Irreversible local damage.** `rm -rf`, `git reset --hard`, `git clean -f`,
  history rewrites, drive formats, `DROP`/`TRUNCATE`.
- **Production changes from a session.** `vercel --prod`/`promote`, `supabase db
  reset/push` against prod. Those are run by a human, outside the agent.
- **Secret leakage into git history.** A commit that includes an API key or token;
  `secrets-guard.mjs` scans staged changes before the commit lands.

Out of scope: a genuinely adversarial prompt that is actively trying to defeat the
guard. A regex denylist cannot win that fight (see Limits and Known gaps). The
goal here is to stop accidents and over-eager automation, which is most of the
real risk day to day.

## Mapping to OWASP Top 10 for LLM Applications (2025)

Using the official 2025 list (https://genai.owasp.org/llm-top-10/):

- **LLM06:2025 Excessive Agency** - the core one. The agent's ability to run
  high-impact commands is the hazard; these hooks are an action-level constraint
  on that agency, which the OWASP guidance recommends alongside least-privilege.
- **LLM02:2025 Sensitive Information Disclosure** - `secrets-guard.mjs` keeps
  secrets in staged changes from being committed (and from reaching a remote or
  the session transcript, since output is redacted).
- **LLM05:2025 Improper Output Handling** - the model's output here is a shell
  command that gets executed downstream. Treating that output as untrusted and
  filtering it before execution is exactly this category.

This is a mitigation at the tool boundary, not a full control for any of these
categories.

## Mapping to OWASP Top 10 for Agentic Applications (December 2025)

The agentic list (https://genai.owasp.org/, "OWASP Top 10 for Agentic
Applications", released December 2025) fits this tool more directly, since the
threat is an agent taking actions:

- **ASI02:2025 Tool Misuse and Exploitation** - the central one. An agent using a
  legitimate tool (the shell) to do damage, often from ambiguous instructions or
  over-privileged access. These hooks constrain which shell actions the agent can
  actually carry out.
- **ASI05:2025 Unexpected Code Execution (RCE)** - agents generate and run commands
  to get work done; the guard filters the most dangerous of those before execution.
- **ASI03:2025 Identity and Privilege Abuse** - the production-deploy and
  prod-database rules keep the session from acting with privilege it should not use
  unattended; those actions are left to a human. (Defence in depth only; the real
  control is not giving the session prod credentials.)
- **ASI09:2025 Human-Agent Trust Exploitation** - a blocked command returns a clear
  message rather than silently failing, so the human is not lulled into trusting an
  action that did not happen the way it looked.

Category titles follow the wording of the December 2025 release; verify against the
current OWASP document before relying on them.

## Limits of a regex denylist

A denylist of command patterns is a blunt instrument, and I want to be clear about
that:

- **It is a denylist, not an allowlist.** Anything not listed passes. New
  destructive commands are not covered until a rule is added.
- **Shell has many ways to say the same thing.** Aliases, flag spellings, variable
  indirection, quoting, encoding, and line continuations all change the text
  without changing the effect. A regex sees text.
- **It cannot reason about intent.** `git reset --hard` on a throwaway branch is
  fine; on `main` with unpushed work it is not. The guard blocks both.
- **Fail-open vs fail-closed is a real trade-off.** On malformed input these hooks
  exit 0 so they never wedge the agent. That is the right call for a convenience
  guard and the wrong call for a hard security boundary. For a hard boundary you
  want least-privilege (a restricted shell, a non-prod credential set, no prod
  access from the session at all), with this as defence in depth on top.

## Known gaps

These are **confirmed bypasses** against the current `guard.mjs`. They are real:
each one is reproduced by a `todo` test in `test/guard.test.mjs`, so `node --test`
lists them without failing. I am leaving them visible rather than quietly patching
them, because understanding and fixing them myself is the point.

| # | Bypass (exact command) | Why it slips through |
|---|---|---|
| 1 | `rm -r -f /tmp/project` | the `rm` rule needs `r` and `f` in one flag token; separate `-r -f` is not matched |
| 2 | `rm --recursive --force /tmp/project` | long-form flags are not in the pattern |
| 3 | `rm -rfv /tmp/project` | the `\b` anchor after `f` means a combined token with a trailing letter (`-rfv`) is not matched |
| 4 | `git -c protocol.version=2 reset --hard HEAD~1` | the git rules expect `git` immediately followed by the subcommand; an option in between defeats them (applies to push/reset/clean/branch) |
| 5 | `F=--force; git push $F` | variable indirection; the literal `--force` never appears in the matched text |
| 6 | `git push origin main \`<newline>`--force` | the `[^|;\n]*` window stops at a newline, so a flag on the next line is outside it |
| 7 | `supabase db reset --linked` | the supabase rule keys on the literal word `prod`; a reset pointed at a prod project without that word is missed |

The fixes (normalising whitespace and flags, tokenising the command instead of
regex-scanning raw text, and resolving simple variable assignments) are the next
iteration. Until then, treat the guard as a seatbelt against accidents, not a wall
against an attacker.

## Run the tests

```
node --test
```

Node 22+ required. Current result: 37 passing, 0 failing, 7 todo (the known gaps
above). The `secrets-guard` tests cover routing; the gitleaks scan itself is
exercised only when gitleaks is installed.

## Install

Copy `guard.mjs` and `secrets-guard.mjs` into your Claude Code config directory
(for example a `hooks/` folder next to `settings.json`) and register them as in
`examples/settings.hooks.json`. `secrets-guard.mjs` additionally needs `gitleaks`
on PATH to do anything; without it, it is fail-open.
