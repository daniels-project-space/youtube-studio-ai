import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  GOLDEN_PROOF_MEDIA_CATALOG_VERSION,
  GOLDEN_PROOF_MEDIA_MANIFEST,
  GOLDEN_PROOF_MEDIA_MANIFEST_VERSION,
  goldenProofMediaEntry,
  goldenProofMediaExclusion,
  goldenProofMediaInventorySummary,
  goldenProofMediaPresentation,
  goldenProofMediaSuccessorQueue,
} from "@/engine/goldenProofMedia";

function goldenFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? goldenFiles(path) : entry.isFile() ? [path] : [];
  });
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function idsFrom(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)].map((match) => match[1]!);
}

function main(): void {
  assert.equal(GOLDEN_PROOF_MEDIA_MANIFEST_VERSION, 1);
  assert.equal(GOLDEN_PROOF_MEDIA_CATALOG_VERSION, "2026-08-24");
  assert.equal(GOLDEN_PROOF_MEDIA_MANIFEST.entries.length, 61, "every committed Golden asset must have a versioned status record");

  const root = process.cwd();
  const publicRoot = join(root, "public");
  const onDiskPaths = goldenFiles(join(publicRoot, "golden"))
    .map((path) => relative(publicRoot, path).replaceAll("\\", "/"))
    .sort();
  const manifestPaths = GOLDEN_PROOF_MEDIA_MANIFEST.entries.map((entry) => entry.path).sort();
  assert.deepEqual(manifestPaths, onDiskPaths, "the manifest must account for every committed Golden asset, including retained history");

  for (const entry of GOLDEN_PROOF_MEDIA_MANIFEST.entries) {
    assert.equal(
      sha256(join(publicRoot, entry.path)),
      entry.sha256,
      `${entry.id} must fail closed when its bytes change without a new audit`,
    );
  }

  const summary = goldenProofMediaInventorySummary();
  assert.deepEqual(summary, {
    reference: 19,
    context: 6,
    historical: 29,
    quarantined: 2,
    duplicate: 5,
  });
  const eligible = GOLDEN_PROOF_MEDIA_MANIFEST.entries.filter((entry) => entry.status === "reference" || entry.status === "context");
  assert.equal(new Set(eligible.map((entry) => entry.sha256)).size, eligible.length, "presentable Golden media must never reuse the same bytes");

  assert.equal(goldenProofMediaPresentation("novita-shot001-video", "reference", "video").url, "/golden/novita-render-farm/shot001.mp4");
  assert.equal(goldenProofMediaPresentation("cinematic-cash-image", "context", "image").status, "context");
  assert.match(
    goldenProofMediaEntry("comic-comic3d-video").statusReason ?? "",
    /empty comic template/i,
    "a retained comic sample with a dead opening is context only, not Golden proof",
  );
  assert.throws(
    () => goldenProofMediaPresentation("comic-comic3d-video", "reference", "video"),
    /context/i,
    "the comic sample must not be presented as Golden reference media until its opening is repaired",
  );
  assert.match(
    goldenProofMediaEntry("quiz-flag-video").statusReason ?? "",
    /effectively silent/i,
    "a silent quiz clip is visual context only, never audible-release reference evidence",
  );
  assert.throws(
    () => goldenProofMediaPresentation("quiz-flag-video", "reference", "video"),
    /context/i,
    "the Golden UI must not present the silent quiz clip as current production reference media",
  );
  assert.match(
    goldenProofMediaEntry("quiz-trivia-video").statusReason ?? "",
    /below the production loudness floor/i,
    "a quiet quiz clip is visual context only, never audible-release reference evidence",
  );
  assert.throws(
    () => goldenProofMediaPresentation("quiz-trivia-video", "reference", "video"),
    /context/i,
    "the Golden UI must not present the below-floor quiz clip as current production reference media",
  );
  assert.throws(
    () => goldenProofMediaPresentation("documotion-fordlandia-video", "reference", "video"),
    /quarantined/i,
    "a known black-tail render must never be resolvable as Golden evidence",
  );
  assert.throws(
    () => goldenProofMediaPresentation("novita-still001-video", "reference", "video"),
    /duplicate/i,
    "a byte-identical duplicate must never be resolvable as Golden evidence",
  );
  assert.match(goldenProofMediaExclusion("documotion-fordlandia-video").statusReason ?? "", /black/i);
  assert.match(
    goldenProofMediaExclusion("lofi-meadow-video").statusReason ?? "",
    /third-party studio-style identifier/i,
    "a visually polished but named third-party-style sample must not remain a production reference",
  );
  assert.throws(
    () => goldenProofMediaPresentation("lofi-meadow-video", "reference", "video"),
    /historical/i,
    "the Golden UI must not present the excluded style sample as current reference media",
  );
  assert.match(
    goldenProofMediaExclusion("loreshort-lotr-video").statusReason ?? "",
    /third-party fantasy-franchise/i,
  );
  assert.throws(
    () => goldenProofMediaPresentation("speech-steve-jobs-video", "reference", "video"),
    /historical/i,
    "unlicensed archival footage must not become Golden production evidence",
  );
  assert.equal(goldenProofMediaEntry("novita-still001-video").duplicateOf, "novita-shot001-video");

  assert.deepEqual(
    goldenProofMediaSuccessorQueue().map((entry) => entry.id),
    ["comic-comic3d-video", "documotion-fordlandia-video", "quiz-flag-video", "quiz-trivia-video"],
    "only context/quarantined videos with an explicit repair path belong in the successor-render queue",
  );
  assert.equal(
    goldenProofMediaSuccessorQueue().find((entry) => entry.id === "documotion-fordlandia-video")?.requiredOutcome,
    "Repair the recorded defect, then create a newly reviewed final master.",
  );

  // The Golden page and its client lightbox receive already-resolved URLs. Raw
  // /golden paths would bypass the manifest's status and hash binding.
  const goldenPage = readFileSync(join(root, "src", "app", "(app)", "golden", "page.tsx"), "utf8");
  const goldenImages = readFileSync(join(root, "src", "app", "(app)", "golden", "GoldenImages.tsx"), "utf8");
  assert.doesNotMatch(goldenPage, /\/golden\//, "the Golden page must not bypass the media resolver with a raw path");
  assert.doesNotMatch(goldenImages, /\/golden\//, "the Golden image lightbox must not recreate a raw Golden path");

  for (const id of idsFrom(goldenPage, /referenceMedia\("([a-z0-9-]+)"/g)) {
    assert.equal(goldenProofMediaPresentation(id, "reference").status, "reference", `${id} is rendered as reference media`);
  }
  for (const id of idsFrom(goldenPage, /contextMedia\("([a-z0-9-]+)"/g)) {
    assert.equal(goldenProofMediaPresentation(id, "context").status, "context", `${id} is rendered as context-only media`);
  }
  for (const pair of goldenPage.matchAll(/videoProof\("([a-z0-9-]+)", "([a-z0-9-]+)"/g)) {
    assert.equal(goldenProofMediaPresentation(pair[1]!, "reference").status, "reference");
    assert.equal(goldenProofMediaPresentation(pair[2]!, "reference").status, "reference");
  }
  for (const pair of goldenPage.matchAll(/contextClipProof\("([a-z0-9-]+)", "([a-z0-9-]+)"/g)) {
    assert.equal(goldenProofMediaPresentation(pair[1]!, "context").status, "context");
    assert.equal(goldenProofMediaPresentation(pair[2]!, "reference").status, "reference");
  }
}

main();
console.log("golden proof media manifest tests passed");
