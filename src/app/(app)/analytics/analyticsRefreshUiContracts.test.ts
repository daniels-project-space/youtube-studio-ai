import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/analytics/page.tsx"), "utf8");
const query = readFileSync(join(root, "convex/analytics.ts"), "utf8");

// Analytics health must be driven by the owner-scoped connector/cursor
// projection, not by browser guesses or the obsolete global API-key message.
assert.match(page, /useQuery\(api\.analytics\.refreshStatus, \{ ownerId \}\)/);
assert.match(page, /Analytics data health/);
assert.match(page, /analyticsRefreshHealth\(row\)/);
assert.match(page, /analyticsRefreshFleetHealth\(rows\)/);
assert.match(page, />All channels</);
assert.match(page, /Review channel connections/);
assert.match(page, /\/channels\/\$\{row\.slug\}\?tab=settings/);
assert.doesNotMatch(page, /YouTube Data API key/);

const operationsCheck = page.indexOf('fetch("/api/operations/elevation"');
const ownerLearningRead = page.indexOf('fetch("/api/learning-recommendations"');
assert.ok(operationsCheck >= 0, "analytics checks operations access before owner-only learning reads");
assert.ok(ownerLearningRead > operationsCheck, "viewer mode cannot request owner-only learning governance");
assert.match(page, /state: "locked"/);

// The public query uses the authenticated studio wrapper, scopes both primary
// rows by owner, and returns an explicit token-free/error-free projection.
assert.match(query, /import \{ mutation, query \} from "\.\/studioFunctions"/);
assert.match(query, /export const refreshStatus = query\(/);
assert.match(query, /\.withIndex\("by_owner", \(q\) => q\.eq\("ownerId", args\.ownerId\)\)/);
assert.match(query, /progressRow\?\.ownerId === args\.ownerId/);

const refreshProjectionStart = query.indexOf("export const refreshStatus");
const refreshProjectionEnd = query.indexOf("export const ownerTrends");
assert.ok(refreshProjectionStart >= 0, "refresh status query is present");
assert.ok(refreshProjectionEnd > refreshProjectionStart, "refresh status projection boundary is present");
const refreshProjection = query.slice(refreshProjectionStart, refreshProjectionEnd);
assert.ok(refreshProjection.length > 0, "refresh status projection is present");
assert.doesNotMatch(refreshProjection, /refreshToken|refreshTokenCiphertext|lastError|grantedScopes/);

console.log("Analytics refresh UI contracts passed");
