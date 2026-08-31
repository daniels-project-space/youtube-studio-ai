import assert from "node:assert/strict";

import {
  FACTUAL_REVIEW_REQUIRED_ARTIFACTS,
  assertFactualReviewArtifactBindings,
  factualReviewApprovalFingerprint,
  factualReviewCheckpointFingerprint,
  factualReviewSourceAuthorityFromInvocation,
  type FactualReviewArtifactBinding,
} from "@/engine/factualReviewCheckpoint";

const fp = (character: string) => character.repeat(64);

function invocation(overrides: {
  authorityKind?: string;
  ledger?: unknown;
  seedLedger?: unknown;
  selectedCapabilityKeys?: unknown;
  selectorContentFingerprint?: string;
} = {}) {
  const ledger = overrides.ledger ?? {
    source: "World Bank",
    series: "NY.GDP.MKTP.CD",
    observations: [{ year: 2024, value: 99 }],
  };
  const contentFingerprint = fp("a");
  const authorityContentFingerprint = fp("b");
  return {
    showProfileFingerprint: fp("c"),
    seedStore: {
      dataStorySourceLedger: overrides.seedLedger ?? ledger,
      reviewedEvidencePackRunAdmission: {
        version: "reviewed-evidence-pack-run-admission/v1",
        authorityKind: overrides.authorityKind ?? "data_story_source_ledger",
        contentFingerprint,
        authorityContentFingerprint,
        routeSeedFingerprint: fp("d"),
        topicFingerprint: fp("e"),
        showProfileFingerprint: fp("c"),
        selectedCapabilityKeys: overrides.selectedCapabilityKeys ?? ["source_attributed_data_story"],
        selector: {
          packId: "reviewed-pack-1",
          contentFingerprint: overrides.selectorContentFingerprint ?? contentFingerprint,
        },
      },
      reviewedEvidencePack: {
        contentFingerprint,
        authorityContentFingerprint,
        sourceAuthority: {
          kind: overrides.authorityKind ?? "data_story_source_ledger",
          dataStorySourceLedger: ledger,
        },
      },
    },
  };
}

function artifacts(): FactualReviewArtifactBinding[] {
  return FACTUAL_REVIEW_REQUIRED_ARTIFACTS.map((requirement, index) => ({
    key: requirement.key,
    artifactId: `artifact-${index}`,
    payloadHash: fp((index % 10).toString()),
    producerModule: requirement.producerModule,
    producerVersion: "v1",
    schemaVersion: "schema/v1",
  }));
}

function sourceAuthorityRejectsAnythingButExactRawLedger(): void {
  const exact = factualReviewSourceAuthorityFromInvocation(invocation());
  assert.equal(exact.authorityKind, "data_story_source_ledger");
  assert.deepEqual(exact.selectedCapabilityKeys, ["source_attributed_data_story"]);

  assert.throws(
    () => factualReviewSourceAuthorityFromInvocation(invocation({ authorityKind: "editorial_evidence_packet" })),
    /raw data-story ledger authority/,
    "an editorial packet cannot impersonate raw ledger authority",
  );
  assert.throws(
    () => factualReviewSourceAuthorityFromInvocation(invocation({ seedLedger: { source: "substituted" } })),
    /exact frozen ledger/,
    "a browser- or retry-substituted ledger cannot replace the reviewed raw ledger",
  );
  assert.throws(
    () => factualReviewSourceAuthorityFromInvocation(invocation({ selectedCapabilityKeys: [] })),
    /source_attributed_data_story capability/,
  );
  assert.throws(
    () => factualReviewSourceAuthorityFromInvocation(invocation({ selectorContentFingerprint: fp("f") })),
    /selector is not bound/,
  );
}

function immutableArtifactFingerprintsAreOrderStableAndStrict(): void {
  const sourceAuthority = factualReviewSourceAuthorityFromInvocation(invocation());
  const bound = artifacts();
  const fingerprint = factualReviewCheckpointFingerprint({
    ownerId: "owner",
    channelId: "channel",
    runId: "run",
    invocationSha256: fp("1"),
    sourceAuthority,
    artifacts: bound,
  });
  assert.equal(
    factualReviewCheckpointFingerprint({
      ownerId: "owner",
      channelId: "channel",
      runId: "run",
      invocationSha256: fp("1"),
      sourceAuthority,
      artifacts: [...bound].reverse(),
    }),
    fingerprint,
    "receipt identity does not depend on database/iteration order",
  );
  assert.throws(
    () => assertFactualReviewArtifactBindings(bound.slice(1)),
    /retained artifact is missing/,
    "approval cannot omit an actual Story Spine/Episode Graph artifact",
  );
  assert.throws(
    () => assertFactualReviewArtifactBindings([
      ...bound,
      { ...bound[0]!, artifactId: "duplicate-artifact" },
    ]),
    /duplicate keys/,
    "a replay cannot smuggle two different values for one frozen requirement",
  );
  assert.notEqual(
    factualReviewApprovalFingerprint({ checkpointFingerprint: fingerprint, reviewerId: "owner", approvedAt: 1 }),
    factualReviewApprovalFingerprint({ checkpointFingerprint: fingerprint, reviewerId: "owner", approvedAt: 2 }),
    "each explicit approval is bound to one immutable decision event",
  );
}

sourceAuthorityRejectsAnythingButExactRawLedger();
immutableArtifactFingerprintsAreOrderStableAndStrict();
console.log("factual review checkpoint tests passed");
