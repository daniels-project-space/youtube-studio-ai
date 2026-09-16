import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "convex/automaticOperationsDigests.ts"), "utf8");
assert.match(source, /requireStudioServiceIdentity/);
assert.match(source, /by_owner_week/);
assert.match(source, /digest changed after snapshot/);
assert.match(source, /return \{ reused: true/);
console.log("automatic operations digest persistence contracts passed");
