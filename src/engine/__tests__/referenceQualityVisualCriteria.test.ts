import assert from "node:assert/strict";

import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { referenceQualityVisualReviewCriteriaForRoute } from "@/engine/referenceQualityMechanicsRegistry";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createUnmeasuredReferenceQualityFinalMasterBinding } from "@/lib/referenceQualityFinalMasterBinding";

function routeFor(family: "whiteboard" | "comic") {
  const programBrief = createChannelProgramBrief({
    family,
    nicheKey: "educational",
    locale: "en",
    concept: "An original, focused channel program with a clear repeatable viewer payoff.",
  });
  const route = channelProgramRouteRunSeed({
    route: resolveChannelProgramRoute(programBrief),
    programBrief,
  });
  return route;
}

function criteriaFor(family: "whiteboard" | "comic", phase: "pre_review" | "post_review" = "post_review") {
  const route = routeFor(family);
  const contract = referenceQualityContractFor(route.family);
  const input = {
    route,
    ...(phase === "pre_review" ? { referenceQualityContract: contract } : { referenceQualityBinding: createUnmeasuredReferenceQualityFinalMasterBinding({
      contract,
      finalMasterSha256: "a".repeat(64),
      visualReviewFingerprint: "b".repeat(64),
      visualReviewReceiptFingerprint: "c".repeat(64),
    }) }),
  };
  return referenceQualityVisualReviewCriteriaForRoute(input);
}

const whiteboard = criteriaFor("whiteboard");
assert.deepEqual(
  whiteboard.map((criterion) => criterion.id),
  ["purposeful-visual-change", "legible-visual-model"],
  "Whiteboard production QA must review both purpose and legibility, not merely motion frequency.",
);
assert.match(whiteboard[1]!.criterion, /central diagram, spatial model, or illustrated metaphor/i);

const comic = criteriaFor("comic");
assert.deepEqual(
  comic.map((criterion) => criterion.id),
  ["staged-story-rhythm", "stable-visual-language"],
  "Motion-comic production QA must review its narrative staging and stable original visual language.",
);
assert.match(comic[1]!.criterion, /character treatment, framing language, and motion vocabulary/i);

const whiteboardBeforeReview = criteriaFor("whiteboard", "pre_review");
assert.deepEqual(
  whiteboardBeforeReview,
  whiteboard,
  "production QA may derive the exact canonical reference criteria from the sealed QualityBar before a final-master binding exists",
);

assert.throws(
  () => referenceQualityVisualReviewCriteriaForRoute({
    route: routeFor("whiteboard"),
    referenceQualityContract: referenceQualityContractFor("comic"),
  }),
  /contract family does not match/i,
  "a different family's pre-review contract must not lower or replace the sealed route standard",
);

console.log("reference-quality visual criteria test passed");
