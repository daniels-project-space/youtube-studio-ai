import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { registerAllBlocks } from "@/engine/blocks";
import { MODULE_CATALOG } from "@/engine/moduleCatalog";
import { CORE_MODULE_SURFACES } from "@/engine/moduleSurfaces";
import { getManifest } from "@/engine/registry";
import type { Block, StageContext } from "@/engine/types";
import { visualMatterDirectiveForShot, visualMatterFromUnknown } from "@/engine/visualMatter";
import {
  VISUAL_MATTER_REFERENCE_ADAPTER_REQUIRED,
  VISUAL_MATTER_BLOCKS,
} from "../visualMatterBlocks";

const story = {
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [{ id: "entity-ada", name: "Ada", look: "a precise Victorian engineer with a dark teal coat" }],
    locations: [{ id: "location-lab", name: "Analytical Engine laboratory", look: "brass mechanical calculating room, tall windows" }],
    era: "1840s",
    wardrobe: ["dark teal coat", "high collar"],
    props: ["punched cards", "brass gears"],
    palette: ["dark teal", "aged brass", "warm window light"],
    cameraGrammar: ["measured dolly push"],
    negativeConstraints: ["text", "watermarks"],
  },
  narrativeBeats: [{
    id: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    purpose: "introduce the invention and its maker",
    evidenceRefs: ["script:sentence:1"],
  }],
  shotList: [{
    id: "shot-0001",
    beatId: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    coveragePurpose: "introduce the invention and its maker",
    literalContent: "Ada lays punched cards beside the analytical engine.",
    entities: ["entity-ada"],
    locationId: "location-lab",
    era: "1840s",
    wardrobe: ["dark teal coat"],
    props: ["punched cards", "brass gears"],
    continuityState: "Ada and laboratory remain coherent",
    cameraMove: "dolly_push" as const,
    shotScale: "medium" as const,
    lens: "35mm natural",
    lighting: "warm window light",
    motion: "Ada places a punched card beside the engine.",
    negative: "text, watermarks",
    generationProfile: "production" as const,
    candidateCount: 2,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Ada and the analytical engine.",
    seconds: 6,
    storyFunction: "introduction",
    section: "section-001",
    seed: 100001,
  }],
  dpVisualSpecs: [{
    shotId: "shot-0001",
    keyframePrompt: "Ada and the analytical engine in a brass laboratory.",
    motionPrompt: "Measured dolly push as Ada places the card.",
    negativePrompt: "text, watermarks",
    styleLock: "dark teal, aged brass",
    firstFrameConstraint: "Ada holds the card at 0.00s",
    lastFrameConstraint: "Ada has placed the card at 6.00s",
    continuityState: "Ada and laboratory remain coherent",
  }],
};

function stage(params: Record<string, unknown> = {}): StageContext {
  return {
    ownerId: "owner-visual-matter-policy-test",
    channelId: "channel-visual-matter-policy-test",
    runId: "run-visual-matter-policy-test",
    keyPrefix: "owner/visual-matter-policy-test/channel/",
    params,
    store: {
      topic: "Ada Lovelace and the first algorithm",
      channelName: "Cinematic Machines",
      styleDNA: { setting: "Victorian mechanical laboratory", colorGrade: "teal-and-brass filmic" },
      visualBrief: { mood: "reverent invention and quiet wonder" },
      ...story,
    },
    budgetUsd: 0,
    log: () => undefined,
  };
}

function visualMatterBlock(): Block {
  const block = VISUAL_MATTER_BLOCKS.find((candidate) => candidate.id === "visual_matter");
  assert.ok(block, "Visual Matter must remain an executable planning block");
  return block;
}

