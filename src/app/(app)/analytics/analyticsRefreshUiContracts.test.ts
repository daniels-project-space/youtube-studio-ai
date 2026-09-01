import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/analytics/page.tsx"), "utf8");
const query = readFileSync(join(root, "convex/analytics.ts"), "utf8");

// Analytics health must be driven by the owner-scoped connector/cursor
// projection, not by browser guesses or the obsolete global API-key message.
assert.match(page, /useQuery\(api\.analytics\.refreshStatus, \{ ownerId \}\)/);
assert.match(page, /Source integrity/);
assert.match(page, /Can these observations be trusted/);
assert.match(page, /analyticsRefreshHealth\(row\)/);
assert.match(page, /analyticsRefreshFleetHealth\(rows\)/);
assert.match(page, /Fleet refresh ledger/);
assert.match(page, /Review connections/);
assert.match(page, /\/channels\/\$\{row\.slug\}\?tab=settings/);
assert.doesNotMatch(page, /YouTube Data API key/);

// Portfolio comparison is categorical, so it must use ranked bars rather than
// drawing a misleading continuous line between unrelated channels.
assert.match(page, /function FleetComparison/);
assert.match(page, /className=\{styles\.rankingBar\}/);
assert.doesNotMatch(page, /function GlobalCharts/);
assert.doesNotMatch(page, /Subscribers by channel/);
assert.match(page, /Reach \/ spend field/);
assert.match(page, /Cumulative views/);
assert.match(page, /Published inventory/);
assert.doesNotMatch(page, /<PageHeader/);

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
