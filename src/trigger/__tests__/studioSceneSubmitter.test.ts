import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreparedH3Batch,
  buildStudioSceneManifest,
  dispatchPreparedFootage,
  type PlanWeekPreparedImagesArgs,
} from "@/trigger/planWeekPreparedImages";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex } from "@/lib/sha256";
import {
  planWeekPreparationKey,
  type PlanWeekPreparationManifest,
  type PlanWeekPreparedImages,
} from "@/lib/planWeekPreparation";
const scope = {
  ownerId: "owner1",
  channelId: "channel1",
  channelSlug: "history",
  batchId: "week-1",
  itemId: "item-1",
};
function fixture() {
  const frames = [new Uint8Array(256).fill(1), new Uint8Array(256).fill(2)];
  const payload: PlanWeekPreparedImagesArgs = {
    ...scope,
    manifestKey: planWeekPreparationKey(scope),
    manifestSha256: "a".repeat(64),
    shots: [
      { id: "shot-1", prompt: "A quiet historic archive", seed: 1 },
      { id: "shot-2", prompt: "The archive map reveals a river", seed: 2 },
    ],
    maxCostUsd: 5,
  };
  const prepared = {
    ...scope,
    manifestSha256: payload.manifestSha256,
    items: frames.map((bytes, i) => ({
      shotId: `shot-${i + 1}`,
      candidateIndex: 0,
      stillKey: `source-${i}`,
      sha256: sha256BytesHex(bytes),
      byteLength: bytes.length,
    })),
  } as unknown as PlanWeekPreparedImages;
  const manifest = {
    execution: { pipeline: [{ block: "gen_footage" }] },
    requestKey: "request-1",
  } as unknown as PlanWeekPreparationManifest;
  return { payload, prepared, manifest, frames };
}
test("real multi-scene submitter freezes intent before admission and replays every deterministic job after lost stage response", async () => {
  const f = fixture();
  const previous = process.env.RENDER_ENGINE_PROJECT_TOKEN;
  process.env.RENDER_ENGINE_PROJECT_TOKEN = "a".repeat(64);
  const saved = new Map<string, string>();
  const jobs = new Map<string, string>();
  const keys: string[] = [];
  const events: string[] = [];
  let uncertain = true;
  const deps: any = {
    provision: async () => ({
      workflowId: "workflow1",
      profileRevisionSha256: "c".repeat(64),
    }),
    persist: async (key: string, bytes: Uint8Array) => {
      const text = new TextDecoder().decode(bytes);
      if (saved.has(key))
        assert.equal(saved.get(key), text, "create-only intent cannot change");
      else saved.set(key, text);
      events.push("persist");
    },
    bind: async () => {
      assert.ok(
        [...saved.keys()].some((key) => key.endsWith("h3-scenes.json")),
      );
      assert.equal(events.at(-1), "persist");
      events.push("bind");
      return { sceneCount: 2, reused: jobs.size > 0 };
    },
    read: async (key: string) => f.frames[Number(key.split("-")[1])],
    upload: async (_engine: any, input: any) => ({
      key: `projects/youtube-studio-ai/inputs/sha256/${input.sha256}.png`,
    }),
    stage: async (config: any) => {
      assert.ok(events.includes("bind"));
      const key = config.request.idempotencyKey;
      keys.push(key);
      const jobId = jobs.get(key) ?? `job${jobs.size + 1}`;
      jobs.set(key, jobId);
      assert.equal(
        config.studioBatch.ordinal,
        Number(config.studioBatch.sceneId.split("-")[1]) - 1,
      );
      if (uncertain && jobs.size === 2) {
        uncertain = false;
        throw new Error("lost accepted stage response");
      }
      return {
        jobId,
        state: "awaiting-final-qualification",
        manifestSha256: "d".repeat(64),
      };
    },
    qualify: async () => {
      throw new Error("No fake qualification");
    },
  };
  try {
    await assert.rejects(
      dispatchPreparedFootage(f.manifest, f.payload, f.prepared, deps),
      /lost/,
    );
    assert.equal(jobs.size, 2);
    assert.deepEqual(
      await dispatchPreparedFootage(f.manifest, f.payload, f.prepared, deps),
      ["job1", "job2"],
    );
    assert.deepEqual(keys.slice(0, 2), keys.slice(2));
    assert.equal(jobs.size, 2);
    const packet = JSON.parse(
      [...saved.entries()].find(([key]) => key.endsWith("h3-scenes.json"))![1],
    );
    assert.equal(packet.scenes.length, 2);
    assert.deepEqual(
      packet.scenes.map((s: any) => s.sceneId),
      ["shot-1", "shot-2"],
    );
    assert.ok(
      packet.scenes.every(
        (s: any) =>
          s.request.output.width === 1280 &&
          s.request.output.height === 736 &&
          s.request.durationSeconds === 5,
      ),
    );
    const changed = {
      ...f.payload,
      shots: [
        { ...f.payload.shots[0], prompt: "Different story" },
        f.payload.shots[1],
      ],
    };
    await assert.rejects(
      dispatchPreparedFootage(f.manifest, changed, f.prepared, deps),
      /create-only/,
    );
    assert.equal(keys.length, 4);
  } finally {
    if (previous === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN;
    else process.env.RENDER_ENGINE_PROJECT_TOKEN = previous;
  }
});
test("scene packet includes all ordered scene IDs and prepared receipt hash; no truncation", () => {
  const f = fixture();
  const batch = buildPreparedH3Batch({
    payload: f.payload,
    prepared: f.prepared,
    manifestSha256: f.payload.manifestSha256,
    maxCostUsd: 1.25,
  });
  const packet = buildStudioSceneManifest({
    ...f,
    batch,
    profileRevisionSha256: "c".repeat(64),
  });
  assert.equal(packet.scenes.length, 2);
  assert.equal(
    packet.preparedImagesSha256,
    sha256BytesHex(new TextEncoder().encode(canonicalJson(f.prepared))),
  );
  assert.notEqual(
    packet.scenes[0].request.idempotencyKey,
    packet.scenes[1].request.idempotencyKey,
  );
});
