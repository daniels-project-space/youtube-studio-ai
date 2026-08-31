import assert from "node:assert/strict";
import {
  VISUAL_TREATMENT_CATALOG,
  VISUAL_TREATMENT_KEYS,
  assertVisualTreatmentCatalog,
  assertVisualTreatmentPlan,
  planVisualTreatment,
  visualTreatmentAutomaticAdmission,
  visualTreatmentChannelTypeSeeds,
  visualTreatmentKeyFromUnknown,
  visualTreatmentReferenceCriteria,
} from "../visualTreatmentCatalog";

function main(): void {
  assertVisualTreatmentCatalog();
  assert.deepEqual(
    VISUAL_TREATMENT_KEYS,
    ["clay_stop_motion", "brick_built_stop_motion", "anime_inspired_2d", "drawn_illustrated_2d"],
    "the registry should cover the four reusable treatment families without inventing four pipelines",
  );

  for (const key of VISUAL_TREATMENT_KEYS) {
    const first = planVisualTreatment(key);
    const second = planVisualTreatment(key);
    assert.equal(first.fingerprint, second.fingerprint, `${key} plan must be deterministic`);
    assert.equal(first.runtime.automaticAdmission, false, `${key} must not claim automatic renderer admission`);
    assert.equal(first.runtime.mode, "declarative_preproduction_and_qa_only");
    assert.ok(first.runtime.rendererPrerequisites.length >= 3, `${key} must state real adapter prerequisites`);
    assert.ok(first.storyboard.requiredReferenceKinds.includes("storyboard_frame"), `${key} needs storyboard evidence`);
    assert.ok(first.storyboard.requiredReferenceKinds.includes("mood_board"), `${key} needs a moodboard`);
    assert.ok(first.qaBenchmarks.some((benchmark) => benchmark.scope === "global"));
    assert.ok(first.qaBenchmarks.some((benchmark) => benchmark.scope === "frame"));
    assert.equal(first.channelType.admission, "supervised_only", `${key} channel type must stay supervised`);
    assert.equal(
      assertVisualTreatmentPlan(first).fingerprint,
      first.fingerprint,
      `${key} plan must be accepted only when canonical`,
    );
    assert.throws(
      () => assertVisualTreatmentPlan({ ...first, fingerprint: "0".repeat(64) }),
      /exactly match/i,
      `${key} must reject a prompt/QA bundle whose catalog fingerprint was edited`,
    );
    const criteria = visualTreatmentReferenceCriteria({
      key: first.treatmentKey,
      label: first.label,
      planFingerprint: first.fingerprint,
      qaBenchmarkIds: first.qaBenchmarks.map((benchmark) => benchmark.id),
    });
    assert.deepEqual(
      criteria.map((criterion) => criterion.id),
      first.qaBenchmarks.map((benchmark) => `visual-treatment/${key}/${benchmark.id}`),
      `${key} must turn every treatment benchmark into a final-master review criterion`,
    );
    assert.throws(
      () => visualTreatmentReferenceCriteria({
        key: first.treatmentKey,
        label: first.label,
        planFingerprint: first.fingerprint,
        qaBenchmarkIds: first.qaBenchmarks.slice(1).map((benchmark) => benchmark.id),
      }),
      /complete canonical QA benchmark set/i,
      `${key} must not allow a treatment to omit its hard-to-satisfy visual criteria`,
    );

    const admission = visualTreatmentAutomaticAdmission(key);
    assert.equal(admission.admitted, false, `${key} must fail closed until an adapter is benchmarked`);
    assert.ok(admission.blockers.some((blocker) => /benchmark/i.test(blocker)));
  }

  const brick = planVisualTreatment("brick_built_stop_motion");
  assert.equal(brick.label, "Brick-built stop-motion");
  assert.ok(!("publicVocabulary" in brick), "plans expose only implementation-neutral production rules");
  const brickDefinition = VISUAL_TREATMENT_CATALOG.find((profile) => profile.key === "brick_built_stop_motion");
  assert.ok(brickDefinition);
  assert.ok(brickDefinition.publicVocabulary.preferredTerms.every((term) => !/lego/i.test(term)));
  assert.ok(brickDefinition.qaBenchmarks.some((benchmark) => benchmark.id === "brick-brand-safety"));

  const drawn = planVisualTreatment("drawn_illustrated_2d");
  assert.ok(
    drawn.storyboard.animaticRules.some((rule) => /whiteboard|data-only/i.test(rule)),
    "the drawn treatment must keep character sheets conditional for whiteboard/data-only work",
  );
  const anime = planVisualTreatment("anime_inspired_2d");
  assert.ok(anime.qaBenchmarks.some((benchmark) => benchmark.id === "anime-line-and-cel-consistency"));
  const clay = planVisualTreatment("clay_stop_motion");
  assert.ok(clay.qaBenchmarks.some((benchmark) => benchmark.id === "clay-stepped-performance"));

  assert.equal(visualTreatmentKeyFromUnknown("anime_inspired_2d"), "anime_inspired_2d");
  assert.equal(visualTreatmentKeyFromUnknown("LEGO"), undefined, "brand wording must never select a treatment");
  assert.equal(visualTreatmentKeyFromUnknown("unknown-treatment"), undefined);
  assert.equal(visualTreatmentKeyFromUnknown(null), undefined);

  const seeds = visualTreatmentChannelTypeSeeds();
  assert.equal(seeds.length, VISUAL_TREATMENT_KEYS.length);
  assert.ok(seeds.every((seed) => seed.admission === "supervised_only"));
  assert.ok(seeds.every((seed) => seed.requiredModules.includes("visual_treatment_plan")));

  console.log("VISUAL TREATMENT CATALOG PASS");
}

main();
