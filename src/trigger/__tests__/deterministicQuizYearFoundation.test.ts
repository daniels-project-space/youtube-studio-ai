import assert from "node:assert/strict";

import {
  buildAndPersistQuizYearFoundation,
  type DeterministicFoundationObjectWriter,
} from "@/trigger/deterministicQuizYearFoundation";

const writes: Array<{ key: string; sha256: string; contentType: string; byteLength: number }> = [];
const writer: DeterministicFoundationObjectWriter = {
  async writeImmutable(artifact) {
    writes.push({
      key: artifact.key,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
      byteLength: artifact.byteLength,
    });
    return {
      key: artifact.key,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
      byteLength: artifact.byteLength,
    };
  },
};

async function main() {
  const result = await buildAndPersistQuizYearFoundation({
    channelName: "Quiz & Curiosity",
    storagePrefix: "owner/owner-test/channel/quiz-curiosity/",
    programBriefFingerprint: "a".repeat(64),
    programBriefPositioningText: "QuizYear trivia for curious adults; sourced rounds spanning science and history.",
    writer,
  });

  assert.equal(writes.length, 3);
  assert.equal(result.foundation.family, "quizyear");
  assert.equal(result.foundation.cost.maximumProviderCostUsd, 0);
  assert.equal(result.foundation.publishing.automaticPublishAllowed, false);
  assert.equal(result.receipt.providerCostUsd, 0);
  assert.equal(result.receipt.publishingState, "draft");
  assert.equal(result.foundation.starterSlate.entries.length, 3);
  assert.deepEqual(result.foundation.starterSlate.entries.map((entry) => entry.ordinal), [1, 2, 3]);
  assert.ok(writes.every((write) => write.key.includes(result.foundation.foundationFingerprint)));

  console.log("Deterministic QuizYear foundation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
