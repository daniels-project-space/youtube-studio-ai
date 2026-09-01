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
assert.match(videosQuery, /videoKey:\s*sealedMasterKey\s*\?\?/);
assert.match(videoTypes, /releaseEvidenceStatus:\s*ReleaseEvidenceStatus/);
assert.match(card, /ReleaseEvidenceBadge/);
assert.match(card, /Master evidence/);
assert.match(card, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(library, /Verified marks a saved final master/);
assert.match(library, /Hidden videos you can restore/);
assert.match(library, /role="tab" aria-selected=\{collection === "archived"\}/);

console.log("Library release-evidence truthfulness contract passed");
