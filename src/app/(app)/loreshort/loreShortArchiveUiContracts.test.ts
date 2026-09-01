import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const root = process.cwd();
  const [page, styles, manifestBytes] = await Promise.all([
    readFile(join(root, "src/app/(app)/loreshort/page.tsx"), "utf8"),
    readFile(join(root, "src/app/(app)/loreshort/loreshort.module.css"), "utf8"),
    readFile(join(root, "src/engine/goldenProofMediaManifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes) as { entries: Array<{ id: string; status: string }> };

  assert.match(page, /Lore Short archive/);
  assert.match(page, /Reference media/);
  assert.match(page, /open-weight LTX 2\.5 Novita runtime/);
  assert.match(page, /Historical samples remain retained for audit/);
  assert.match(page, /Draw every narrated beat/);
  assert.match(page, /The route must draw beyond the opening/);
  assert.match(page, /opening references cannot be recycled across later narration/);
  assert.match(page, /function AdmissionNode/);
  assert.doesNotMatch(page, /Rings of Power|Star Wars|Seedance|Real-ESRGAN|Replicate|★ GOLDEN/i);
  assert.doesNotMatch(page, /<video\b/);
  assert.doesNotMatch(page, /<PageHeader/);
  assert.doesNotMatch(page, /style=\{/);

  assert.match(styles, /\.referencePlate/);
  assert.match(styles, /\.storyboardStrip/);
  assert.match(styles, /\.admissionField/);
  assert.match(styles, /prefers-reduced-motion/);

  const smith = manifest.entries.find((item) => item.id === "loreshort-smith4k-image");
  const franchiseVideo = manifest.entries.find((item) => item.id === "loreshort-lotr-video");
  assert.equal(smith?.status, "reference", "the displayed still must be approved reference media");
  assert.equal(franchiseVideo?.status, "historical", "the excluded franchise video must remain historical audit media");

  console.log("Lore Short archive UI contracts passed");
}

void main();
