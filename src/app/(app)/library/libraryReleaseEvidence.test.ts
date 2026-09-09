import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const videosQuery = readFileSync(join(root, "convex/videos.ts"), "utf8");
const videoTypes = readFileSync(join(root, "src/lib/types.ts"), "utf8");
const card = readFileSync(join(root, "src/components/VideoCard.tsx"), "utf8");
const library = readFileSync(join(root, "src/app/(app)/library/page.tsx"), "utf8");

// A completed render is not itself quality or provenance evidence. The Library
// must carry the conservative, normalized status all the way to the card.
assert.match(videosQuery, /normalizeReleaseEvidenceStatus\(run\.releaseEvidenceStatus\)/);
assert.match(videosQuery, /recordedReleaseEvidenceMasterKey/);
assert.match(videosQuery, /sealedMasterKey/);
// Both single-run views must use the same retained-media boundary. Exact
// sealed-key behavior (including a missing asset row and corrupt certificate)
// is exercised through BOTH real viewer handlers in runCurrentThumbnail.test.ts,
// rather than depending on whether the key is an inline property or a variable.
for (const queryName of ["getRunMediaPresentation", "getVideoDetail"]) {
  const declaration = `export const ${queryName} = query(`;
  const start = videosQuery.indexOf(declaration);
  assert.ok(start >= 0, `${queryName} remains an exposed query`);
  const queryBody = videosQuery.slice(start).split("\nexport const ")[0]!;
  assert.match(queryBody, /await retainedRunMedia\(ctx, run\)/,
    `${queryName} must share retained master and current-thumbnail selection`);
}
assert.match(videoTypes, /releaseEvidenceStatus:\s*ReleaseEvidenceStatus/);
assert.match(card, /ReleaseEvidenceBadge/);
assert.match(card, /Master evidence/);
assert.match(card, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(library, /Verified marks a saved final master/);
assert.match(library, /Hidden videos you can restore/);
assert.match(library, /role="tab" aria-selected=\{collection === "archived"\}/);

console.log("Library release-evidence truthfulness contract passed");
