/**
 * P1-10 regression lock — "who actually enforces cinematic identity consistency".
 *
 * The Golden catalog used to claim cinematic channels rendered WITHOUT any
 * hero-anchor consistency law, because src/lib/cinecraft.ts is unwired. That
 * premise is stale: cinecraft's render path is permanently retired (it drove the
 * retired PAID Higgsfield CLI), and the equivalent law is now supplied by the
 * `visual_matter` module, which the Novita render chain HARD-REQUIRES.
 *
 * This test binds the catalog prose in src/engine/golden.ts ("cinematic") and
 * src/engine/goldenExecution.ts to mechanically checkable facts, so neither the
 * binding nor the retirement can silently regress:
 *   1. visual_matter produces the manifest.
 *   2. every Novita chain block CONSUMES it (hard input, not optional).
 *   3. the designed cinematic pipeline orders visual_matter before the renders.
 *   4. cinecraft's paid render path stays disabled.
 */
import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { designPipeline } from "@/engine/designer";
import { hasCinecraft } from "@/lib/cinecraft";

registerAllBlocks();

/* 1 ── visual_matter is the producer of the identity-lock manifest ---------- */
const visualMatter = getManifest("visual_matter");
assert(visualMatter, "visual_matter must be registered — it owns the cinematic identity lock");
assert(
  "visualMatterManifest" in visualMatter.produces,
  "visual_matter must produce visualMatterManifest",
);

/* 2 ── the whole Novita chain treats it as a HARD input -------------------- */
const NOVITA_CHAIN = ["novita_render_images", "qa_assets", "novita_render_video", "qa_shots"];
for (const blockId of NOVITA_CHAIN) {
  const manifest = getManifest(blockId);
  assert(manifest, `${blockId} manifest must be registered`);
  assert(
    "visualMatterManifest" in manifest.consumes,
    `${blockId} must HARD-consume visualMatterManifest (requireVisualMatter throws without it) — ` +
      "the cinematic identity-lock gate in golden.ts depends on this being a required input, not an optional one",
  );
  assert(
    !("visualMatterManifest" in (manifest.optionalConsumes ?? {})),
    `${blockId} must not downgrade visualMatterManifest to an optional input`,
  );
}

/* 3 ── the designed cinematic pipeline locks BEFORE it spends -------------- */
const { pipeline } = designPipeline({ family: "cinematic" });
const ids = pipeline.map((entry) => entry.block);
const lockAt = ids.indexOf("visual_matter");
const firstRenderAt = ids.indexOf("novita_render_images");
assert(lockAt >= 0, "cinematic pipeline must include visual_matter");
assert(firstRenderAt >= 0, "cinematic pipeline must include novita_render_images");
assert(
  lockAt < firstRenderAt,
  "visual_matter must run BEFORE any paid keyframe render — an identity lock decided after the spend is not a lock",
);
assert(
  ids.indexOf("story_spine") >= 0 && ids.indexOf("story_spine") < lockAt,
  "visual_matter must derive its storyboard from the timed story spine that precedes it",
);

/* 4 ── the retired paid renderer stays retired ----------------------------- */
assert.equal(
  hasCinecraft(),
  false,
  "cinecraft's Higgsfield render path is RETIRED and must never be reopened by an env flag — " +
    "if this flips, golden.ts's cinematic entry and this binding must both be re-audited",
);

console.log(
  "cinematic identity-lock binding tests passed (visual_matter → Novita chain; cinecraft retired)",
);
