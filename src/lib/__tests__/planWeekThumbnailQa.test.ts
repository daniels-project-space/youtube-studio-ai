import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  makePlanWeekThumbnailQaCheckpoint,
  planWeekThumbnailQaCheckpointSha256,
  validatePlanWeekThumbnailQaCheckpoint,
} from "@/lib/planWeekThumbnailQa";
import {
  resolveGoldenThumbnailPlaybook,
  selectGoldenThumbnailPattern,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";

const sha = (character: string) => character.repeat(64);
const playbook: ThumbnailPlaybook = {
  source: "verified_references",
  energy: "bold",
  visualLanguage: {
    font: "serif",
    treatment: "plate",
    baseColor: "#050505",
    accentColor: "#c9a34e",
    imageStyle: "painterly marble chiaroscuro with gold-dust light",
    badgeStyle: "pill",
    textObject: "block_plate",
    composition: "full_scene",
    uppercase: true,
  },
  rules: [
    "Use a cinematic marble Stoic hero against a black void.",
    "Preserve a clean local-type zone and gold accent hierarchy.",
  ],
  avoid: ["generic stock scenes"],
  patterns: [
    {
      name: "quiet-strength",
      when: "inner resilience",
      fluxRecipe: "Marble hero in painterly chiaroscuro; reserve <TEXT_ZONE>.",
      textRecipe: { lines: [{ text: "<HOOK_WORD>", accent: true }], position: "left" },
    },
    {
      name: "fear-root",
      when: "fear and anxiety",
      fluxRecipe: "A marble hero dismantles <TOPIC_CONFLICT> in a black void.",
      textRecipe: { lines: [{ text: "<PAYOFF_WORD>", accent: true }], position: "right" },
    },
  ],
  refsUsed: [{ url: "https://example.com/ref.jpg", views: 1_000_000, why: "mobile-clear" }],
  distilledAt: 1,
};

const resolved = resolveGoldenThumbnailPlaybook({
  storedPlaybook: playbook,
  channelName: "Quiet Stoics",
});
assert.equal(resolved.playbook, playbook, "the full stored playbook must be used without rewriting it");
assert.equal(resolved.strategy, "playbook");
assert.deepEqual(
  selectGoldenThumbnailPattern({ playbook, seed: "item-1" }),
  selectGoldenThumbnailPattern({ playbook, seed: "item-1" }),
  "pattern selection must be deterministic across recovery",
);

const binding = {
  checkpointKey: "thumbnail:item:1",
  providerRequestSha256: sha("a"),
  candidateSha256: sha("b"),
};
const checkpoint = makePlanWeekThumbnailQaCheckpoint({
  ...binding,
  qaRequestSha256: sha("c"),
  verdict: {
    textOk: true,
    faceClear: true,
    punch: 8,
    styleMatch: 9,
    storyMatch: 8,
    uiClean: true,
    reason: "clear at mobile size and stronger than the reference set",
  },
  costUsd: 0.002431,
  usageFingerprint: sha("d"),
  createdAt: 123,
});
assert.equal(validatePlanWeekThumbnailQaCheckpoint(checkpoint, binding), true);
assert.equal(
  planWeekThumbnailQaCheckpointSha256(checkpoint),
  planWeekThumbnailQaCheckpointSha256(structuredClone(checkpoint)),
  "QA receipt hash must be canonical and recovery-stable",
);
assert.equal(validatePlanWeekThumbnailQaCheckpoint(checkpoint, {
  ...binding,
  candidateSha256: sha("e"),
}), false, "QA cannot be rebound to another artifact");
assert.throws(() => makePlanWeekThumbnailQaCheckpoint({
  ...binding,
  qaRequestSha256: sha("c"),
  verdict: { ...checkpoint.verdict, punch: 6 },
  costUsd: checkpoint.costUsd,
  usageFingerprint: sha("d"),
}), /below the production bar/);

const plannerSource = readFileSync(
  new URL("../../trigger/planWeekAhead.ts", import.meta.url),
  "utf8",
);
const qaPersist = plannerSource.indexOf("await persistPlanWeekThumbnailQaCheckpoint(o.qaKey, qaCheckpoint)");
const finalArtifactPut = plannerSource.indexOf("await putObject(key, artifactBytes", qaPersist);
assert.ok(qaPersist >= 0 && finalArtifactPut > qaPersist,
  "the durable passing QA receipt must precede the final artifact write");
assert.match(plannerSource, /checkpoint\.fingerprint !== qaCheckpoint\.usageFingerprint/);
assert.match(plannerSource, /head\.metadata\[PLAN_WEEK_QA_METADATA\.checkpointSha256\]/);
assert.match(plannerSource, /artifactCreatedAt < qaCheckpoint\.createdAt/);
assert.match(plannerSource, /refusing Golden instantiation, QA, or provider replay/);
const receiptExpose = plannerSource.indexOf("providerReceipt = receipt;", plannerSource.indexOf("const receipt = makePlanWeekProviderRenderReceipt"));
const sourcePersist = plannerSource.indexOf("await persistNanoBananaSourceCheckpoint", receiptExpose);
assert.ok(receiptExpose >= 0 && sourcePersist > receiptExpose,
  "paid evidence must reach the outer recovery boundary before ambiguous source persistence");

console.log("PLAN WEEK THUMBNAIL QA PASS");
