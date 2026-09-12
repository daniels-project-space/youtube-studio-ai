import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'fail-open-strings-'));
try {
  mkdirSync(join(scratch, 'src'));
  writeFileSync(join(scratch, 'src', 'gates.ts'), `
async function namedJudge() {
  try { await claudeJson({prompt: 'judge'}); }
  catch (e) {
    if (e.outcome === "unknown") throw e;
    const detail = String(e);
    log(\`JUDGE FAILED: \${detail}\`);
    return false;
  }
}
async function silentJudge() {
  try { await claudeJson({prompt: 'judge'}); }
  catch { const label = "short"; return { passed: true }; }
}
async function commentOnlyJudge() {
  try { await claudeJson({prompt: 'judge'}); }
  catch {
    // JUDGE FAILED — a comment is not a diagnostic.
    return { passed: true };
  }
}
`);
  const result = spawnSync(join(root, 'node_modules/.bin/tsx'), [join(root, 'scripts/audit-fail-open-gates.ts')], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AUDIT_FINDINGS 2\b/);
  assert.doesNotMatch(result.stdout, /\[namedJudge\]/, 'A short quoted value must not hide an actual FAILED diagnostic');
  assert.match(result.stdout, /\[silentJudge\]/);
  assert.match(result.stdout, /\[commentOnlyJudge\]/, 'Comments cannot masquerade as runtime failure diagnostics');
  console.log('FAIL-OPEN AUDIT STRING PASS — exact executable audit distinguishes diagnostics from code and comments');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
