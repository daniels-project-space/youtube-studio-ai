import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  familyChannelInceptionCapability,
  familySupervisedChannelInceptionCapability,
} from "@/engine/channelInceptionCapability";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { designPipeline } from "@/engine/designer";
import { familyProductionReadiness } from "@/engine/families";
import {
  assessProductionEditorialAcceptance,
  buildQualityEvidence,
} from "@/engine/qualityEvidence";

function main(): void {
  const readiness = familyProductionReadiness("illustrated_explainer");
  assert.equal(
    readiness.productionReady,
    true,
    "illustrated production admission must align with a complete editorial policy",
  );
  assert.equal(familyChannelInceptionCapability("illustrated_explainer").mode, "registered_non_gemini");

  const brief = createChannelProgramBrief({
    family: "illustrated_explainer",
    nicheKey: "educational",
    locale: "en",
    concept: "A clear, original channel program with a repeatable viewer promise.",
  });
  const route = resolveChannelProgramRoute(brief);
  const design = designPipeline({
    family: brief.family,
    nicheKey: brief.nicheKey,
    programBrief: brief,
    programRoute: route,
  });
  assert.equal(route.routeKey, "illustrated-explainer/foundation/v1");
  assert.equal(design.contentLane.key, "illustrated_explainer");
  assert.equal(design.contentLane.primaryRenderer, "scene_compiler");

  const qaIndex = design.pipeline.findIndex((entry) => entry.block === "qa_visual");
  const uploadIndex = design.pipeline.findIndex((entry) => entry.block === "upload_draft");
  assert.ok(qaIndex >= 0 && uploadIndex > qaIndex, "production QA must precede the upload stage");
  assert.equal(design.pipeline[qaIndex]?.params?.["qaProfile"], "production");
  for (const required of ["story_spine", "episode_graph", "scene_compiler", "thumbnail_gen"] as const) {
    assert.ok(
      design.pipeline.some((entry) => entry.block === required),
      `illustrated route must retain its ${required} production dependency`,
    );
  }

  const evidence = buildQualityEvidence({
    episode: {
      lane: { key: "illustrated_explainer", renderer: "scene_compiler" },
      topic: "How feedback loops shape a city",
      title: "Feedback Loops, Illustrated",
      durationSec: 184,
      story: {
        source: "final-master-story-audit/v1",
        beatCount: 7,
        shotCount: 24,
        coverageRatio: 1,
      },
    },
    technical: {
      passed: true,
      evaluator: "render-validator",
      evidence: ["The final master has valid streams and no black frames."],
    },
    visual: {
      score: 8.6,
      minimumScore: 7,
      evaluator: "scene-aware visual review",
      evidence: ["Scene continuity and illustrated composition passed."],
    },
    temporal: {
      passed: true,
      evaluator: "per-shot pacing review",
      evidence: ["Shot timing and visual dynamism passed across the master."],
    },
    narrative: {
      passed: true,
      evaluator: "critic validation specification",
      evidence: ["Every measured story beat passed the critic contract."],
    },
    audio: {
      score: 8.4,
      minimumScore: 7,
      evaluator: "audio aesthetics grader",
      evidence: ["Narration and score passed the final-master aesthetics review."],
    },
    brand: {
      passed: true,
      evaluator: "channel identity grader",
      evidence: ["The illustrated channel identity lock remained intact."],
    },
  });
  const editorial = assessProductionEditorialAcceptance(evidence);
  assert.equal(evidence.release.hardGateReady, true);
  assert.equal(editorial.ready, true, editorial.blockers.join("; "));
  assert.deepEqual(editorial.requiredAxes, ["technical", "visual", "temporal", "narrative", "audio", "brand"]);

  const inceptionSource = readFileSync(new URL("../../trigger/designChannelInception.ts", import.meta.url), "utf8");
  const staticAdmissionGate = inceptionSource.indexOf("const certifiedAdmission = certifiedFamilyAdmission(payload.family);");
  const runtimeAdmissionGate = inceptionSource.indexOf(
    "const runtimeReadiness = familyProductionReadiness(payload.family, reviewedLtxRuntime.runtime);",
  );
  const secretBootstrap = inceptionSource.indexOf("await bootstrapSecrets(log);");
  assert.ok(
    staticAdmissionGate >= 0
      && runtimeAdmissionGate >= 0
      && secretBootstrap >= 0
      && staticAdmissionGate < runtimeAdmissionGate
      && runtimeAdmissionGate < secretBootstrap,
    "static family admission and the owner-scoped runtime admission must both reject before credential bootstrap",
  );
  assert.match(inceptionSource, /buildAndPersistIllustratedFoundation/);

  const qaSource = readFileSync(new URL("../../trigger/blocks/narratedBlocks.ts", import.meta.url), "utf8");
  assert.match(qaSource, /assessProductionEditorialAcceptance\(qualityEvidence\)/);
  const uploadSource = readFileSync(new URL("../../trigger/blocks/lofiBlocks.ts", import.meta.url), "utf8");
  assert.match(uploadSource, /assessProductionEditorialAcceptance\(quality\.data\)/);

  // Children remains a separately admitted, private-review-only path. Adding
  // the illustrated policy must never broaden it into automatic production.
  assert.equal(familyProductionReadiness("children_learning").productionReady, false);
  assert.equal(familyChannelInceptionCapability("children_learning").mode, "unregistered");
  const childrenSupervised = familySupervisedChannelInceptionCapability("children_learning");
  assert.ok(childrenSupervised);
  assert.equal(childrenSupervised.mode, "registered_supervised_non_gemini");
  assert.equal(childrenSupervised.reviewScope, "private_human_child_editor_review_only");

  console.log("Illustrated Explainer production policy admission tests passed");
}

main();
