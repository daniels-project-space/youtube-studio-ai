import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(join(root, "convex/videos.ts"), "utf8");
const bounded = readFileSync(join(root, "src/lib/boundedConvexReads.ts"), "utf8");
const schema = readFileSync(join(root, "convex/schema.ts"), "utf8");

const start = source.indexOf("export const listVideosPage = query(");
assert.ok(start >= 0, "the cursor-backed Library query remains exposed");
const pageQuery = source.slice(start).split("\nexport const librarySummary")[0]!;

// Cursor boundaries are owned by Convex's index paginator, not by a hidden
// collect/slice fallback. The result must return the paginator cursor exactly
// so the next page cannot restart or skip a boundary.
assert.match(pageQuery, /paginationOpts: paginationOptsValidator/);
assert.match(pageQuery, /\.paginate\(args\.paginationOpts\)/);
assert.match(pageQuery, /return \{[\s\S]*\.\.\.runPage,[\s\S]*page:/);
assert.doesNotMatch(pageQuery, /runPage\.page\.slice/);
assert.match(pageQuery, /withIndex\("by_owner_library_order"/);
assert.match(pageQuery, /withIndex\("by_channel_library_order"/);
assert.match(pageQuery, /if \(missingOrder\) throw new Error/);
assert.match(schema, /libraryOrderAt: v\.optional\(v\.number\(\)\)/);
assert.match(schema, /\.index\("by_owner_library_order", \["ownerId", "libraryOrderAt"\]\)/);
assert.match(schema, /\.index\("by_channel_library_order", \["channelId", "libraryOrderAt"\]\)/);

// Migration is bounded, idempotent, service-only, and cannot modify the
// execution timestamp that existing run recovery and cadence logic rely on.
const migration = source.slice(source.indexOf("export const backfillLibraryOrderPage"), source.indexOf("export const librarySummary"));
assert.match(migration, /requireStudioServiceIdentity/);
assert.match(migration, /\.take\(65\)/);
assert.match(migration, /\.slice\(0, 64\)/);
assert.match(migration, /libraryOrderAt: libraryRunCreatedAt\(run\)/);
assert.doesNotMatch(migration, /startedAt:/);
assert.match(migration, /export const libraryOrderReady = query/);

for (const file of [
  "convex/contentPlan.ts",
  "convex/reviewedDataStoryRunAdmissions.ts",
  "convex/routeQualificationBenchmarkRuns.ts",
  "convex/thumbnailRefresh.ts",
  "convex/runs.ts",
]) {
  const writer = readFileSync(join(root, file), "utf8");
  for (const insertion of writer.matchAll(/db\.insert\("runs",\s*\{/g)) {
    const fields = writer.slice(insertion.index, insertion.index + 400);
    const startedAt = fields.match(/startedAt: (now|args\.now),/);
    assert.ok(startedAt, `${file} run insert has a source timestamp`);
    assert.match(fields, new RegExp(`libraryOrderAt: ${startedAt[1]!.replace(".", "\\.")},`), `${file} run insert stamps the same order timestamp`);
  }
}

// Filters must be applied before paid joins wherever possible, while title
// search remains after metadata title resolution. Both cursor paths use the
// same pure rules rather than maintaining a second archive/date definition.
assert.match(source, /matchesLibraryRunScope/);
assert.match(source, /matchesLibraryTitle/);
assert.match(pageQuery, /libraryState/);
assert.match(pageQuery, /args\.from/);
assert.match(pageQuery, /args\.to/);
assert.match(source, /function projectLibraryVideo\(/);

// Evidence and packaging parity: the page projection must retain the same
// sealed master certificate and current thumbnail candidate/Lo-Fi selection
// as the existing Library and lightbox paths.
for (const expression of [
  "recordedMasterKey(ctx, run._id)",
  "currentLibraryThumbnail(ctx, {",
  "selectLatestCurrentGoldenThumbnail",
  "selectLofiLibraryThumbnail",
  "releaseEvidenceStatus",
]) {
  assert.match(pageQuery + source.slice(0, start), new RegExp(expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(bounded, /LIBRARY_PAGE_LIMIT/);
assert.match(bounded, /maxLimit: 24/);

console.log("Library cursor, filter, and evidence parity contracts passed");
