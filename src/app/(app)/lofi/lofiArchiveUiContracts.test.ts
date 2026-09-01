import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
  const root = process.cwd();
  const [page, styles, nicheCatalog, manifestBytes] = await Promise.all([
    readFile(join(root, "src/app/(app)/lofi/page.tsx"), "utf8"),
    readFile(join(root, "src/app/(app)/lofi/lofi.module.css"), "utf8"),
    readFile(join(root, "src/lib/nicheCatalog.ts"), "utf8"),
    readFile(join(root, "src/engine/goldenProofMediaManifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes) as { entries: Array<{ id: string; status: string }> };

  assert.match(page, /Lofi Visual Archive/);
  assert.match(page, /Reference media/);
  assert.match(page, /Read the scene without copying it\./);
  assert.match(page, /Reference-to-release path/);
  assert.match(page, /Study composition\. Keep the identity original\./);
  assert.match(page, /Historical samples remain retained for audit/);
  assert.doesNotMatch(page, /Ghibli|Gemini|Kling|Topaz|★ GOLDEN/i);
  assert.doesNotMatch(page, /<video\b/);
  assert.doesNotMatch(page, /<PageHeader/);
  assert.doesNotMatch(page, /style=\{/);
  assert.match(styles, /\.referenceFrame/);
  assert.match(styles, /\.routeField/);
  assert.match(styles, /\.identityGrid/);
  assert.match(styles, /prefers-reduced-motion: reduce/);

  const beachCafe = manifest.entries.find((item) => item.id === "lofi-beachcafe-image");
  const meadowVideo = manifest.entries.find((item) => item.id === "lofi-meadow-video");
  assert.equal(beachCafe?.status, "reference", "the displayed scene must be an approved current reference");
  assert.equal(meadowVideo?.status, "historical", "the third-party-style motion sample must remain audit-only");

  assert.match(nicheCatalog, /hand-drawn-anime-ambience/);
  assert.match(nicheCatalog, /anime-inspired lofi/);
  assert.doesNotMatch(nicheCatalog, /ghibli-anime|studio ghibli|ghibli lofi/i);

  console.log("lofi archive UI contracts passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
