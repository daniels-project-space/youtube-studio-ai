import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generationProfile } from "@/engine/generationProfiles";
import type { NovitaRenderResult, Shot } from "@/lib/novitaRenderFarm";
import { cropImageRegionToPng } from "@/lib/ffmpeg";
import {
  STORYBOARD_ATLAS_RUNTIME_VERSION,
  createStoryboardAtlasRenderPlan,
  materializeStoryboardAtlasCrops,
  requestedQualifiedStoryboardAtlasGrid,
  type StoryboardAtlasMaterializeRuntime,
} from "@/lib/storyboardAtlasRuntime";

function shot(id: string, candidateCount: number): Shot {
  return {
    id,
    prompt: `Cinematic frame for ${id}; preserve the recurring blue coat and brass compass.`,
    negative: "text, watermark",
    cameraMove: "static",
    shotScale: "wide",
    lens: "35mm",
    seconds: 4,
    motion: "wind moves the coat from frame zero",
    candidateCount,
  };
}

const shots = [shot("shot-a", 2), shot("shot-b", 1), shot("shot-c", 1), shot("shot-d", 2), shot("shot-e", 1)];
const plan = createStoryboardAtlasRenderPlan({
  shots,
  gridSize: 2,
  canvasWidth: 1_920,
  canvasHeight: 1_088,
});

assert.equal(plan.independentProviderCalls, 7);
assert.equal(plan.atlasProviderCalls, 3);
assert.equal(plan.jobs.length, 3);
assert.deepEqual(plan.jobs.map((job) => job.cells.map((cell) => `${cell.shotId}:${cell.candidateIndex}:${cell.coordinate}`)), [
  ["shot-a:0:A1", "shot-b:0:A2", "shot-c:0:B1", "shot-d:0:B2"],
  ["shot-e:0:A1"],
  ["shot-a:1:A1", "shot-d:1:A2"],
]);
assert.deepEqual(plan.jobs[0]!.cells[3]!.crop, { x: 960, y: 544, width: 960, height: 544 });
assert.match(plan.jobs[0]!.shot.prompt, /ONE borderless 2 by 2 cinematic storyboard atlas/u);
assert.match(plan.jobs[0]!.shot.prompt, /A1: Cinematic frame for shot-a/u);
assert.match(plan.jobs[0]!.shot.prompt, /No gutters, frames, separators/u);
assert.equal(plan.jobs.every((job) => job.shot.candidateCount === 1), true);
assert.match(plan.fingerprint, /^[a-f0-9]{64}$/u);

assert.throws(
  () => createStoryboardAtlasRenderPlan({ shots, gridSize: 8, canvasWidth: 1_920, canvasHeight: 1_088 }),
  /below the 256x144 floor/u,
  "an attractive provider-call saving must not authorize unusably small I2V keyframes",
);

const production = generationProfile("production");
assert.equal(requestedQualifiedStoryboardAtlasGrid({ value: undefined, profile: production }), undefined);
assert.throws(
  () => requestedQualifiedStoryboardAtlasGrid({ value: 2, profile: production }),
  /not qualified/u,
  "production must fail closed while the real Novita comparison is unavailable",
);
assert.equal(requestedQualifiedStoryboardAtlasGrid({
  value: 2,
  profile: production,
  registry: [{
    runtimeVersion: STORYBOARD_ATLAS_RUNTIME_VERSION,
    profileId: production.id,
    imageModel: production.image.model,
    imageRevision: production.image.revision,
    gridSize: 2,
    qualificationFingerprint: "a".repeat(64),
  }],
}), 2);

const sourceObjects = new Map<string, Uint8Array>();
const localObjects = new Map<string, Uint8Array>();
const uploaded = new Map<string, { bytes: Uint8Array; contentType: string; metadata: Record<string, string> }>();
const resultCandidates = plan.jobs.map((job) => {
  const outputId = `${job.shot.id}-c01`;
  const key = `owner/demo/source/${outputId}.png`;
  sourceObjects.set(key, new TextEncoder().encode(`sheet:${outputId}`));
  return { shotId: job.shot.id, candidateIndex: 0, outputId, key };
});
const requestSha256ByOutputId = Object.fromEntries(resultCandidates.map((candidate) => [
  candidate.outputId,
  createHash("sha256").update(`request:${candidate.outputId}`).digest("hex"),
]));
const billingReceiptsByOutputId = Object.fromEntries(resultCandidates.map((candidate) => [
  candidate.outputId,
  { receiptId: `billing:${candidate.outputId}` },
]));
const result = {
  candidates: resultCandidates,
  requestSha256ByOutputId,
  billingReceiptsByOutputId,
} as unknown as NovitaRenderResult;

