// Tests for guard.mjs. Feeds a PreToolUse JSON payload on stdin and asserts the
// hook's exit code: 2 means blocked, 0 means allowed.
//
// Run:  node --test
//
// The `todo` tests at the bottom are known bypasses. They are documented in the
// README "Known gaps" section. They are marked todo on purpose: the hook does NOT
// block them today, and the point is to understand and fix them, not to hide them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'guard.mjs');

// run guard.mjs with a command string, return its exit code
function runGuard(command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const r = spawnSync('node', [GUARD], { input: payload, encoding: 'utf8' });
  return r.status;
}

const BLOCK = 2;
const ALLOW = 0;

// ---- commands that must be blocked ----
const blocked = [
  ['rm -rf', 'rm -rf /tmp/project'],
  ['rm -fr (reordered single token)', 'rm -fr /tmp/project'],
  ['Remove-Item -Recurse -Force', 'Remove-Item -Recurse -Force C:/tmp'],
  ['Remove-Item -Force -Recurse (reordered)', 'Remove-Item -Force -Recurse C:/tmp'],
  ['git push --force', 'git push --force'],
  ['git push -f', 'git push -f origin main'],
  ['git push --force after subcommand', 'git push origin main --force'],
  ['git reset --hard', 'git reset --hard HEAD~3'],
  ['git clean -f', 'git clean -fdx'],
  ['git filter-branch', 'git filter-branch --tree-filter x HEAD'],
  ['git branch -D', 'git branch -D feature/x'],
  ['DROP TABLE', 'psql -c "DROP TABLE users"'],
  ['TRUNCATE TABLE', 'psql -c "TRUNCATE TABLE sessions"'],
  ['DROP DATABASE lowercase', 'mysql -e "drop database app"'],
  ['format drive', 'format C:'],
  ['vercel --prod', 'vercel deploy --prod'],
  ['vercel promote', 'vercel promote dpl_123'],
  ['supabase db reset prod', 'supabase db reset --db-url postgres://prod'],
];

for (const [name, cmd] of blocked) {
  test(`blocks: ${name}`, () => {
    assert.equal(runGuard(cmd), BLOCK, `expected block for: ${cmd}`);
  });
}

// ---- commands that must be allowed ----
const allowed = [
  ['plain rm of one file', 'rm notes.txt'],
  ['ls', 'ls -la'],
  ['git status', 'git status'],
  ['git push (normal)', 'git push origin main'],
  ['git push --force-with-lease MUST pass', 'git push --force-with-lease origin main'],
  ['git commit', 'git commit -m "fix"'],
  ['git reset (soft, no --hard)', 'git reset --soft HEAD~1'],
  ['npm run build', 'npm run build'],
  ['a SELECT, not a DROP', 'psql -c "SELECT * FROM users"'],
  ['vercel dev (not prod)', 'vercel dev'],
  ['empty command', ''],
];

for (const [name, cmd] of allowed) {
  test(`allows: ${name}`, () => {
    assert.equal(runGuard(cmd), ALLOW, `expected allow for: ${cmd}`);
  });
}

// ---- malformed input is fail-open by design (never wedge the agent) ----
test('malformed JSON exits 0 (fail-open on bad input)', () => {
  const r = spawnSync('node', [GUARD], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, ALLOW);
});

// ---------------------------------------------------------------------------
// KNOWN GAPS. These are real bypasses confirmed against the current guard.mjs.
// They are `todo` so `node --test` reports them without failing the suite. Each
// one is a thing I need to fix in the regexes. See README "Known gaps".
// ---------------------------------------------------------------------------

test('GAP: rm with separate flags "-r -f" is not blocked', { todo: true }, () => {
  // regex requires r and f in one flag token; "-r -f" slips through
  assert.equal(runGuard('rm -r -f /tmp/project'), BLOCK);
});

test('GAP: rm with long flags "--recursive --force" is not blocked', { todo: true }, () => {
  assert.equal(runGuard('rm --recursive --force /tmp/project'), BLOCK);
});

test('GAP: rm combined flag with a trailing letter "-rfv" is not blocked', { todo: true }, () => {
  // the \b anchor after f means a combined token like -rfv (f not at a boundary) slips through
  assert.equal(runGuard('rm -rfv /tmp/project'), BLOCK);
});

test('GAP: git option before subcommand bypasses the git rules', { todo: true }, () => {
  // "git -c key=val reset --hard" -- the rules expect "git" directly followed by the subcommand
  assert.equal(runGuard('git -c protocol.version=2 reset --hard HEAD~1'), BLOCK);
});

test('GAP: variable indirection hides the --force flag', { todo: true }, () => {
  assert.equal(runGuard('F=--force; git push $F'), BLOCK);
});

test('GAP: a newline before the flag escapes the [^|;\\n]* window', { todo: true }, () => {
  assert.equal(runGuard('git push origin main \\\n--force'), BLOCK);
});

test('GAP: supabase reset against prod without the literal "prod" is not blocked', { todo: true }, () => {
  // the rule keys on the word "prod"; "--linked" pointing at a prod project is missed
  assert.equal(runGuard('supabase db reset --linked'), BLOCK);
});
