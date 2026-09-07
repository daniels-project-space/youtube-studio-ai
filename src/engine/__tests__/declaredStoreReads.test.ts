/**
 * THE FIVE CREW BRIEFS WERE THROWING ON EVERY RUN, IN ELEVEN OF TWELVE FAMILIES.
 *
 * The runner hands each block a Proxy over the store that throws on a read of
 * any key outside `consumes ∪ optionalConsumes`. Commit 2a5397d ("eliminate 7
 * redundant getChannel Convex reads per run", 2026-08-21) replaced five Convex
 * channel fetches with store reads and seeded the fields in runPipeline — and
 * never touched moduleContracts. So `loadGrounding`'s FIRST statement,
 * `ctx.store["showBible"]`, raised
 *
 *     module "director_brief" attempted undeclared artifact read "showBible"
 *
 * on director_brief, dp_brief, editor_brief, composer_brief and critic_spec,
 * plus metadata on "channelProgramRoute". The read sits ABOVE that function's
 * try/catch, so it was not a degraded brief — it was a dead block.
 *
 * That commit's verification note lists tsc, eslint and ten named tests. None
 * of them builds a proxied store, so a change that could not possibly work
 * passed review: it was right about the data and silent about the contract
 * governing access to it.
 *
 * This test asserts the contract directly, against the SAME
 * `declaredArtifactStore` the runner uses. It reads keys; it does not execute
 * blocks, so there is no provider call and no spend.
 *
 * scripts/audit-undeclared-store-reads.ts is the general form, finding this
 * class across all 84 blocks by AST. This file pins the specific regression,
 * because a general audit can be silenced by a baseline and a named test cannot.
 */
import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { declaredArtifactStore } from "@/engine/runner";

registerAllBlocks();

/** Read `key` through the real Proxy and report whether it was refused. */
function refusedRead(blockId: string, key: string): string | null {
  const manifest = getManifest(blockId);
  assert.ok(manifest, `${blockId} must be registered`);
  const store = declaredArtifactStore(manifest, { [key]: "value" }, new Set<string>(), () => {});
  try {
    void store[key];
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/* ---------------- the Proxy really does refuse, so this test can fail ------- */

// Without this, every assertion below could pass because the Proxy was toothless.
assert.match(
  refusedRead("director_brief", "aKeyNoBlockDeclares") ?? "",
  /undeclared artifact read "aKeyNoBlockDeclares"/,
  "the Proxy must refuse an undeclared read — otherwise this whole test proves nothing",
);

/* ------------------------- what loadGrounding reads ------------------------ */

const CREW_BLOCKS = ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"];

// Every key crewBlocks' loadGrounding / resolveChannelCrew / roleProfile touch.
// `showBible` and `channelSlug` are the first two statements of loadGrounding,
// so they are read on EVERY invocation, not down some rare branch.
const GROUNDING_KEYS = [
  "showBible", "channelSlug", "styleDNA", "channelName", "niche", "persona",
  "styleGrammar", "channelStatus", "channelTemplate", "channelBudget",
  "channelModuleConfig", "channelProgramRoute",
];

for (const block of CREW_BLOCKS) {
  for (const key of GROUNDING_KEYS) {
    assert.equal(
      refusedRead(block, key),
      null,
      `${block} must be allowed to read "${key}" — loadGrounding reads it, and an undeclared ` +
      "read is a thrown block, not a degraded one",
    );
  }
}

// intelligenceBlocks' loadChannel was changed by the same commit.
assert.equal(
  refusedRead("metadata", "channelProgramRoute"),
  null,
  'metadata must be allowed to read "channelProgramRoute"',
);

/* ------------- the reads found across the rest of the block set ------------- */

const OTHERS: [string, string][] = [
  ["keyframes", "visualBrief"],
  ["loop_clips", "musicProgramPlan"],
  ["motion_comic", "contentLane"],
  ["music", "channelProgramRoute"],
  ["qa_script", "topic"],
  ["scene_planner", "channelProgramRoute"],
  ["story_spine", "channelProgramRoute"],
  ["studio_ltx_adapter_resolve", "narrativeSeriesRunSelector"],
  ["timeline_assemble", "ltxStyleId"],
  ["topic_select", "narrativeSeriesRunSelector"],
  ["upload_draft", "finalMasterReleaseCertificate"],
  ["cleanup", "finalMasterReleaseCertificate"],
  ["whiteboard_scribe", "contentLane"],
  ["signature_clips", "cinematicGeneratedScenePlan"],
  ["self_contained_story_plan", "serializedProgramEpisodeContext"],
];

for (const [block, key] of OTHERS) {
  assert.equal(refusedRead(block, key), null, `${block} reads "${key}" and must declare it`);
}

/* ------------------- the two that must STAY undeclared --------------------- */

// requireVisualMatter reads visualMatterReferenceAssets behind
// `options.attachExternalReferenceAssets`, which only the QA blocks set. The
// static audit cannot tell that branch is unreachable for these two callers, so
// it reports them — and visualMatterReferenceAssets.test asserts the opposite on
// purpose: reference R2 pixels are QA comparison evidence, never generator
// input. Pinned here too, so a future "fix the audit to zero" cannot quietly
// turn a policy into a false positive.
for (const block of ["novita_render_images", "novita_render_video"]) {
  assert.match(
    refusedRead(block, "visualMatterReferenceAssets") ?? "",
    /undeclared artifact read/,
    `${block} must NOT be able to read reference pixels — they are QA evidence, not generator input`,
  );
}

console.log(
  `DECLARED STORE READS PASS — ${CREW_BLOCKS.length * GROUNDING_KEYS.length + OTHERS.length + 1} reads permitted, ` +
  "2 deliberately still refused",
);
