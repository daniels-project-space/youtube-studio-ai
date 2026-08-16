import assert from "node:assert/strict";

import {
  buildAndPersistIllustratedFoundation,
} from "@/trigger/deterministicIllustratedFoundation";
import type { DeterministicFoundationObjectWriter } from "@/trigger/deterministicQuizYearFoundation";

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
  const result = await buildAndPersistIllustratedFoundation({
    channelName: "The Scenario Desk",
    storagePrefix: "owner/owner-test/channel/scenario-desk/",
    writer,
  });

  assert.equal(writes.length, 3);
  assert.equal(result.foundation.family, "illustrated_explainer");
  assert.equal(result.foundation.starterSlate.sourcePolicy.claimMode, "fictional_no_external_claims");
  assert.deepEqual(result.foundation.starterSlate.sources, []);
  assert.equal(result.foundation.cost.maximumProviderCostUsd, 0);
  assert.equal(result.foundation.publishing.automaticPublishAllowed, false);
  assert.equal(result.receipt.providerCostUsd, 0);
  assert.equal(result.receipt.publishingState, "draft");
  assert.ok(writes.every((write) => write.key.includes(result.foundation.foundationFingerprint)));

  console.log("Deterministic Illustrated Explainer foundation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
