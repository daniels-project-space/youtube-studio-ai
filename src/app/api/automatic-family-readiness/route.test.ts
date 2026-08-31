import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /authorizeStudioRoute\(request\)/, "live capability availability must remain owner-session protected");
assert.match(source, /certifiedFamilyAdmission\(family\)\.automatic/, "only existing automatic families may receive this status");
assert.match(source, /assessAutomaticFamilyExecutionReadiness\(family\)/, "the UI endpoint must use the same no-spend renderer gate as inception");
assert.match(source, /Cache-Control.*no-store/, "runtime capability state must never be served from a stale cache");
assert.doesNotMatch(source, /API_KEY|SECRET_KEY|process\.env/, "the creator status endpoint must not expose credentials");

console.log("Automatic family readiness route contract tests passed");
