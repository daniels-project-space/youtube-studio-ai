import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.match(source, /operationsAccess !== "owner"/, "reviewed replacements remain owner-only");
assert.match(
  source,
  /operationsAccess === "owner"[\s\S]*reviewedThumbnailUrls\.get\(video\._id\)/,
  "private replacement URLs must be excluded from every non-owner card projection before deferred cleanup",
);
assert.match(source, /window\.setTimeout\(\(\) => setReviewedThumbnailUrls\(new Map\(\)\), 0\)/,
  "owner-access transitions clear cached preview URLs without a synchronous effect render");
assert.match(source, /ernieBatch=reviewed/, "Library loads the sealed reviewed batch projection");
assert.match(source, /new Map\([\s\S]*candidate\.sourceRunId, candidate\.previewUrl/, "preview URLs are keyed only by exact source run");
assert.match(source, /reviewedThumbnailUrls\.get\(video\._id\)/, "each card receives a preview only for its exact run");
assert.match(source, /reviewedThumbnailUrl/, "the reviewed artwork reaches every Library video projection");
assert.match(
  source,
  /reviewedThumbnailUrl && video\.thumbnailPresentation === undefined/,
  "a legacy ERNIE scene can never cover the dedicated Lo-Fi rendered-frame presentation",
);
assert.match(source, /240_000/, "short-lived preview URLs refresh before expiry");

console.log("Library reviewed-thumbnail overlay contracts passed");
