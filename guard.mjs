// ~/.claude/hooks/guard.mjs — the global last line of defence. Dependency-free Node (22+).
// Runs as a PreToolUse hook on Bash. Blocks the handful of commands that destroy work or
// touch production from inside a session. Everything else passes. Exit 2 = block (Claude
// sees the message and must choose another route); exit 0 = allow.
//
// Replaces the April-2026 bash/python3 hook, which called the Windows Store `python3` stub
// and fell back to `exit 0`, so it never blocked anything.
//
// Project hooks (cartdune/.claude/hooks/guard.sh, Homitski-OS/.claude/hooks/guard-vault.mjs)
// still run; this file only covers what every repo shares.

import { readFileSync } from 'node:fs';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let cmd = '';
try {
  const input = JSON.parse(raw || '{}');
  cmd = String(input?.tool_input?.command ?? '');
} catch {
  process.exit(0);
}

const rules = [
  [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/, 'rm -rf'],
  [/\bRemove-Item\b[^|;\n]*-Recurse[^|;\n]*-Force|\bRemove-Item\b[^|;\n]*-Force[^|;\n]*-Recurse/i, 'Remove-Item -Recurse -Force'],
  [/\bgit\s+push\b[^|;\n]*(--force(?!-with-lease)\b|\s-f\b)/, 'git push --force'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'git clean -f'],
  [/\bgit\s+filter-branch\b/, 'git filter-branch'],
  [/\bgit\s+branch\s+-D\b/, 'git branch -D'],
  [/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, 'DROP / TRUNCATE'],
  [/\bformat\s+[a-zA-Z]:/i, 'format <drive>'],
  [/\bvercel\b[^|;\n]*(--prod\b|\bpromote\b)/, 'vercel --prod / promote (production deploys are run by Daniel from PowerShell)'],
  [/\bsupabase\s+db\s+(reset|push)\b[^|;\n]*prod/i, 'supabase db reset/push against prod'],
];

for (const [re, name] of rules) {
  if (re.test(cmd)) {
    console.error(`[guard] blocked: ${name}.\nIf this is really wanted, Daniel runs it himself from PowerShell.\n> ${cmd}`);
    process.exit(2);
  }
}

process.exit(0);
