import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const channels = readFileSync(join(root, "src/app/(app)/channels/page.tsx"), "utf8");
const detail = readFileSync(join(root, "src/app/(app)/channels/[slug]/page.tsx"), "utf8");

// The compact channel list and the detailed setup view must agree: only a
// verified destination with every requested scope is allowed to look ready.
assert.match(channels, /link\.scopeHealth === "healthy"/);
assert.match(channels, /OAuth scopes unverified/);
assert.doesNotMatch(channels, /link\.scopeHealth !== "partial"/);

// The detail surface uses the shared fail-closed state model, keeps profile
// setup an owner handoff, and withholds a second irreversible create once any
// target or connector is recorded.
assert.match(detail, /assessYouTubeSetup/);
assert.match(detail, /YouTube setup checklist/);
assert.match(detail, /setup\.canAutoCreate/);
assert.match(detail, /Set profile picture in YouTube/);
assert.match(detail, /Google does not provide this integration a reliable completion receipt/);
assert.match(detail, /setup\.oauth === "ready"/);

console.log("YouTube setup UI contracts passed");