async function main(): Promise<void> {
  const block = visualMatterBlock();
  assert.equal(block.paid, false, "planning-only Visual Matter must not be a paid block");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("a non-thumbnail image provider must not be reached");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => block.run(stage({ renderReferenceAssets: true })),
      (error: unknown) => {
        assert.match(error instanceof Error ? error.message : String(error), /cannot render non-thumbnail reference assets/i);
        assert.match(error instanceof Error ? error.message : String(error), /direct-Novita\/licensed-source/i);
        return true;
      },
      "legacy paid Visual Matter configuration must fail before a provider call",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "the prohibited FAL/Nano Banana route must make zero network calls");

  await assert.rejects(
    () => block.run(stage({ visualTreatment: "unreviewed-style" })),
    /unknown visual treatment/i,
    "Visual Matter must reject an invented treatment before any planning or provider boundary",
  );

  const clayPlanned = await block.run(stage({ visualTreatment: "clay_stop_motion" }));
  const clayManifest = clayPlanned.visualMatterManifest as {
    treatment?: { key?: unknown; qaBenchmarkIds?: unknown };
    reviewLocks?: Array<{ acceptanceCriteria?: unknown }>;
  };
  assert.equal(clayManifest.treatment?.key, "clay_stop_motion");
  assert.ok(
    Array.isArray(clayManifest.treatment?.qaBenchmarkIds) && clayManifest.treatment.qaBenchmarkIds.includes("clay-stepped-performance"),
    "the runtime block must materialize only the catalog treatment's own review criteria",
  );
  assert.ok(
    clayManifest.reviewLocks?.[0]?.acceptanceCriteria instanceof Array &&
      clayManifest.reviewLocks[0].acceptanceCriteria.some((criterion) => /clay-stepped-performance/i.test(String(criterion))),
    "the selected treatment must become part of the existing visual-review handoff",
  );

  const planned = await block.run(stage());
  const manifest = planned.visualMatterManifest as { status?: unknown; referenceAssets?: unknown };
  assert.equal(manifest.status, "planned", "planning-only output must preserve the typed downstream manifest");
  assert.deepEqual(manifest.referenceAssets, [], "planning-only output must not fabricate provider-backed reference assets");
  assert.equal(planned.__costUsd, 0, "Visual Matter planning must report no provider spend");
  const parsed = visualMatterFromUnknown(planned.visualMatterManifest);
  assert.ok(
    visualMatterDirectiveForShot(parsed, "shot-0001"),
    "the planning-only manifest must remain consumable by the cinematic identity/QA handoff",
  );

  const blockSource = readFileSync(resolve(process.cwd(), "src/trigger/blocks/visualMatterBlocks.ts"), "utf8");
  assert.equal(/@\/lib\/(?:falNanoBanana|storage)/.test(blockSource), false, "Visual Matter must not import FAL or R2 storage");
  assert.equal(/generateFalNanoBanana2Image|\bputObject\s*\(/.test(blockSource), false, "Visual Matter must contain no FAL/R2 invocation seam");

  registerAllBlocks();
  const registered = getManifest("visual_matter");
  assert(registered, "Visual Matter must remain registered for cinematic QA consumers");
  assert.equal(registered.costAndLatency.paid, false, "the registered module must not advertise paid visual generation");
  assert.deepEqual(registered.providerProfiles.map((profile) => profile.provider), ["local"]);

  const catalog = MODULE_CATALOG.find((entry) => entry.block === "visual_matter");
  assert(catalog, "Visual Matter must remain available in the module catalog");
  assert.equal(catalog.params.some((param) => param.key === "renderReferenceAssets" || param.key === "maxReferenceImages"), false);
  assert.doesNotMatch(catalog.description, /fal|nano banana/i, "the catalog must not advertise a prohibited provider route");

  const surface = CORE_MODULE_SURFACES.find((entry) => entry.key === "visual_matter");
  assert(surface, "Visual Matter must retain a customization surface");
  const customization = surface.customization;
  assert(customization, "Visual Matter must retain customization controls");
  assert.equal(customization.knobs.some((knob) => knob.id === "renderReferenceAssets" || knob.id === "maxReferenceImages"), false);
  assert.doesNotMatch(
    [surface.does, ...customization.capabilities].join(" "),
    /fal|nano banana/i,
    "the module surface must not advertise a prohibited provider route",
  );
  assert.match(VISUAL_MATTER_REFERENCE_ADAPTER_REQUIRED, /thumbnail-only/i);
}

main()
  .then(() => console.log("visual matter provider policy tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
