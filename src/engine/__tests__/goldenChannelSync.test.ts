import assert from "node:assert/strict";
import type { Doc } from "../../../convex/_generated/dataModel";
import { comparablePipeline } from "@/engine/channelPipelineUpgrade";
import { syncChannelPipelines } from "@/lib/goldenChannelSync";
import type { PipelineEntry } from "@/engine/types";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { updatePipelineIfCurrent } from "../../../convex/channels";

async function main() {
assert.equal(
  comparablePipeline([{ block: "x", params: { z: 1, a: { y: 2, x: 1 } } }]),
  comparablePipeline([{ block: "x", params: { a: { x: 1, y: 2 }, z: 1 } }]),
  "CAS comparison must ignore object insertion order",
);

const legacy: PipelineEntry[] = [
  "competitor_research", "topic_select", "script_gen", "qa_script", "originality_gate",
  "compliance_check", "narration_tts", "stock_footage", "entity_imagery", "music",
  "timeline_assemble", "qa_refine", "length_check", "captions", "metadata",
  "thumbnail_gen", "upload_draft", "notify", "cleanup",
].map((block) => ({ block }));

const channel = {
  _id: "channels:test",
  _creationTime: 1,
  ownerId: "owner-test",
  name: "Test channel",
  slug: "test-channel",
  pipeline: legacy,
} as Doc<"channels">;

const writes: unknown[] = [];
const conflictClient = {
  mutation: async (_reference: unknown, args: unknown) => {
    writes.push(args);
    return { state: "conflict" as const };
  },
  query: async () => { throw new Error("verify:false must not issue a verification read"); },
} as unknown as StudioConvexHttpClient;

const conflict = await syncChannelPipelines({
  convex: conflictClient,
  ownerId: "owner-test",
  channels: [channel],
  verify: false,
});
assert.equal(writes.length, 1);
assert.deepEqual((writes[0] as { expectedPipeline: PipelineEntry[] }).expectedPipeline, legacy);
const compiledConflictPipeline = (writes[0] as { pipeline: PipelineEntry[] }).pipeline;
assert.equal(
  compiledConflictPipeline.findIndex((entry) => entry.block === "qa_visual"),
  compiledConflictPipeline.findIndex((entry) => entry.block === "upload_draft") - 1,
  "fleet sync must add the visual release gate immediately before upload",
);
assert.equal(conflict.conflicts, 1);
assert.equal(conflict.applied, 0);
assert.equal(conflict.verified, false);
assert.equal(conflict.verification, "skipped");

async function invokeMutation<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(ctx, args);
}

let persistedPipeline: PipelineEntry[] = [{ block: "architect-newer" }];
let patchCount = 0;
const casContext = {
  auth: {
    getUserIdentity: async () => ({
      subject: "trigger-service",
      role: "service",
      owner_id: "owner-test",
      issuer: "https://studio.test",
      tokenIdentifier: "test|service",
    }),
  },
  db: {
    normalizeId: (_table: string, value: string) => value,
    get: async () => ({ ...channel, pipeline: persistedPipeline }),
    patch: async (_id: unknown, patch: { pipeline: PipelineEntry[] }) => {
      patchCount++;
      persistedPipeline = patch.pipeline;
    },
  },
};
const rejectedRace = await invokeMutation<{ state: string }>(
  updatePipelineIfCurrent,
  casContext,
  {
    ownerId: "owner-test",
    channelId: channel._id,
    expectedPipeline: legacy,
    pipeline: [{ block: "compiled-target" }],
  },
);
assert.equal(rejectedRace.state, "conflict");
assert.equal(patchCount, 0, "a stale sync must never overwrite an architect write");
const acceptedCas = await invokeMutation<{ state: string }>(
  updatePipelineIfCurrent,
  casContext,
  {
    ownerId: "owner-test",
    channelId: channel._id,
    expectedPipeline: [{ block: "architect-newer" }],
    pipeline: [{ block: "compiled-target" }],
  },
);
assert.equal(acceptedCas.state, "updated");
assert.equal(patchCount, 1);

const dryRun = await syncChannelPipelines({
  convex: conflictClient,
  ownerId: "owner-test",
  channels: [channel],
  dryRun: true,
});
assert.equal(dryRun.verified, false, "dry-run is analysis, not persisted verification");
assert.equal(dryRun.verification, "dry-run");
assert.equal(dryRun.channels[0]?.writeState, "dry-run");

let verifiedPipeline = legacy;
const verifiedClient = {
  mutation: async (_reference: unknown, args: { pipeline: PipelineEntry[] }) => {
    verifiedPipeline = args.pipeline;
    return { state: "updated" as const };
  },
  query: async () => [{ ...channel, pipeline: verifiedPipeline }],
} as unknown as StudioConvexHttpClient;
const verifiedWrite = await syncChannelPipelines({
  convex: verifiedClient,
  ownerId: "owner-test",
  channels: [channel],
});
assert.equal(verifiedWrite.applied, 1);
assert.equal(verifiedWrite.conflicts, 0);
assert.equal(verifiedWrite.verified, true);
assert.equal(verifiedWrite.verification, "verified");
assert.equal(
  verifiedPipeline.findIndex((entry) => entry.block === "qa_visual"),
  verifiedPipeline.findIndex((entry) => entry.block === "upload_draft") - 1,
  "persisted fleet upgrade must retain the visual gate",
);

console.log("GOLDEN CHANNEL SYNC CAS TESTS PASS");
}

void main();
