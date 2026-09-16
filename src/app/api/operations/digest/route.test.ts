import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/app/api/operations/digest/route.ts"), "utf8");
assert.match(source, /requireStudioActor/);
assert.match(source, /api\.runs\.listRecent/);
assert.match(source, /buildWeeklyOperationsDigest/);
assert.match(source, /Cache-Control.*private, no-store/);
assert.doesNotMatch(source, /tasks\.trigger|mutation\(/, "the digest is read-only and must never dispatch work");
console.log("automatic operations digest route contracts passed");
