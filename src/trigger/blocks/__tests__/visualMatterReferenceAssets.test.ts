import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { contentLaneForFamily } from "@/engine/contentLane";
import { generationProfile } from "@/engine/generationProfiles";
import { PRICE } from "@/engine/pricing";
import { getManifest } from "@/engine/registry";
import type { StageContext } from "@/engine/types";
import {
  attachVisualMatterReferenceAssets,
  planVisualMatter,
  visualMatterReferenceAssetsForShot,
} from "@/engine/visualMatter";
import type { NovitaBillingReceipt, NovitaRenderResult } from "@/lib/novitaRenderFarm";
import {
  materializeVisualMatterReferenceAssets,
  planVisualMatterReferenceRenders,
  visualMatterReferenceAssets,
} from "../novitaRenderBlocks";

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

const cinematicContentLane = contentLaneForFamily("cinematic");
assert(cinematicContentLane, "Visual Matter reference assets require the canonical cinematic content lane");
const narratedContentLane = contentLaneForFamily("narrated_stock");
assert(narratedContentLane, "the non-cinematic runtime rejection needs a canonical comparison lane");

async function main(): Promise<void> {
const manifest = planVisualMatter({
  topic: "Ada Lovelace and the first algorithm",
  channelName: "Cinematic Machines",
  styleDNA: { setting: "Victorian mechanical laboratory", colorGrade: "teal-and-brass filmic" },
  visualBrief: { mood: "reverent invention and quiet wonder" },
  ...story,
});
const profile = generationProfile("production");

const plan = planVisualMatterReferenceRenders(manifest, 999);
assert.equal(plan.requests.length, 4, "the real plan emits mood, character, setting, and storyboard references");
assert.ok(plan.requests.length <= 12, "the reference plan cannot exceed the 12-image hard cap");
assert.ok(plan.shots.every((shot) => shot.candidateCount === 1), "each reference request must admit exactly one image worker");
assert.ok(plan.shots.every((shot) => shot.cameraMove === "static"), "reference images must not create video work");
assert.ok(plan.shots.every((shot) => /^vmref-\d{2}-/.test(shot.id)), "direct worker identities must not reuse free-form storyboard IDs");
const saturatedPlan = planVisualMatterReferenceRenders({
  ...manifest,
  characters: Array.from({ length: 6 }, (_, index) => ({
    ...manifest.characters[0]!,
    id: `character-${index + 1}`,
    name: `Character ${index + 1}`,
  })),
  settings: Array.from({ length: 6 }, (_, index) => ({
    ...manifest.settings[0]!,
    id: `setting-${index + 1}`,
    name: `Setting ${index + 1}`,
  })),
}, 999);
assert.equal(saturatedPlan.requests.length, 12, "even an overfull Visual Matter plan must dispatch no more than 12 direct image workers");

const bytesByKey = new Map<string, Uint8Array>();
const receiptsByOutputId: Record<string, NovitaBillingReceipt> = {};
const requestSha256ByOutputId: Record<string, string> = {};
const candidates = plan.shots.map((shot, index) => {
  const outputId = `${shot.id}-c01`;
  const key = `owner/test/runs/reference-pack/image/${outputId}.png`;
  bytesByKey.set(key, new Uint8Array([index + 1, 20 + index, 240 - index]));
  requestSha256ByOutputId[outputId] = String(index + 1).repeat(64).slice(0, 64);
  receiptsByOutputId[outputId] = {
    provider: "novita",
    currency: "USD",
    receiptId: `receipt-${index + 1}`,
    gpuSku: "RTX 4090",
    gpuCount: 1,
    gpuSeconds: 12 + index,
    gpuRateUsdPerSecond: 0.0001,
    startupUsd: 0,
    storageUsd: 0,
    costUsd: 0.01 + index / 100,
    costSource: "lifecycle_estimate",
  };
  return { shotId: shot.id, candidateIndex: 0, outputId, key };
});
const result: NovitaRenderResult = {
  ok: true,
  phase: "image",
  stillKeys: candidates.map((candidate) => candidate.key),
  candidates,
  requestSha256ByOutputId,
  billingReceiptsByOutputId: receiptsByOutputId,
  outputs: candidates.length,
  durationSec: 0,
  costUsd: Object.values(receiptsByOutputId).reduce((total, receipt) => total + receipt.costUsd, 0),
  billingReceipt: receiptsByOutputId[candidates[0]!.outputId]!,
  requestCanonicalJson: "{}",
  raw: {} as never,
};

let reads = 0;
const assets = await materializeVisualMatterReferenceAssets({
  manifest,
  plan,
  result,
  profile,
  getBytes: async (key) => {
    reads += 1;
    const bytes = bytesByKey.get(key);
    if (!bytes) throw new Error(`unexpected R2 key ${key}`);
    return bytes;
  },
});
assert.equal(reads, plan.requests.length, "every emitted asset must bind to actual R2 bytes exactly once");
assert.equal(assets.length, plan.requests.length);
assert.ok(assets.every((asset) => asset.contentType === "image/png"));
assert.ok(assets.every((asset) => asset.receipt.provider === "novita"));
assert.ok(assets.every((asset) => asset.receipt.responseSha256 === asset.contentSha256));
assert.ok(assets.every((asset) => {
  const receipt = asset.receipt as { billingReceiptId?: unknown };
  return typeof receipt.billingReceiptId === "string" && receipt.billingReceiptId.startsWith("receipt-");
}));
const anchored = attachVisualMatterReferenceAssets(manifest, assets);
assert.equal(anchored.status, "anchored", "only byte/receipt-bound images may become QA anchors");
assert.equal(
  visualMatterReferenceAssetsForShot(anchored, "shot-0001").some((asset) => asset.id === "storyboard:shot-0001"),
  true,
  "the actual storyboard R2 asset must become a downstream QA reference",
);

await assert.rejects(
  () => materializeVisualMatterReferenceAssets({
    manifest,
    plan,
    result: { ...result, billingReceiptsByOutputId: {} },
    profile,
    getBytes: async (key) => bytesByKey.get(key)!,
  }),
  /exact worker receipt/i,
  "a reference asset must never be admitted with an aggregate or invented cost receipt",
);

await assert.rejects(
  () => materializeVisualMatterReferenceAssets({
    manifest,
    plan,
    result: { ...result, candidates: candidates.slice(1) },
    profile,
    getBytes: async (key) => bytesByKey.get(key)!,
  }),
  /incomplete exact candidate mapping/i,
  "a missing direct output must fail before any incomplete reference pack is used",
);

function stage(
  params: Record<string, unknown>,
  contentLane = cinematicContentLane,
): StageContext {
  return {
    ownerId: "owner-visual-matter-reference-test",
    channelId: "channel-visual-matter-reference-test",
    runId: "run-visual-matter-reference-test",
    keyPrefix: "owner/test/channels/cinematic",
    params,
    store: { contentLane, visualMatterManifest: manifest },
    budgetUsd: 0,
    log: () => undefined,
  };
}

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("disabled Visual Matter reference pack must not reach a provider");
}) as typeof fetch;
try {
  const noNeed = await visualMatterReferenceAssets.run(stage({ enabled: false }));
  assert.deepEqual(noNeed.visualMatterReferenceAssets, []);
  assert.equal(noNeed.__costUsd, 0, "no need must report zero provider spend");
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(fetchCalls, 0, "no need must not admit a direct worker or provider call");

await assert.rejects(
  () => visualMatterReferenceAssets.run(stage({ enabled: false }, narratedContentLane)),
  /require contentLane cinematic_ai/,
  "even a disabled direct reference block must reject a non-cinematic seed before provider admission",
);
assert.equal(fetchCalls, 0, "a rejected non-cinematic seed must not reach a provider");

registerAllBlocks();
const referenceManifest = getManifest("visual_matter_references");
assert.ok(referenceManifest, "the optional reference bridge must be registered");
assert.equal(referenceManifest.costAndLatency.paid, true);
assert.equal(
  referenceManifest.costAndLatency.maxCostUsd,
  12 * PRICE.novitaImageMaxUsd,
  "the static contract must retain its exact 12-image maximum",
);
assert.ok(getManifest("qa_assets")?.optionalConsumes.visualMatterReferenceAssets);
assert.ok(getManifest("qa_shots")?.optionalConsumes.visualMatterReferenceAssets);
assert.equal(
  getManifest("novita_render_images")?.optionalConsumes.visualMatterReferenceAssets,
  undefined,
  "reference R2 pixels must not be declared as primary keyframe-generator input",
);
assert.equal(
  getManifest("novita_render_video")?.optionalConsumes.visualMatterReferenceAssets,
  undefined,
  "reference R2 pixels must not be declared as primary video-generator input",
);

console.log("Visual Matter reference asset tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
