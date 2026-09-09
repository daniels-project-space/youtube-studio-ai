import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { goldenProofMediaPresentation } from "@/engine/goldenProofMedia";
import { studioLocationForPathname } from "@/lib/studioLocation";

async function main() {
  const root = process.cwd();
  const [page, styles, nicheCatalog, manifestBytes] = await Promise.all([
    readFile(join(root, "src/app/(app)/lofi/page.tsx"), "utf8"),
    readFile(join(root, "src/app/(app)/lofi/lofi.module.css"), "utf8"),
    readFile(join(root, "src/lib/nicheCatalog.ts"), "utf8"),
    readFile(join(root, "src/engine/goldenProofMediaManifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes) as { entries: Array<{ id: string; status: string }> };

  assert.match(page, /Lo-fi references/);
  assert.match(page, /Reference media/);
  assert.match(page, /Study composition\. Keep the identity original\./);
  assert.match(page, /Historical samples remain retained for audit/);
  assert.doesNotMatch(page, /Ghibli|Gemini|Kling|Topaz|★ GOLDEN/i);
  assert.doesNotMatch(page, /<video\b/);
  assert.doesNotMatch(page, /<PageHeader/);
  assert.doesNotMatch(page, /style=\{/);
  assert.match(styles, /\.referenceFrame/);
  assert.doesNotMatch(styles, /\.routeField|\.routeCore|object-fit:\s*cover/);
  assert.match(styles, /\.studyNotes/);
  assert.match(styles, /prefers-reduced-motion: reduce/);

  // Render the real server component, actual manifest adapter and Next link.
  // Only CSS class loading is supplied by this Node harness; pixel geometry
  // and native disclosure/link actions are checked on the real browser page.
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const require = createRequire(import.meta.url);
  let html: string;
  loader._load = function (...args: unknown[]) {
    if (typeof args[0] === "string" && args[0].endsWith(".module.css")) {
      return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    }
    return originalLoad.apply(this, args);
  };
  try {
    const { default: LofiPage } = require("./page") as typeof import("./page");
    html = renderToStaticMarkup(createElement(LofiPage));
  } finally { loader._load = originalLoad; }
  const reference = goldenProofMediaPresentation("lofi-beachcafe-image", "reference", "image");
  assert.ok(html.includes(`src="${reference.url}"`) && html.includes(`href="${reference.url}"`));
  assert.ok(html.includes(`data-proof-media-sha256="${reference.sha256}"`));
  assert.match(html, /data-proof-media-status="reference"/);
  assert.match(html, /href="\/golden"/);
  assert.equal((html.match(/<details\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|[\s>])|<main\b|<video\b|meadow\.mp4/);
  assert.match(html, /Use &amp; release requirements/);
  assert.match(html, /exact released bytes/);
  assert.match(html, /before any spend/);
  assert.equal(createHash("sha256").update(await readFile(join(root, "public", reference.url.slice(1)))).digest("hex"), reference.sha256);
  assert.throws(() => goldenProofMediaPresentation("lofi-meadow-video", "reference", "video"), /historical/);
  assert.equal(studioLocationForPathname("/lofi").title, "Lo-fi references");

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
