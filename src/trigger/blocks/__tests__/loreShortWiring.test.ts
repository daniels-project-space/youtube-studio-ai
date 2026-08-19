/**
 * lore_short wiring regression lock.
 *
 * The loreshort engine sat in the catalog as "pipeline adapter pending" for one
 * reason: as written it reached three UNATTESTED paid providers directly
 * (Replicate LTX/Seedance/Real-ESRGAN + a hardcoded ElevenLabs voice) and
 * "published" by copying into an nginx docroot on a specific VPS. This suite
 * binds the fix so none of those four blockers can silently return:
 *
 *   1. providers are INJECTED (LoreShortDeps), defaults preserved for the CLI
 *   2. the pipeline block routes every paid pixel through the ATTESTED farm
 *   3. publication is an R2 sink, not a filesystem docroot
 *   4. narration uses the channel's cast voice, not a hardcoded id
 *
 * plus the family/lane/archetype plumbing and the deterministic story-defect
 * function that keeps the critique loop honest.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FAMILIES, FAMILY_CREW, type FamilyKey } from "@/engine/families";
import {
  CONTENT_LANE_BY_FAMILY,
  CONTENT_LANE_POLICIES,
  LANE_QUALITY_POLICIES,
  laneQualityPolicy,
} from "@/engine/contentLane";
import { ARCHETYPES } from "@/engine/archetypes";
import { designPipeline } from "@/engine/designer";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { CATALOG_EXECUTION_BINDINGS } from "@/engine/goldenExecution";
import { loreStoryDefects, LORESHORT_PATHS, type LorePlan } from "@/lib/loreshort";
import { loreBeatCount, LORE_MAX_BEATS, LORE_MIN_BEATS } from "@/trigger/blocks/loreShortBlocks";

const ENGINE = "src/lib/loreshort.ts";
const BLOCK = "src/trigger/blocks/loreShortBlocks.ts";

function source(relative: string): Promise<string> {
  return readFile(join(process.cwd(), relative), "utf8");
}

/**
 * Strip comments. The "must never reach X" checks below are about CODE — the
 * block's header deliberately NAMES the retired providers to explain why they
 * are gone, and that documentation must not trip its own guard.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A plan that should pass every deterministic check. */
function goodPlan(beats: number): LorePlan {
  return {
    scenes: Array.from({ length: beats }, (_, index) => ({
      line: `Beat number ${index + 1}: the walls held that night, and I watched them hold.`,
      shot: "wide establishing",
      visual:
        `A shattered ${index + 1}-tonne gate fills the close foreground, a lone sentinel stands at the midground rampart, ` +
        `and a burning valley recedes into the deep background haze.`,
      camera: "slow dolly push-in past the foreground gate toward the sentinel as the valley slides behind",
    })),
  };
}

/* ── 1. DETERMINISTIC STORY DEFECTS ──────────────────────────────────────────
 * The critique loop is only worth its LLM call if the code-side checks are
 * real. These are genuine input/output tests, not shape assertions.
 */
