import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/minimax-h3/readiness/route.ts"), "utf8");

assert.match(route, /requireStudioActor/, "runtime state is owner-only");
assert.match(route, /bootstrapSecrets\(undefined, \{ services: \["cloudflare", "novita", "salad"\] \}\)/,
  "the read-only gate loads only its required R2 and worker-service credentials");
assert.match(route, /minimaxH3Readiness/, "the endpoint must report each worker route's admission state");
assert.match(route, /assertMiniMaxH3R2ModelManifest/, "the endpoint must verify the sealed R2 model artifact");
assert.match(route, /paidRequestStarted: false/, "readiness inspection must never create a paid request");
assert.match(route, /Reseal and verify the model pack before enabling H3/, "manifest drift must give a safe remediation");
assert.match(route, /modelPack = message\.includes\("digest does not match"\)/,
  "a transient R2 read failure must not be mislabeled as manifest drift");
assert.match(route, /could not be verified/, "unavailable integrity evidence must hold rather than speculate");
assert.doesNotMatch(route, /process\.env\.(?:MINIMAX_H3|R2_SECRET_ACCESS_KEY)/,
  "the owner API must not emit or directly inspect secret values");
assert.doesNotMatch(route, /tasks\.trigger|fetch\s*\(/, "readiness must remain provider-free and read-only");

console.log("H3 runtime readiness contracts passed");
