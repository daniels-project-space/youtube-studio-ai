import assert from "node:assert/strict";
import Module from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { decodePreparedMetadata } from "@/lib/preparedMediaStorage";
import {
  planWeekPreparedFootageClipKey,
  planWeekPreparedFootageKey,
  planWeekPreparedH3FirstFrameKey,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { sha256BytesHex } from "@/lib/sha256";

const scope = { ownerId: "owner-engine", channelSlug: "archive", batchId: "batch-engine", itemId: "item-engine" };
const manifest: PlanWeekPreparationManifest = {
  version: PLAN_WEEK_PREPARATION_VERSION,
  ownerId: scope.ownerId,
  channelId: "channel-engine",
  channelSlug: scope.channelSlug,
  batchId: scope.batchId,
  itemId: scope.itemId,
  itemKey: "week:0",
  requestKey: "weekly-engine",
  frozenAt: 1_000,
  plan: { topic: "Archive", title: "Archive", description: "Evidence", sceneSeed: "A map", thumbnailKey: "owner/owner-engine/plan/image.png", thumbnailSource: "planner_artwork" },
  execution: { pipeline: [{ block: "gen_footage" }], moduleConfig: {}, seedStore: {} },
  prompts: { script: "Script", narration: "Narrate", shotlist: "Shots", visual: "Archive" },
};
const manifestSha256 = planWeekPreparationManifestSha256(manifest);
const outputBytes = new Uint8Array(2_048).fill(9);
const outputSha256 = sha256BytesHex(outputBytes);
const clipKey = planWeekPreparedFootageClipKey({ ...scope, index: 0 });
const firstFrameKey = planWeekPreparedH3FirstFrameKey({ ...scope, index: 0 });
const stageKey = planWeekPreparedFootageKey(scope).replace(/\.json$/u, ".engine-h3-staged.json");
const objects = new Map<string, Uint8Array>([
  [planWeekPreparationKey(scope), new TextEncoder().encode(canonicalJson(manifest))],
  [stageKey, new TextEncoder().encode(canonicalJson({
    version: "render-engine-h3-staged-footage/v1",
    manifestSha256,
    ownerId: scope.ownerId,
    channelId: manifest.channelId,
    channelSlug: scope.channelSlug,
    batchId: scope.batchId,
    itemId: scope.itemId,
    requestKey: manifest.requestKey,
    engine: { site: "https://jovial-camel-68.convex.site", projectName: "youtube-studio-ai", workflowId: "workflow123", profileRevisionSha256: "a".repeat(64) },
    jobs: [{
      sceneId: "shot-1",
      engineJobId: "enginejob123",
      requestManifestSha256: "b".repeat(64),
      prompt: "An archival room, no text.",
      seed: 812,
      studioFirstFrame: { r2Key: firstFrameKey, sha256: "c".repeat(64) },
      engineFirstFrame: { r2Key: `projects/youtube-studio-ai/inputs/sha256/${"c".repeat(64)}.png`, sha256: "c".repeat(64) },
      output: { r2Key: clipKey },
      maxCostUsd: 1.25,
    }],
  }))],
]);
let statusReads = 0;
let signedReads = 0;
let videoFetches = 0;
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (name, ...args) {
  if (name === "@trigger.dev/sdk") return { task: (definition: unknown) => definition };
  if (name === "@/lib/bootstrap") return { bootstrapSecrets: async () => undefined };
  if (name === "@/lib/storage") return {
    getObjectBytes: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("missing fixture"), { $metadata: { httpStatusCode: 404 } });
      return bytes;
    },
    putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch: string }) => {
      assert.equal(options.ifNoneMatch, "*");
      if (objects.has(key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
      objects.set(key, bytes);
    },
  };
  if (name === "@/lib/renderEngineH3StageClient") return {
    getH3JobStatusInRenderEngine: async () => {
      statusReads++;
      return { jobId: "enginejob123", status: "completed", progress: "report-ready", completedAt: 2_000, outputRetired: false,
        output: { bucket: "render-engine-output", key: "projects/youtube-studio-ai/jobs/enginejob123/output.mp4", bytes: outputBytes.byteLength, sha256: outputSha256, contentType: "video/mp4", verifiedAt: 1_999 } };
    },
    getVerifiedH3OutputReadbackInRenderEngine: async () => {
      signedReads++;
      return { bucket: "render-engine-output", key: "projects/youtube-studio-ai/jobs/enginejob123/output.mp4", bytes: outputBytes.byteLength, sha256: outputSha256, contentType: "video/mp4", verifiedAt: 1_999, url: "https://example.test/output.mp4", expiresInSeconds: 3_600 };
    },
  };
  return originalLoad.call(this, name, ...args);
};

async function main() {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_TOKEN = "d".repeat(64);
  globalThis.fetch = async (url) => {
    videoFetches++;
    assert.equal(String(url), "https://example.test/output.mp4");
    return new Response(outputBytes, { headers: { "content-type": "video/mp4", "content-length": String(outputBytes.byteLength) } });
  };
  try {
    const { materializeRenderEngineH3PreparedFootage } = await import("../renderEngineH3MaterializePreparedFootage");
    const sidecarKey = await materializeRenderEngineH3PreparedFootage(scope);
    assert.equal(sidecarKey, planWeekPreparedFootageKey(scope));
    assert.deepEqual(objects.get(clipKey), outputBytes, "the Engine bytes are copied to Studio's canonical R2 clip key");
    const result = decodePreparedMetadata(objects.get(sidecarKey)!);
    assert.equal((result as { renderer: { kind: string } }).renderer.kind, "render-engine-h3");
    assert.equal(statusReads, 1);
    assert.equal(signedReads, 1);
    assert.equal(videoFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = previousToken;
  }
  console.log("render Engine H3 materializer copies only a verified receipt into the canonical Studio R2 path");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { loader._load = originalLoad; });