function storyDefectsAreReal(): void {
  assert.deepEqual(loreStoryDefects(goodPlan(9), 9), [], "a well-formed 9-beat plan must produce zero defects");

  const short = loreStoryDefects(goodPlan(4), 9);
  assert.ok(
    short.some((issue) => /only 4 of the 9 requested beats/.test(issue)),
    "a truncated plan must be caught by beat count",
  );

  const thinLine = goodPlan(6);
  thinLine.scenes![2].line = "It fell.";
  assert.ok(
    loreStoryDefects(thinLine, 6).some((issue) => /beat 3'?s narration line is only 2 words/.test(issue)),
    "a two-word narration line must be rejected",
  );

  const rambling = goodPlan(6);
  rambling.scenes![0].line = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  assert.ok(
    loreStoryDefects(rambling, 6).some((issue) => /beat 1'?s narration line is 40 words/.test(issue)),
    "a line too long to hold one shot must be rejected",
  );

  const flatVisual = goodPlan(6);
  flatVisual.scenes![4].visual = "a castle";
  assert.ok(
    loreStoryDefects(flatVisual, 6).some((issue) => /beat 5'?s "visual" is only 2 words/.test(issue)),
    "a visual with no depth planes must be rejected — the camera would have nothing to travel through",
  );

  const noCamera = goodPlan(6);
  noCamera.scenes![1].camera = "   ";
  assert.ok(
    loreStoryDefects(noCamera, 6).some((issue) => /beat 2 has no "camera" move/.test(issue)),
    "a beat without a camera move must be rejected",
  );

  const repeated = goodPlan(6);
  repeated.scenes![3].line = repeated.scenes![2].line;
  assert.ok(
    loreStoryDefects(repeated, 6).some((issue) => /beats 3 and 4 repeat the same narration line/.test(issue)),
    "duplicate narration lines must be rejected",
  );

  assert.ok(loreStoryDefects({ scenes: [] }, 9).length > 0, "an empty plan must never pass");
  assert.ok(loreStoryDefects({}, 9).length > 0, "a plan with no scenes array must never pass");
  assert.ok(
    loreStoryDefects(goodPlan(30), 9).length === 0,
    "extra beats beyond the request are trimmed by the engine, not treated as defects",
  );
}

/* ── 2. BEAT SIZING ─────────────────────────────────────────────────────────── */
function beatSizingIsBounded(): void {
  assert.equal(loreBeatCount(0), 9, "no target falls back to the engine's own 9-beat default");
  assert.equal(loreBeatCount(Number.NaN), 9);
  assert.equal(loreBeatCount(-30), 9);
  assert.equal(loreBeatCount(54), 9, "~6s per beat");
  assert.equal(loreBeatCount(12), LORE_MIN_BEATS, "a very short target still gets a full arc");
  assert.equal(loreBeatCount(3600), LORE_MAX_BEATS, "a long target is capped — every beat is a paid still + clip");
  for (const seconds of [10, 40, 54, 96, 200, 5000]) {
    const beats = loreBeatCount(seconds);
    assert.ok(beats >= LORE_MIN_BEATS && beats <= LORE_MAX_BEATS, `${seconds}s → ${beats} must stay inside the cap`);
  }
}

/* ── 3. BLOCKER 1+2+3+4: THE BLOCK ROUTES AWAY FROM THE VPS/REPLICATE PATH ──── */
async function blockUsesAttestedProvidersAndR2(): Promise<void> {
  const block = await source(BLOCK);
  const code = codeOnly(block);

  // Blocker 1 — unattested paid provider.
  assert.doesNotMatch(code, /api\.replicate\.com|REPLICATE_API_TOKEN|replicate/i,
    "the pipeline block must never reach Replicate");
  assert.match(block, /createAttestedNovitaImageGenerator/,
    "stills must come from the attested Novita generator");
  assert.match(block, /generateI2V/, "the camera move must come from the single attested i2v seam");
  assert.match(block, /provider:\s*"novita-ltx"/,
    "LoreCraft must explicitly select the mandatory Novita LTX route");
  assert.match(block, /model:\s*"ltx-2\.5-distilled-x2"/,
    "LoreCraft must pin the LTX-2.5 distilled renderer, never a generic video default");
  assert.match(block, /aspectRatio:\s*"16:9"/,
    "LoreCraft must render its cinematic master in the LTX production aspect ratio");
  assert.doesNotMatch(code, /gemini|google/i,
    "the executable LoreCraft wrapper must never call a Google model");
  assert.match(block, /hasNovitaRenderFarmConfig/, "the block must fail closed without the attested farm");

  // Cost must ACCUMULATE. A bare `=` would let a Trigger retry erase prior spend.
  assert.match(block, /imageCostUsd \+= receipt\.costUsd/, "image receipts must accumulate with +=");
  assert.match(block, /clipCostUsd \+= clip\.costUsd/, "clip receipts must accumulate with +=");
  assert.match(block, /ttsCharacters \+= characters/, "TTS characters must accumulate with +=");
  assert.match(block, /visionCalls \+= 1/, "the engine's motion-analysis calls must accumulate with +=");
  assert.doesNotMatch(block, /(?:imageCostUsd|clipCostUsd|ttsCharacters|visionCalls) = (?!0;)/,
    "no cost counter may be reassigned after initialisation");

  // The reported spend must cover EVERY paid stage, not just the obvious two.
  // The motion-analysis vision pass is engine-internal and was the easy one to
  // silently omit — reserving it but not reporting it would understate spend.
  assert.match(block, /const visionCost = visionCalls \* PRICE\.visionGraderUsd/,
    "the vision pass must be priced");
  assert.match(block, /const loreCost = artCost \+ clipCostUsd \+ ttsCost \+ visionCost/,
    "reported cost must be the sum of every paid stage");
  // …and it must be counted per REAL call, not per beat, or a resumed run would
  // re-charge for the cached analyses it skipped.
  const engineSource = await source(ENGINE);
  const cacheReturn = engineSource.indexOf('if (existsSync(out)) { motion[i] = JSON.parse');
  const visionHook = engineSource.indexOf("deps.onVisionCall?.(i)");
  assert.ok(cacheReturn > 0 && visionHook > cacheReturn,
    "the vision hook must fire AFTER the cache short-circuit, never on a cache hit");

  // Blocker 2 — runtime incompatibility. No nginx, no docroot, no hardcoded host.
  assert.doesNotMatch(code, /\/var\/www|nginx|87\.106\.233\.113|webDir|\bhost\b/,
    "the block must not depend on a VPS filesystem or a hardcoded host");
  // Blocker 3 — publication is R2.
  assert.match(block, /putObjectFromFile\(\s*videoKey/, "the master must be published to R2 by key");

  // Blocker 4 — TTS bypass. No hardcoded voice id; the cast voice is read from
  // the same params narration_tts and whiteboard_scribe use.
  assert.doesNotMatch(block, /IKne3meq5aSn9XLyUdCD/, "the engine's hardcoded ElevenLabs voice must not be reintroduced");
  assert.match(block, /ctx\.params\["ttsProvider"\]/, "the provider must come from the cast pipeline");
  assert.match(block, /ctx\.params\["elevenVoiceId"\]/, "the ElevenLabs voice must come from the cast pipeline");

  // Cost safety: the free ffmpeg finish is pinned, Real-ESRGAN never bought.
  assert.match(block, /upscale:\s*"ffmpeg"/, "the block must pin the FREE ffmpeg upscale lane");
  assert.doesNotMatch(code, /realesrgan/i, "no paid upscale may be purchased");
  assert.equal(LORESHORT_PATHS.budget.upscale, "ffmpeg",
    "the engine's budget lane must still be the free ffmpeg path the block pins");

  // Critique-loop cost safety: text-only production, capped iterations, frozen
  // checkpoint, and a fail-closed outage gate before any paid rendering.
  assert.match(block, /produceAndCritique<LorePlan>/, "the story must be settled under the shared critique loop");
  assert.match(block, /Math\.min\(2, laneQuality\.maxCritiqueIters\)/, "iterations must be hard-capped");
  assert.match(block, /Claude story critic unavailable/, "a critic outage must be explicit");
  assert.match(block, /unavailableStoryboardCriticVerdict\(/, "a critic outage must deny approval");
  assert.match(block, /assertStoryboardCritiqueApproved\(/, "paid rendering must be blocked without approval");
  assert.match(block, /loadStoryCheckpoint|putObject\(\s*checkpointKey/,
    "the accepted story must be frozen to a content-addressed checkpoint");
}

/* ── 4. THE ENGINE KEPT ITS STANDALONE DEFAULTS ─────────────────────────────── */
async function engineDefaultsSurviveForTheCli(): Promise<void> {
  const engine = await source(ENGINE);
  const engineCode = codeOnly(engine);

  // The FAL/Replicate/ElevenLabs/nginx implementations must STILL be there —
  // the point of the inversion was to make them injectable, not to delete the
  // standalone route.
  assert.match(engine, /api\.replicate\.com/, "the standalone Replicate lane must remain as the default");
  assert.match(engine, /generateFalImage/, "the standalone art fallback must remain non-Google");
  assert.match(engine, /copyFile\(rd\("final\.mp4"\), pub\)/, "the default publish sink must remain the nginx copy");
  assert.match(engine, /provider:\s*"elevenlabs"/, "the default TTS must remain ElevenLabs");

  // …but they must all be BEHIND a dep check, and the secret list must be
  // conditional so an injected caller is not blocked by a token it never uses.
  assert.match(engine, /if \(deps\.generateClip\)/, "the injected clip lane must short-circuit before any Replicate call");
  assert.match(engine, /deps\.generateImage\s*\n?\s*\?/, "art must prefer the injected generator");
  assert.match(engine, /deps\.synthLine\s*\n?\s*\?/, "narration must prefer the injected synthesiser");
  assert.match(engine, /deps\.publish\s*\n?\s*\?/, "publication must prefer the injected sink");
  assert.match(engine, /const usesReplicate = !deps\.generateClip \|\| cfg\.upscale === "realesrgan"/,
    "REPLICATE_API_TOKEN must only be demanded when a Replicate path is genuinely reachable");
  assert.match(engine, /\.\.\.\(deps\.synthLine \? \[\] : \["ELEVENLABS_API_KEY"\]\)/,
    "ELEVENLABS_API_KEY must only be demanded when the default TTS is in play");
  assert.match(engine, /\.\.\.\(usesFalImage \? \["FAL_KEY"\] : \[\]\)/,
    "FAL_KEY must only be demanded when the non-Google art fallback is reachable");
  assert.match(engine, /if \(!deps\.publish\) await mkdir\(WEB/,
    "a cloud worker must not mkdir the nginx docroot");

  // The injected clip branch must come BEFORE the endpoint construction, or the
  // short-circuit would be decorative.
  const injected = engine.indexOf("if (deps.generateClip)");
  const replicateSubmit = engine.indexOf("https://api.replicate.com/v1/predictions");
  assert.ok(injected > 0 && replicateSubmit > injected,
    "the injected branch must precede the Replicate submission, not follow it");

  // A caller-supplied plan must never be re-planned (that would discard the
  // critique loop's accepted output and pay for a second draft).
  assert.match(engine, /if \(deps\.plan\)/, "an accepted plan must short-circuit the story pass");
  assert.match(engine, /claudeJsonPro/, "the lore story planner must use Claude, never Google text planning");
  assert.doesNotMatch(engineCode, /gemini|google|generateBananaImage/i,
    "LoreCraft itself must contain no Google planning, scene-art, or utility path");
  assert.match(engine, /providers:\s*\["openrouter"\]/,
    "LoreCraft motion analysis must explicitly restrict itself to non-Google vision providers");
}

/* ── 5. FAMILY / LANE / ARCHETYPE PLUMBING ──────────────────────────────────── */
function familyLaneArchetypeAreConsistent(): void {
  const family = FAMILIES.loreshort;
  assert.ok(family, "the loreshort family must exist");
  assert.equal(family.visualEngine, "lore_short");
  assert.equal(family.archetypeKey, "lore-short");
  assert.equal(family.available, true, "the engine is wired, so the family must not be draft-only");
  assert.equal(family.narrated, true);
  assert.ok((family.defaultRunBudgetUsd ?? 0) > 0, "a paid per-beat engine needs a spend envelope");
  assert.ok(family.requiresKeys.includes("novita"), "the family must declare the attested render dependency");
  assert.ok(!family.requiresKeys.includes("replicate"), "the family must not require the retired provider");

  assert.ok(FAMILY_CREW.loreshort?.length, "the family must declare its crew");
  assert.ok(!FAMILY_CREW.loreshort.includes("composer"),
    "the lore engine beds no score — a composer brief would be a wasted call");

  // Every exhaustive Record<FamilyKey, …> must have grown an entry.
  for (const key of Object.keys(FAMILIES) as FamilyKey[]) {
    assert.ok(CONTENT_LANE_BY_FAMILY[key], `${key} must map to a content lane`);
  }
  assert.equal(CONTENT_LANE_BY_FAMILY.loreshort, "lore_micro_doc");

  const lane = CONTENT_LANE_POLICIES.lore_micro_doc;
  assert.equal(lane.family, "loreshort");
  assert.equal(lane.primaryRenderer, "lore_short");
  assert.ok(lane.requiredBlocks.includes("lore_short"));
  assert.ok(lane.forbiddenBlocks?.includes("timeline_assemble"),
    "a self-contained engine must forbid the legacy assembly path");
  assert.ok(!lane.forbiddenRendererBlocks.includes("lore_short"), "a lane must not forbid its own renderer");

  // Every OTHER lane must treat lore_short as a visual-language swap.
  for (const [key, policy] of Object.entries(CONTENT_LANE_POLICIES)) {
    if (key === "lore_micro_doc" || key === "legacy_unclassified") continue;
    assert.ok(
      policy.forbiddenRendererBlocks.includes("lore_short"),
      `${key} must forbid lore_short — otherwise a channel could silently swap into it`,
    );
  }

  const quality = LANE_QUALITY_POLICIES.lore_micro_doc;
  assert.ok(quality, "the new lane needs its own quality calibration");
  assert.ok(quality.emphasis.length > 0, "the critic needs lane-specific things to scrutinise");
  assert.ok(quality.maxCritiqueIters <= 2, "each iteration risks paid work — keep the cap tight");
  assert.equal(laneQualityPolicy("lore_micro_doc"), quality, "the resolver must find the new lane");

  const archetype = ARCHETYPES["lore-short"];
  assert.ok(archetype, "the family's archetype must exist");
  const blocks = archetype.pipeline.map((entry) => entry.block);
  assert.ok(blocks.includes("lore_short"));
  for (const replaced of ["script_gen", "narration_tts", "stock_footage", "timeline_assemble", "music"]) {
    assert.ok(!blocks.includes(replaced), `${replaced} is replaced by the self-contained engine`);
  }
}

/* ── 6. THE BLOCK IS REGISTERED AND ITS ABI MATCHES whiteboard_scribe ────────── */
function blockIsRegisteredWithTheRightAbi(): void {
  registerAllBlocks();
  const manifest = getManifest("lore_short");
  assert.ok(manifest, "lore_short must be registered in the production runner");
  const block = manifest.block;
  assert.deepEqual(block.consumes, ["topic"]);
  assert.deepEqual(
    [...block.produces].sort(),
    ["narrationText", "videoDurationSec", "videoKey", "videoLocalPath"],
    "produces must mirror whiteboard_scribe's self-contained shape",
  );
  assert.equal(block.paid, true, "the block buys stills, clips and narration");
  // Same self-contained ABI as the sibling engine — one producer of the master.
  assert.deepEqual(
    [...manifest.block.produces].sort(),
    [...getManifest("whiteboard_scribe")!.block.produces].sort(),
    "lore_short and whiteboard_scribe must expose the identical self-contained output contract",
  );

  assert.equal(manifest.certification.status, "contract");
  assert.ok(manifest.capabilities.includes("master.assembled"),
    "a self-contained engine produces the master itself");
  assert.equal(manifest.costAndLatency.paid, true);
  assert.equal(manifest.qualityContract.required, true, "a paid render must be quality-gated");
  // Everything the block reads off the store must be declared, or the runner
  // denies the read at runtime.
  for (const key of ["visualBrief", "persona", "title", "voiceId", "ttsProvider", "contentLane", "criticDoctrine"]) {
    assert.ok(
      key in manifest.optionalConsumes || key in manifest.consumes,
      `lore_short reads "${key}" from the store, so it must be declared`,
    );
  }

  assert.equal(CATALOG_EXECUTION_BINDINGS.loreshort.kind, "pipeline-module",
    "the catalog must no longer claim the adapter is pending");
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.loreshort.executableIds, ["lore_short"]);
}

/* ── 7. THE DESIGNED PIPELINE IS ACTUALLY RUNNABLE ──────────────────────────── */
function designedPipelineIsSelfContainedAndGated(): void {
  const design = designPipeline({
    family: "loreshort",
    nicheKey: "history",
    lengthMinutes: 1,
    publishMode: "draft",
  });
  assert.equal(design.available, true, "the loreshort family must design a runnable pipeline");
  const blocks = design.pipeline.map((entry) => entry.block);

  assert.equal(
    blocks.filter((block) => block === "lore_short").length,
    1,
    "exactly one lore_short — two producers of videoKey fail validation",
  );
  for (const replaced of ["script_gen", "narration_tts", "stock_footage", "gen_footage", "timeline_assemble", "music"]) {
    assert.ok(!blocks.includes(replaced), `${replaced} must not survive alongside the self-contained engine`);
  }

  const engineAt = blocks.indexOf("lore_short");
  const complianceAt = blocks.indexOf("compliance_check");
  const originalityAt = blocks.indexOf("originality_gate");
  assert.ok(complianceAt >= 0 && complianceAt < engineAt,
    "the topic must be compliance-gated BEFORE the paid engine runs");
  assert.ok(originalityAt > engineAt,
    "originality judges the narration the engine wrote, so it must run after it");

  // The operator's chosen length must actually reach the engine.
  const entry = design.pipeline.find((e) => e.block === "lore_short")!;
  assert.equal(Number(entry.params?.["targetSeconds"]), 60,
    "lengthMinutes must be pinned onto the engine, not silently dropped");
  assert.ok(
    Number.isFinite(design.compilation?.reservedMaxCostUsd) &&
      (design.compilation?.reservedMaxCostUsd ?? -1) > 0,
    "the paid engine must reserve a finite, non-zero spend envelope",
  );
}

/* ── 8. THE COST CEILING IS REAL AND SCALES ─────────────────────────────────── */
function costCeilingScalesWithBeats(): void {
  const manifest = getManifest("lore_short")!;
  const envelope = manifest.costAndLatency.maxCostUsdFor;
  assert.ok(typeof envelope === "function", "lore_short must price itself per configuration");
  const ceilingFor = (targetSeconds: number): number => envelope!({ targetSeconds }, undefined);
  const short = ceilingFor(40);
  const long = ceilingFor(120);
  assert.ok(short > 0, "a paid block must reserve more than $0");
  assert.ok(long > short, "a longer video buys more beats, so it must reserve more");
  const capped = ceilingFor(100_000);
  assert.ok(
    capped <= manifest.costAndLatency.maxCostUsd!,
    "the per-configuration ceiling must never exceed the declared hard cap",
  );
}

async function main(): Promise<void> {
  storyDefectsAreReal();
  beatSizingIsBounded();
  await blockUsesAttestedProvidersAndR2();
  await engineDefaultsSurviveForTheCli();
  familyLaneArchetypeAreConsistent();
  blockIsRegisteredWithTheRightAbi();
  designedPipelineIsSelfContainedAndGated();
  costCeilingScalesWithBeats();
  console.log("lore_short wiring tests passed (injected providers → attested Novita + R2; family/lane/archetype consistent)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
