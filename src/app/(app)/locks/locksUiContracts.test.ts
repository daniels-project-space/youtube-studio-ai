import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/locks/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/(app)/locks/locks.module.css"), "utf8");

assert.match(page, /api\.ownerModuleLocks\.list/);
assert.match(page, /OwnerLockBadge/);
assert.match(page, /Protected at the source/);
assert.match(page, /groupLabel/);
assert.match(page, /function groupFor/);
assert.match(page, /<details className=\{styles\.group\}/);
assert.doesNotMatch(page, /Claude, Codex/);
assert.doesNotMatch(page, /style=\{/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /grid-template-columns: repeat\(2/);

console.log("Owner lock surface UI contracts passed");
