import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/(app)/golden/GoldenImages.tsx"), "utf8");

assert.match(source, /aria-labelledby=\{titleId\}/);
assert.match(source, /aria-describedby=\{evidenceId\}/);
assert.match(source, /dialogRef\.current\?\.querySelectorAll/);
assert.match(source, /closeRef\.current\?\.focus\(\)/);
assert.match(source, /openerRef\.current\?\.focus\(\)/);
assert.match(source, /e\.key !== "Tab"/);

console.log("Golden image viewer accessibility contracts passed");
