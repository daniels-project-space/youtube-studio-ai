import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Module, { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { goldenProofMediaPresentation } from "@/engine/goldenProofMedia";

async function main() {
  const root = process.cwd();
  const [page, styles, manifestBytes] = await Promise.all([
    readFile(join(root, "src/app/(app)/loreshort/page.tsx"), "utf8"),
    readFile(join(root, "src/components/ReferenceStudy.module.css"), "utf8"),
    readFile(join(root, "src/engine/goldenProofMediaManifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes) as { entries: Array<{ id: string; status: string }> };

  assert.match(page, /Lore references/);
  assert.match(page, /Reference media/);
  assert.match(page, /open-weight LTX 2\.5 Novita runtime/);
  assert.match(page, /Historical samples remain retained for audit/);
  assert.match(page, /Draw every narrated beat/);
  assert.match(page, /not just the opening/);
  assert.match(page, /opening references cannot be recycled across later narration/);
  assert.doesNotMatch(page, /function AdmissionNode|ArchiveMetric/);
  assert.doesNotMatch(page, /Rings of Power|Star Wars|Seedance|Real-ESRGAN|Replicate|★ GOLDEN/i);
  assert.doesNotMatch(page, /<video\b/);
  assert.doesNotMatch(page, /<PageHeader/);
  assert.doesNotMatch(page, /style=\{/);

  assert.match(styles, /\.referenceFrame/);
  assert.match(styles, /\.studyNotes/);
  assert.doesNotMatch(styles, /\.admissionField|object-fit:\s*cover/);
  assert.match(styles, /prefers-reduced-motion/);

  // Real component, manifest policy and Next Link. CSS module loading is the
  // only substituted boundary; actual layout/actions are checked in-browser.
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const originalLoad = loader._load, require = createRequire(import.meta.url);
  let html: string;
  loader._load = function (...args: unknown[]) {
    if (typeof args[0] === "string" && args[0].endsWith(".module.css")) {
      return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    }
    return originalLoad.apply(this, args);
  };
  try {
    const { default: LoreShortPage } = require("./page") as typeof import("./page");
    html = renderToStaticMarkup(createElement(LoreShortPage));
  } finally { loader._load = originalLoad; }
  const reference = goldenProofMediaPresentation("loreshort-smith4k-image", "reference", "image");
  assert.ok(html.includes(`src="${reference.url}"`) && html.includes(`href="${reference.url}"`));
  assert.ok(html.includes(`data-proof-media-sha256="${reference.sha256}"`));
  assert.match(html, /data-proof-media-status="reference"/);
  assert.match(html, /href="\/golden"/);
  assert.equal((html.match(/<details\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|[\s>])|<main\b|<video\b/);
  assert.match(html, /Story &amp; release requirements/);
  assert.match(html, /not a final master/);
  assert.match(html, /Runtime not qualified/);
  assert.match(html, /This page triggers no rendering, provider work, training or publishing/);
  assert.equal(createHash("sha256").update(await readFile(join(root, "public", reference.url.slice(1)))).digest("hex"), reference.sha256);
  assert.throws(() => goldenProofMediaPresentation("loreshort-lotr-video", "reference", "video"), /historical/);

  const smith = manifest.entries.find((item) => item.id === "loreshort-smith4k-image");
  const franchiseVideo = manifest.entries.find((item) => item.id === "loreshort-lotr-video");
  assert.equal(smith?.status, "reference", "the displayed still must be approved reference media");
  assert.equal(franchiseVideo?.status, "historical", "the excluded franchise video must remain historical audit media");

  console.log("Lore Short archive UI contracts passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
