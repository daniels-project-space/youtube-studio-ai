import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.doesNotMatch(source, /authorizeStudioRoute/, "read-only capability status must remain available before owner verification");
assert.match(source, /certifiedFamilyAdmission\(family\)\.automatic/, "only existing automatic families may receive this status");
assert.match(source, /assessAutomaticFamilyExecutionReadiness\(family\)/, "the UI endpoint must use the same no-spend renderer gate as inception");
assert.match(source, /Cache-Control.*no-store/, "runtime capability state must never be served from a stale cache");
assert.doesNotMatch(source, /API_KEY|SECRET_KEY|process\.env/, "the creator status endpoint must not expose credentials");
assert.doesNotMatch(source, /request: Request/, "the read-only route must not imply a discarded authentication boundary");

console.log("Automatic family readiness route contract tests passed");
