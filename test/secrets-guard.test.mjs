// Tests for secrets-guard.mjs. This hook only acts on `git commit`; for anything
// else it exits 0 immediately. When it does act, it shells out to gitleaks, so
// these tests cover the routing (what triggers a scan) rather than gitleaks itself.
// If gitleaks is not installed the hook is fail-open (exit 0) by design, so the
// commit-path test asserts "not blocked-without-reason" rather than a fixed code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'secrets-guard.mjs');

function run(command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const r = spawnSync('node', [HOOK], { input: payload, encoding: 'utf8' });
  return r.status;
}

// non-commit commands are passed through untouched
for (const cmd of ['ls -la', 'git status', 'git add .', 'npm test', '']) {
  test(`ignores non-commit command: ${JSON.stringify(cmd)}`, () => {
    assert.equal(run(cmd), 0);
  });
}

test('malformed JSON exits 0 (fail-open on bad input)', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});

// A `git commit` triggers the gitleaks path. Outcome depends on whether gitleaks
// is installed and whether there are staged secrets; both the "missing gitleaks"
// and "clean tree" cases exit 0. We assert it does not crash and returns a valid
// hook exit code (0 allow or 2 block), never an unexpected code.
test('git commit routes into the scan path and returns a valid hook code', () => {
  const code = run('git commit -m "test"');
  assert.ok(code === 0 || code === 2, `unexpected exit code ${code}`);
});
