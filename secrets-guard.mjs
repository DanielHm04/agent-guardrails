// ~/.claude/hooks/secrets-guard.mjs — PreToolUse on Bash. When the command is a `git commit`,
// scan the staged changes with gitleaks first and block the commit if a secret is found.
// Output is redacted, so the secret never lands in the session transcript. Dependency-free Node.
// gitleaks: scoop install gitleaks (8.30.1 on 2026-10-17). If gitleaks is missing, the hook lets
// the commit through rather than blocking all commits.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let cmd = '';
try {
  cmd = String(JSON.parse(readFileSync(0, 'utf8') || '{}')?.tool_input?.command ?? '');
} catch {
  process.exit(0);
}

if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const r = spawnSync(
  'gitleaks',
  ['git', '--pre-commit', '--staged', '--no-banner', '--redact', '--exit-code', '9'],
  { encoding: 'utf8', cwd, shell: true, timeout: 20000 },
);

if (r.error || r.status === null) process.exit(0); // gitleaks missing or timed out: do not block
if (r.status === 9) {
  console.error(
    '[secrets-guard] gitleaks found a secret in the staged changes; the commit is blocked.\n' +
      'Move the value to .env (git-ignored), unstage the file, and commit again.\n' +
      (r.stdout || '') + (r.stderr || ''),
  );
  process.exit(2);
}
process.exit(0);