const runtime: StoryboardAtlasMaterializeRuntime = {
  makeTempDir: async () => "/virtual/storyboard-atlas",
  getObjectBytes: async (key) => {
    const bytes = sourceObjects.get(key);
    if (!bytes) throw new Error(`missing fake source ${key}`);
    return bytes;
  },
  writeBytes: async (path, bytes) => { localObjects.set(path, bytes); },
  cropRegion: async (input, output, crop) => {
    assert(localObjects.has(input), `crop source was not materialized: ${input}`);
    localObjects.set(output, new TextEncoder().encode(`crop:${crop.x}:${crop.y}:${crop.width}:${crop.height}`));
  },
  readBytes: async (path) => {
    const bytes = localObjects.get(path);
    if (!bytes) throw new Error(`missing fake crop ${path}`);
    return bytes;
  },
  dimensions: (bytes) => {
    const marker = new TextDecoder().decode(bytes);
    if (marker.startsWith("sheet:")) return { width: 1_920, height: 1_088, contentType: "image/png" };
    const [, , , width, height] = marker.split(":");
    return { width: Number(width), height: Number(height), contentType: "image/png" };
  },
  putImmutable: async (key, bytes, contentType, metadata) => {
    assert.equal(uploaded.has(key), false, `duplicate immutable crop key: ${key}`);
    uploaded.set(key, { bytes, contentType, metadata });
    return key;
  },
};

async function assertMaterialization(): Promise<void> {
  const items = await materializeStoryboardAtlasCrops({
    plan,
    result,
    keyPrefix: "owner/demo/run/novita",
    runtime,
  });
  assert.equal(items.length, 7);
  assert.deepEqual(items.map((item) => `${item.shotId}:${item.candidateIndex}`), [
    "shot-a:0", "shot-a:1", "shot-b:0", "shot-c:0", "shot-d:0", "shot-d:1", "shot-e:0",
  ]);
  assert.equal(new Set(items.map((item) => item.stillKey)).size, 7);
  assert.equal(uploaded.size, 8);
  assert.equal(uploaded.get(`owner/demo/run/novita/atlas-plans/${plan.fingerprint}.json`)?.contentType, "application/json");
  for (const item of items) {
    assert.equal(item.derivation?.version, "storyboard-atlas-crop/v1");
    assert.equal(item.derivation?.planFingerprint, plan.fingerprint);
    assert.equal(item.derivation?.planKey, `owner/demo/run/novita/atlas-plans/${plan.fingerprint}.json`);
    assert.equal(item.derivation?.gridSize, 2);
    assert.match(item.derivation?.sourceRequestSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(item.derivation?.contentSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(uploaded.get(item.stillKey)?.metadata.cropSha256, item.derivation?.contentSha256);
  }

  await assert.rejects(
    () => materializeStoryboardAtlasCrops({
      plan,
      result: { ...result, candidates: resultCandidates.slice(1) } as NovitaRenderResult,
      keyPrefix: "owner/demo/run/novita",
      runtime,
    }),
    /incomplete exact sheet mapping/u,
  );

  // Exercise the real FFmpeg adapter on a physical 2x2 sheet. The bottom-right
  // crop must retain both its exact I2V geometry and its yellow source pixels.
  const dir = await mkdtemp(join(tmpdir(), "storyboard-atlas-crop-"));
  try {
    const atlas = join(dir, "atlas.png");
    const crop = join(dir, "b2.png");
    const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
    const ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
    execFileSync(ffmpeg, [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=960x544",
      "-f", "lavfi", "-i", "color=c=green:s=960x544",
      "-f", "lavfi", "-i", "color=c=blue:s=960x544",
      "-f", "lavfi", "-i", "color=c=yellow:s=960x544",
      "-filter_complex", "[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[out]",
      "-map", "[out]", "-frames:v", "1", atlas,
    ], { stdio: "ignore" });
    await cropImageRegionToPng(atlas, crop, { x: 960, y: 544, width: 960, height: 544 });
    const dimensions = JSON.parse(execFileSync(ffprobe, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", crop,
    ], { encoding: "utf8" })) as { streams?: Array<{ width?: number; height?: number }> };
    assert.deepEqual(dimensions.streams?.[0], { width: 960, height: 544 });
    const pixel = execFileSync(ffmpeg, [
      "-v", "error", "-i", crop, "-vf", "scale=1:1:flags=area,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "-",
    ]);
    assert(pixel[0]! > 240 && pixel[1]! > 240 && pixel[2]! < 20, `expected yellow B2 pixels, received ${[...pixel]}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

assertMaterialization()
  .then(() => console.log("storyboard atlas runtime tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
