/** Held pure compiler entry. Existing audio metadata validation does no IO here.
 * Keep this server-side dependency out of browser-facing EpisodeGraph schemas. */
import { canonicalJson } from "@/lib/canonicalJson";
import { assertNarrationPerformanceEvidence } from "@/lib/narrationPerformance";
import type { CachedOutputValidationContext } from "./types";
import { assertWorkedExampleNarrationBinding } from "./workedExampleNarration";
import { assertWorkedExamplePreparation } from "./workedExample";
import { assertWorkedExampleAudioMetadata } from "./workedExampleAudioBinding";
import { StorySpineSchema, storySpineFingerprint, validateStorySpine } from "./storySpine";
import { createWorkedExampleVisualPlan, WorkedExampleVisualPlanSchema, workedExampleVisualSentences, type WorkedExampleVisualPlan } from "./workedExampleVisual";

export interface WorkedExampleVisualCompilerInput extends CachedOutputValidationContext {
  readonly storySpine: unknown;
  readonly aspectRatio: unknown;
}

const hasOwn = (value: unknown, key: string): boolean => value !== null && typeof value === "object" && Object.hasOwn(value, key);
/** For the future optional caller: ordinary data remains unmarked; ANY arithmetic marker
 * requires the entire current bundle, even if its value is null/undefined. */
export function hasWorkedExampleVisualMarkers(input: WorkedExampleVisualCompilerInput): boolean {
  return ["workedExampleRequest", "workedExamplePreparation", "workedExampleEditorialApproval", "workedExampleAudioBinding", "workedExampleVisualPlan"].some((key) => hasOwn(input.store, key) || hasOwn(input.outputs, key))
    || [input.store.script, input.outputs.script].some((script) => ["workedExamplePreparationFingerprint", "workedExampleNarrationVersion"].some((key) => hasOwn(script, key)));
}

export function compileWorkedExampleVisualPlan(input: WorkedExampleVisualCompilerInput): WorkedExampleVisualPlan {
  if (input.aspectRatio !== "16:9") throw new Error("arithmetic visual v1 supports landscape 16:9 only; portrait is unfinished");
  for (const key of ["workedExampleRequest", "workedExamplePreparation", "script", "narrationText", "scriptApproved", "workedExampleEditorialApproval"]) {
    if (!hasOwn(input.store, key) || input.store[key] === undefined) throw new Error(`arithmetic visual requires the full current bundle: ${key}`);
  }
  for (const key of ["workedExampleAudioBinding", "narrationKey", "narrationDurationSec", "narrationTranscriptText", "narrationPerformanceEvidence", "sentenceTimings", "chapterPlan"]) {
    if (!hasOwn(input.outputs, key) || input.outputs[key] === undefined) throw new Error(`arithmetic visual requires the full current audio bundle: ${key}`);
  }
  for (const key of ["syntheticScenario", "scenarioVisualTreatment", "evidenceVisualManifests", "editorialEvidencePacket"]) {
    if (hasOwn(input.store, key) || hasOwn(input.outputs, key)) throw new Error("arithmetic visual cannot mix factual or fictional scenario inputs");
  }
  if (input.params.chapterCards !== false || !Array.isArray(input.outputs.chapterPlan) || input.outputs.chapterPlan.length !== 0) throw new Error("arithmetic visual v1 requires explicit sentence mode; chapters are unsupported");
  const preparation = assertWorkedExamplePreparation(input.store.workedExamplePreparation, input.store.workedExampleRequest);
  const script = assertWorkedExampleNarrationBinding({ request: input.store.workedExampleRequest, preparation,
    script: input.store.script, narrationText: input.store.narrationText,
    ownerId: input.ownerId, channelId: input.channelId, runId: input.runId });
  if (!script) throw new Error("arithmetic visual requires a verified current script");
  const spoken = workedExampleVisualSentences(preparation);
  const audio = assertWorkedExampleAudioMetadata(input, spoken);
  assertNarrationPerformanceEvidence(input.outputs.narrationPerformanceEvidence);
  const spine = validateStorySpine(StorySpineSchema.parse(input.storySpine));
  if (spine.timedScript.narrationDurationSec !== input.outputs.narrationDurationSec) throw new Error("arithmetic visual Story Spine duration differs from bound narration");
  if (!Array.isArray(input.outputs.sentenceTimings) || input.outputs.sentenceTimings.length !== spoken.length) throw new Error("arithmetic visual requires exactly one bound timing entry per canonical sentence");
  const timings = input.outputs.sentenceTimings as Array<{ text: string; start: number; end: number }>;
  if (spine.timedScript.sentences.length !== spoken.length || spine.narrativeBeats.length !== spoken.length) throw new Error("arithmetic visual v1 requires one Story Spine beat per exact spoken sentence");
  const sentences = spine.timedScript.sentences.map((sentence, index) => {
    const timing = timings[index];
    if (sentence.text !== spoken[index] || timing.text !== spoken[index] || sentence.t0 !== timing.start || sentence.t1 !== timing.end) throw new Error("arithmetic visual Story Spine changed the bound ordered sentence text/timing");
    return { id: sentence.id, text: sentence.text, start: sentence.t0, end: sentence.t1 };
  });
  const beats = spine.narrativeBeats.map((beat, index) => {
    if (canonicalJson(beat.sourceSentenceIds) !== canonicalJson([sentences[index].id])) throw new Error("arithmetic visual Story Spine beat has missing, reordered or merged sentence references");
    return { id: beat.id, sentenceId: sentences[index].id, t0: beat.t0, t1: beat.t1 };
  });
  return createWorkedExampleVisualPlan({ preparation, durationSec: spine.timedScript.narrationDurationSec, sentences, beats,
    source: { scriptFingerprint: audio.scriptFingerprint, inputFingerprint: audio.inputFingerprint,
      timingFingerprint: audio.timingFingerprint, storySpineFingerprint: storySpineFingerprint(spine), artifact: audio.artifact } });
}

/** Required again at the future active consumer boundary. Metadata integrity is not proof
 * of local bytes or pronunciation; the existing audio-byte and final speech QA gates still apply. */
export function assertWorkedExampleVisualPlanCurrent(value: unknown, input: WorkedExampleVisualCompilerInput): WorkedExampleVisualPlan {
  const plan = WorkedExampleVisualPlanSchema.parse(value);
  if (canonicalJson(plan) !== canonicalJson(compileWorkedExampleVisualPlan(input))) throw new Error("arithmetic visual plan differs from the current complete source bundle");
  return plan;
}
