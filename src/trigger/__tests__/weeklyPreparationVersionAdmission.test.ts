import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex } from "@/lib/sha256";
import {
  normalizePlanWeekPreparationManifest,
  planWeekPreparationKey,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent } from "@/lib/preparedMediaStorage";

const scope = { ownerId: "owner-test", channelId: "channel-test", channelSlug: "history", batchId: "batch-test", itemId: "item-test" };
const manifestKey = planWeekPreparationKey(scope);
const base: PlanWeekPreparationManifest = {
  version: "plan-week-preparation/inputs-v1", ...scope,
  itemKey: "week-test:0", requestKey: "week-test", frozenAt: 1,
  plan: {
    topic: "The Missing Pin", title: "The Missing Pin", description: "A history story.",
    sceneSeed: "An archive with an old lock.", thumbnailKey: "owner/test/thumb.jpg", thumbnailSource: "planner_artwork",
  },
  execution: { pipeline: [{ block: "music" }], moduleConfig: {}, seedStore: {} },
  prompts: { script: "A grounded story.", narration: "Measured narration.", shotlist: "Show the lock.", visual: "Keep the lock readable." },
};

let manifestBytes: Uint8Array = new Uint8Array();
let reads: string[] = [];
let paidCalls = 0;
let writes = 0;
let dispatches = 0;
let mutations = 0;
let networkCalls = 0;
let sidecarMode: "existing" | "missing" | "stop" | "error" | "bytes" = "existing";
let sidecarError: unknown;
let sidecarBytes = Buffer.from("{}");
let channelPipeline: unknown[] = [];
const sidecarBoundary = new Error("unversioned task reached the existing sidecar boundary");
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const paid = async () => { paidCalls++; throw new Error("paid call forbidden"); };

