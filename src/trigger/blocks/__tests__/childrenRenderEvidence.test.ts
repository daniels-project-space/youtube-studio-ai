import assert from "node:assert/strict";
import {
  assertChildContentRenderEvidence,
  CHILD_CONTENT_SAFETY_VERSION,
  type ChildContentSafetyReceipt,
} from "@/trigger/blocks/childrenSafetyBlocks";

const reviewedManifestFingerprint = "a".repeat(64);
const childSafety: ChildContentSafetyReceipt = {
  version: CHILD_CONTENT_SAFETY_VERSION,
  pass: true,
  madeForKids: true,
  audience: "children",
  release: "human-editorial-approval-required",
  allowedPublishMode: "draft",
  reviewReasons: ["Human editorial review is required."],
  episodeGraphFingerprint: "b".repeat(64),
  sceneManifestFingerprint: reviewedManifestFingerprint,
  lessonContractFingerprint: "c".repeat(64),
  childrenShowBibleFingerprint: "d".repeat(64),
};

const renderReceipt = {
  version: "scene-compiler-render/v1",
  renderer: "deterministic-scene/v1",
  manifestFingerprint: reviewedManifestFingerprint,
  externalProviderCalls: 0,
  hasAudio: true,
} as const;

assert.doesNotThrow(() => assertChildContentRenderEvidence({ childSafety, sceneCompilerReceipt: renderReceipt }));

assert.throws(
  () =>
    assertChildContentRenderEvidence({
      childSafety,
      sceneCompilerReceipt: { ...renderReceipt, manifestFingerprint: "d".repeat(64) },
    }),
  /not rendered from the reviewed scene manifest/,
);

assert.throws(
  () =>
    assertChildContentRenderEvidence({
      childSafety,
      sceneCompilerReceipt: { ...renderReceipt, externalProviderCalls: 1 },
    }),
  /lacks an audited deterministic render receipt/,
);

console.log("children render evidence tests passed");
