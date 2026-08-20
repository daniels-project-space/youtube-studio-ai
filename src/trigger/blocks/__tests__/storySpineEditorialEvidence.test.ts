import assert from "node:assert/strict";

import type { StageContext } from "@/engine/types";
import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";
import { storySpine } from "@/trigger/blocks/storySpineBlocks";

const now = Date.now();

function baseCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    ownerId: "owner-test",
    runId: "run-test",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/test/",
    params: {},
    store: {},
    budgetUsd: 1,
    log: () => {},
    ...overrides,
  };
}

function reviewedPacket() {
  return createEditorialEvidencePacket({
    subject: "Weekly seed growth",
    sources: [{
      id: "source-seed-atlas",
      name: "Seed Atlas",
      url: "https://example.org/seed-atlas",
      snapshotSha256: "a".repeat(64),
      kind: "dataset",
    }],
    claims: [{
      id: "claim-weekly-sprouts",
      sourceIds: ["source-seed-atlas"],
      approvedText: "Seed Atlas recorded 20 sprouts in week one and 35 in week two.",
      numericAnchor: "20 and 35",
      context: "Reviewed weekly seed-growth trend.",
    }],
    review: {
      reviewerId: "editorial-reviewer",
      reviewId: "review-seed-growth",
      reviewedAt: new Date(now).toISOString(),
    },
    now,
  });
}

async function run(): Promise<void> {
  const logs: string[] = [];
  const patch = await storySpine.run(baseCtx({
    store: {
      topic: "Weekly seed growth",
      narrationDurationSec: 30,
      editorialEvidencePacket: reviewedPacket(),
      sentenceTimings: [
        { text: "Seed Atlas recorded 20 sprouts in week one and 35 in week two.", start: 0, end: 10 },
        { text: "The increase gives the gardener a useful comparison point.", start: 10, end: 20 },
        { text: "Next, we explain what might have changed between the two weeks.", start: 20, end: 30 },
      ],
    },
    log: (message: string) => logs.push(message),
  }));
  assert.ok(patch["timedScript"], "the actual Story Spine block must still produce its timed script");
  assert.ok(
    logs.some((message) => message.includes("editorial narration binding passed for 1 reviewed claims")),
    "a supplied editorial packet must be checked against the final timed narration before rendering",
  );

  await assert.rejects(
    () => storySpine.run(baseCtx({
      store: {
        topic: "Weekly seed growth",
        narrationDurationSec: 30,
        editorialEvidencePacket: reviewedPacket(),
        sentenceTimings: [
          { text: "Seed Atlas recorded a strong second week.", start: 0, end: 10 },
          { text: "The increase gives the gardener a useful comparison point.", start: 10, end: 20 },
          { text: "Next, we explain what might have changed between the two weeks.", start: 20, end: 30 },
        ],
      },
    })),
    /is not represented verbatim in one timed Story Spine sentence/,
    "a supplied packet must fail closed instead of allowing unreviewed factual narration",
  );
}

run()
  .then(() => console.log("story spine editorial evidence binding tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