async function main(): Promise<void> {
  globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://weekly-admission-test.invalid";
  loader._load = function (id, ...args) {
    if (id === "@trigger.dev/sdk") return {
      task: (definition: unknown) => definition,
      tasks: { trigger: async () => { dispatches++; throw new Error("dispatch forbidden"); } },
      idempotencyKeys: { create: async () => "test-idempotency" },
    };
    if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => {} };
    if (id === "@/lib/studioConvexHttpClient") return {
      StudioConvexHttpClient: class {
        async query() { return { ...scope, pipeline: channelPipeline }; }
        async mutation() { mutations++; throw new Error("mutation forbidden"); }
      },
    };
    if (id === "@/lib/storage") return {
      getObjectBytes: async (key: string, _bucket?: string, options?: unknown) => {
        assert.deepEqual(options, PREPARED_METADATA_READ, "every preparation metadata read must bound transfer and time");
        reads.push(key);
        if (key === manifestKey) return manifestBytes;
        if (sidecarMode === "stop") throw sidecarBoundary;
        if (sidecarMode === "missing") throw Object.assign(new Error("not found"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        if (sidecarMode === "error") throw sidecarError;
        if (sidecarMode === "bytes") return sidecarBytes;
        return Buffer.from("{}");
      },
      putObject: async () => { writes++; throw new Error("write forbidden"); },
    };
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/music") return { ...actual as object, generateSuno: paid, generateMureka: paid };
    if (id === "@/lib/scriptGen") return { ...actual as object, synthScript: paid };
    if (id === "@/lib/tts") return { ...actual as object, synthNarration: paid };
    if (id === "@/lib/novitaRenderFarm") return { ...actual as object, renderImages: paid };
    if (id === "@/lib/topicOptimizer") return { ...actual as object, optimizeTopics: paid };
    if (id === "@/lib/falNanoBananaProThumbnail") return { ...actual as object, generateFalNanoBananaProThumbnailWithReceipt: paid };
    return actual;
  };
  try {
    const require = createRequire(import.meta.url);
    type Producer = { run: (payload: unknown) => Promise<unknown> };
    const producers: [string, Producer][] = [
      ["music", require("../planWeekPreparedMusic").planWeekPreparedMusicTask],
      ["script", require("../planWeekPreparedScript").planWeekPreparedScriptTask],
      ["narration", require("../planWeekPreparedNarration").planWeekPreparedNarrationTask],
      ["images", require("../planWeekPreparedImages").planWeekPreparedImagesTask],
    ];
    const ahead = require("../planWeekAhead").planWeekAheadTask as {
      run: (payload: unknown, context: unknown) => Promise<unknown>;
    };

    assert.doesNotThrow(() => assertWeeklyPreparationVersionsSupported([
      { block: "music" }, { block: "script_gen", version: undefined, params: { version: "provider-model" } },
    ], "test"));
    assert.throws(() => assertWeeklyPreparationVersionsSupported([
      { block: "music", version: "1.0.0-migration" }, { block: "script_gen", version: "2.0.0" },
    ], "test"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /music@"1\.0\.0-migration" \(entry 0\)/);
      assert.match(error.message, /script_gen@"2\.0\.0" \(entry 1\)/);
      return true;
    });

    for (const version of ["1.0.0-migration", "2.0.0", " 1.0.0", "", null, 0]) {
      for (const mode of ["existing", "missing"] as const) {
        sidecarMode = mode;
        // Pin an unrelated stage too: a producer may not approve only its own block.
        const manifest = normalizePlanWeekPreparationManifest({ ...base, execution: {
          ...base.execution, pipeline: [{ block: "topic_select", version }, { block: "music" }],
        } });
        manifestBytes = Buffer.from(canonicalJson(manifest));
        const payload = {
          ...scope, manifestKey, manifestSha256: sha256BytesHex(manifestBytes), maxCostUsd: 2,
          shots: [{ id: "shot-1", prompt: "An archive with a sealed map", seed: 7 }],
        };
        for (const [name, producer] of producers) {
          reads = [];
          await assert.rejects(() => producer.run(payload), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes(`plan-week-prepared-${name}: unsupported explicit weekly preparation implementation versions`));
            assert.ok(error.message.includes(`topic_select@${JSON.stringify(version)}`));
            return true;
          });
          assert.deepEqual(reads, [manifestKey], `${name} must reject before attempting sidecar reuse (${mode})`);
        }
      }
      channelPipeline = [{ block: "script_gen", version }];
      await assert.rejects(() => ahead.run({ ownerId: scope.ownerId, channelId: scope.channelId }, {
        ctx: { run: { id: "run-test", version: "test" }, attempt: { number: 1 } },
      }), /plan-week-ahead: unsupported explicit weekly preparation implementation versions/);
      assert.equal(mutations, 0, "week-ahead must refuse pins before reserving a paid batch");
    }

    // Unversioned invocations still reach the original reuse path. Stop there,
    // without manufacturing a successful receipt or issuing generation work.
    manifestBytes = Buffer.from(canonicalJson(normalizePlanWeekPreparationManifest(base)));
    sidecarMode = "stop";
    for (const [name, producer] of producers) {
      reads = [];
      await assert.rejects(() => producer.run({
        ...scope, manifestKey, manifestSha256: sha256BytesHex(manifestBytes), maxCostUsd: 2,
        shots: [{ id: "shot-1", prompt: "An archive with a sealed map", seed: 7 }],
      }), (error: unknown) => error === sidecarBoundary);
      assert.equal(reads.length, 2, `${name} retains its unversioned sidecar path`);
    }
    const payload = { ...scope, manifestKey, manifestSha256: sha256BytesHex(manifestBytes), maxCostUsd: 2,
      shots: [{ id: "shot-1", prompt: "An archive with a sealed map", seed: 7 }] };
    const ambiguous = [
      Object.assign(new Error("bucket missing"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }),
      Object.assign(new Error("gateway missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
      Object.assign(new Error("unproven absence"), { name: "NoSuchKey" }),
      Object.assign(new Error("conflicting status"), { name: "NoSuchKey", $metadata: { httpStatusCode: 503 } }),
      Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }),
      new Error("metadata read timed out"), null,
    ];
    for (const error of ambiguous) {
      sidecarMode = "error"; sidecarError = error;
      for (const [name, producer] of producers) {
        reads = [];
        await assert.rejects(() => producer.run(payload), caught => caught === error);
        assert.equal(reads.length, 2, `${name} stops at ambiguous storage without a replacement purchase`);
      }
      assert.equal(preparedObjectAbsent(error), false);
    }
    assert.equal(preparedObjectAbsent({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }), true);
    for (const bytes of [Buffer.from("{"), Buffer.from([0x22, 0xff, 0x22]), Buffer.alloc(PREPARED_METADATA_READ.maxBytes + 1, 32)]) {
      assert.throws(() => decodePreparedMetadata(bytes));
      sidecarMode = "bytes"; sidecarBytes = bytes;
      for (const [, producer] of producers) await assert.rejects(() => producer.run(payload));
    }
    const valid = { script: "A complete source", unicode: "\u00e9", values: [1, false, null] };
    assert.deepEqual(decodePreparedMetadata(Buffer.from(JSON.stringify(valid))), valid);
    // Exact-limit whitespace is valid; the limit rejects, never truncates, a byte over.
    const atLimit = Buffer.alloc(PREPARED_METADATA_READ.maxBytes, 32);
    atLimit.write("{}");
    assert.deepEqual(decodePreparedMetadata(atLimit), {});
    assert.equal(paidCalls, 0);
    assert.equal(writes, 0);
    assert.equal(dispatches, 0);
    assert.equal(networkCalls, 0);
    sidecarMode = "missing";
    await assert.rejects(() => producers.find(([name]) => name === "script")![1].run(payload), /paid call forbidden/);
    assert.equal(paidCalls, 1, "confirmed missing object still admits first-time script generation (stubbed)");
    console.log("WEEKLY VERSION ADMISSION PASS: four real producers, version gates, bounded metadata, 28 ambiguous-read holds, 12 corrupt metadata holds, confirmed absence admits one stubbed purchase");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = originalUrl;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
