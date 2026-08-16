import assert from "node:assert/strict";
import {
  NOVITA_LOCKED_VIDEO_RUNTIME,
  NOVITA_VIDEO_REQUIRED_BLOCKS,
  assessConfiguredNovitaVideoProfiles,
  assessNovitaVideoProfileRuntime,
  assessNovitaVideoPhaseProfileRuntime,
  assessPipelineVideoRuntimeReadiness,
  assertPipelineVideoRuntimeReady,
  isNovitaVideoRequiredBlock,
  novitaVideoProfileIdentity,
} from "@/engine/runtimeCapability";
import { generationProfile } from "@/engine/generationProfiles";

function configuredProfilesFailClosedOnTheLockedFleet(): void {
  const assessments = assessConfiguredNovitaVideoProfiles();
  assert.deepEqual(
    assessments.map((assessment) => assessment.profileId).sort(),
    ["draft", "hero", "production"],
  );
  for (const assessment of assessments) {
    assert.equal(assessment.model, "Lightricks/LTX-2.5");
    assert.equal(assessment.ready, false, `${assessment.profileId} must not advertise an unbenchmarked LTX runtime`);
    assert.equal(assessment.availableVramGb, 24);
    assert.equal(assessment.requiredVramGb, 24);
    assert(
      assessment.blockers.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090"),
      `${assessment.profileId} must expose the concrete benchmark blocker`,
    );
  }
}

function onlyTheExactLtx25X2ProfileCanUseABenchmark(): void {
  const production = generationProfile("production");
  const hardwareOnly = assessNovitaVideoProfileRuntime(production, {
    gpuSku: "RTX 4090",
    vramGb: 24,
    benchmarkedVideoProfileRevisions: [],
  });
  assert.equal(hardwareOnly.ready, false);
  assert(hardwareOnly.blockers.some((blocker) => blocker.includes("revision_not_benchmarked")));

  const admitted = assessNovitaVideoProfileRuntime(production, {
    gpuSku: "RTX 4090",
    vramGb: 24,
    benchmarkedVideoProfileRevisions: [novitaVideoProfileIdentity(production)],
  });
  assert.equal(admitted.ready, true);

  const { id, video } = production;
  const noFp8 = assessNovitaVideoPhaseProfileRuntime({ ...video, id, quantization: undefined }, {
    gpuSku: "RTX 4090",
    vramGb: 24,
    benchmarkedVideoProfileRevisions: [novitaVideoProfileIdentity(production)],
  });
  assert.equal(noFp8.ready, false);
  assert(noFp8.blockers.includes("ltx_2_5_rtx_4090_contract_quantization_mismatch"));

  const wrongTarget = assessNovitaVideoPhaseProfileRuntime({ ...video, id, width: 1920 }, {
    gpuSku: "RTX 4090",
    vramGb: 24,
    benchmarkedVideoProfileRevisions: [novitaVideoProfileIdentity(production)],
  });
  assert.equal(wrongTarget.ready, false);
  assert(wrongTarget.blockers.includes("ltx_2_5_rtx_4090_contract_width_mismatch"));

  // Regression guard: even a fully otherwise-valid profile cannot bypass the
  // central LTX 2.5 admission registry by naming the retired LTX 2.3 model.
  const legacyLtx23Override = assessNovitaVideoPhaseProfileRuntime({
    ...video,
    id,
    model: "Lightricks/LTX-2.3",
  }, {
    gpuSku: "RTX 4090",
    vramGb: 24,
    benchmarkedVideoProfileRevisions: [novitaVideoProfileIdentity(production)],
  });
  assert.equal(legacyLtx23Override.ready, false);
  assert(legacyLtx23Override.blockers.includes("unrecognized_novita_video_model:Lightricks/LTX-2.3"));
}

function pipelineChecksOnlyRealVideoProducers(): void {
  // Motion QA can launch a bounded LTX repair, so it is a real video producer
  // for runtime admission rather than a harmless analysis-only consumer.
  assert.equal(isNovitaVideoRequiredBlock("qa_shots"), true);
  assert.equal(isNovitaVideoRequiredBlock("novita_render_video"), true);

  const noVideo = assessPipelineVideoRuntimeReadiness([
    "topic_select",
    "novita_render_images",
    "qa_assets",
  ]);
  assert.equal(noVideo.videoRequired, false);
  assert.equal(noVideo.ready, true);

  const video = assessPipelineVideoRuntimeReadiness([
    ...NOVITA_VIDEO_REQUIRED_BLOCKS,
    { block: "novita_render_video", params: { generationProfile: "hero" } },
  ]);
  assert.equal(video.videoRequired, true);
  assert.equal(video.ready, false);
  assert.deepEqual(
    video.blockAssessments.map((assessment) => assessment.blockId),
    [...NOVITA_VIDEO_REQUIRED_BLOCKS, "novita_render_video"],
  );
  assert.equal(video.blockAssessments.at(-1)?.profileId, "hero");
  assert.throws(
    () => assertPipelineVideoRuntimeReady([{ block: "novita_render_video", params: { generationProfile: "production" } }]),
    /pipeline video runtime is not admissible[\s\S]*novita_render_video:ltx_2_5_revision_not_benchmarked_on_rtx_4090/,
  );
  assert.throws(
    () => assertPipelineVideoRuntimeReady(["qa_shots"]),
    /pipeline video runtime is not admissible[\s\S]*qa_shots:ltx_2_5_revision_not_benchmarked_on_rtx_4090/,
  );
}

function unknownVideoProfilesFailClosed(): void {
  const readiness = assessPipelineVideoRuntimeReadiness([
    { block: "novita_render_video", params: { generationProfile: "unapproved" } },
  ]);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, ["novita_render_video:unknown_novita_generation_profile:unapproved"]);
}

configuredProfilesFailClosedOnTheLockedFleet();
onlyTheExactLtx25X2ProfileCanUseABenchmark();
pipelineChecksOnlyRealVideoProducers();
unknownVideoProfilesFailClosed();

assert.equal(NOVITA_LOCKED_VIDEO_RUNTIME.gpuSku, "RTX 4090");
console.log("runtime capability test passed");
