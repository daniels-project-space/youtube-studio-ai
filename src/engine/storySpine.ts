import { z } from "zod";
import { generationProfile } from "./generationProfiles";
import {
  compositionNegative,
  compositionPromptParts,
  shotCompositionProfile,
} from "@/lib/shotComposition";

const EPSILON = 0.02;

export const TimedSentenceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  sectionId: z.string().min(1),
  evidenceRefs: z.array(z.string()),
}).refine((value) => value.t1 > value.t0, "sentence t1 must follow t0");

export const NarrativeBeatSchema = z.object({
  id: z.string().min(1),
  sourceSentenceIds: z.array(z.string()).min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  purpose: z.string().min(1),
  evidenceRefs: z.array(z.string()),
}).refine((value) => value.t1 > value.t0, "beat t1 must follow t0");

export const ContinuityLedgerSchema = z.object({
  version: z.literal("1.0.0"),
  entities: z.array(z.object({ id: z.string(), name: z.string(), look: z.string() })),
  locations: z.array(z.object({ id: z.string(), name: z.string(), look: z.string() })),
  era: z.string(),
  wardrobe: z.array(z.string()),
  props: z.array(z.string()),
  palette: z.array(z.string()),
  cameraGrammar: z.array(z.string()),
  negativeConstraints: z.array(z.string()),
});

export const ShotPlanSchema = z.object({
  id: z.string().regex(/^shot-[a-z0-9-]+$/),
  beatId: z.string().min(1),
  sourceSentenceIds: z.array(z.string()).min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  coveragePurpose: z.string().min(1),
  literalContent: z.string().min(1),
  entities: z.array(z.string()),
  locationId: z.string().optional(),
  era: z.string(),
  wardrobe: z.array(z.string()),
  props: z.array(z.string()),
  continuityState: z.string().min(1),
  cameraMove: z.enum([
    "static", "dolly_push", "dolly_pull", "crane_up", "crane_down",
    "orbit_left", "orbit_right", "truck_left", "truck_right", "handheld_drift",
  ]),
  shotScale: z.enum(["wide", "medium", "close", "extreme_close", "establishing"]),
  lens: z.string().min(1),
  lighting: z.string().min(1),
  motion: z.string().min(1),
  negative: z.string(),
  generationProfile: z.enum(["draft", "production", "hero"]),
  candidateCount: z.number().int().min(1).max(4),
  imageMinScore: z.number().min(0).max(1),
  shotMinScore: z.number().min(0).max(1),
  prompt: z.string().min(1),
  seconds: z.number().positive(),
  storyFunction: z.string().min(1),
  section: z.string().min(1),
  seed: z.number().int().nonnegative(),
}).refine((value) => value.t1 > value.t0, "shot t1 must follow t0");

export const DPVisualSpecSchema = z.object({
  shotId: z.string().min(1),
  keyframePrompt: z.string().min(1),
  motionPrompt: z.string().min(1),
  negativePrompt: z.string(),
  styleLock: z.string(),
  firstFrameConstraint: z.string(),
  lastFrameConstraint: z.string(),
  continuityState: z.string(),
});

export const StorySpineSchema = z.object({
  version: z.literal("1.0.0"),
  timedScript: z.object({
    version: z.literal("1.0.0"),
    narrationDurationSec: z.number().finite().positive(),
    sentences: z.array(TimedSentenceSchema).min(1),
  }),
  narrativeBeats: z.array(NarrativeBeatSchema).min(1),
  continuityLedger: ContinuityLedgerSchema,
  shotList: z.array(ShotPlanSchema).min(1),
  dpVisualSpecs: z.array(DPVisualSpecSchema).min(1),
  editorEdl: z.object({
    version: z.literal("1.0.0"),
    durationSec: z.number().finite().positive(),
    shots: z.array(z.object({
      shotId: z.string(),
      sourceSentenceIds: z.array(z.string()).min(1),
      t0: z.number().nonnegative(),
      t1: z.number().positive(),
    })).min(1),
  }),
  coverage: z.object({
    mappedSec: z.number().nonnegative(),
    totalSec: z.number().positive(),
    ratio: z.number().min(0).max(1),
    gaps: z.array(z.object({ t0: z.number(), t1: z.number() })),
  }),
});

export type StorySpine = z.infer<typeof StorySpineSchema>;
export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export interface PlanStorySpineInput {
  topic: string;
  narrationDurationSec: number;
  sentenceTimings: Array<{ text: string; start: number; end: number }>;
  structure?: { beats?: Array<{ name?: string; note?: string; intentSec?: number }> };
  visualBrief?: Record<string, unknown>;
  styleDNA?: Record<string, unknown> | null;
  generationProfile?: unknown;
  targetShotSec?: number;
  /**
   * WHICH CAMERA GRAMMAR to plan in — see src/lib/shotComposition.ts.
   *
   * Omitted (or unrecognised) resolves to `cinematic_third_person`, whose move
   * vocabulary, scale vocabulary, lens rule and prompt layout are byte-for-byte
   * what this planner hardcoded before the profile existed. The POV variant
   * swaps the vocabulary for one a person physically holding the camera can
   * perform; it does NOT change the renderer, the provider or the timing maths.
   */
  shotComposition?: unknown;
  /**
   * The channel's locked recurring character, pre-composed into a prompt block
   * by src/lib/channelCharacter.ts `characterPromptBlock()`.
   *
   * Passed in ALREADY RENDERED rather than as an identity object on purpose:
   * the planner must not be able to re-author a character, only to splice the
   * one frozen line it was handed. "" for every channel without a character,
   * which is every pre-existing one.
   */
  characterPromptBlock?: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function assertContinuous(
  values: Array<{ id: string; t0: number; t1: number }>,
  durationSec: number,
  label: string,
): void {
  let cursor = 0;
  for (const value of values) {
    if (Math.abs(value.t0 - cursor) > EPSILON) {
      throw new Error(`${label} coverage gap/overlap before ${value.id}: expected ${cursor}, got ${value.t0}`);
    }
    cursor = value.t1;
  }
  if (Math.abs(cursor - durationSec) > EPSILON) {
    throw new Error(`${label} coverage ends at ${cursor}, expected ${durationSec}`);
  }
}

export function validateStorySpine(value: StorySpine): StorySpine {
  const spine = StorySpineSchema.parse(value);
  const sentenceIds = new Set(spine.timedScript.sentences.map((sentence) => sentence.id));
  const beatIds = new Set(spine.narrativeBeats.map((beat) => beat.id));
  assertContinuous(spine.narrativeBeats, spine.timedScript.narrationDurationSec, "beat");
  assertContinuous(spine.shotList, spine.timedScript.narrationDurationSec, "shot");
  for (const beat of spine.narrativeBeats) {
    if (beat.sourceSentenceIds.some((id) => !sentenceIds.has(id))) {
      throw new Error(`beat ${beat.id} references an unknown sentence`);
    }
  }
  for (const shot of spine.shotList) {
    if (!beatIds.has(shot.beatId) || shot.sourceSentenceIds.some((id) => !sentenceIds.has(id))) {
      throw new Error(`shot ${shot.id} has invalid story references`);
    }
  }
  const specIds = new Set(spine.dpVisualSpecs.map((spec) => spec.shotId));
  const edlIds = new Set(spine.editorEdl.shots.map((shot) => shot.shotId));
  if (spine.shotList.some((shot) => !specIds.has(shot.id) || !edlIds.has(shot.id))) {
    throw new Error("every shot requires one DP spec and one EDL entry");
  }
  if (spine.coverage.gaps.length || spine.coverage.ratio < 0.999999) {
    throw new Error(`story coverage is not complete (${spine.coverage.ratio})`);
  }
  return spine;
}

export function planStorySpine(input: PlanStorySpineInput): StorySpine {
  const duration = input.narrationDurationSec;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 36000) {
    throw new Error(`story spine requires a finite narration duration in (0, 36000], got ${duration}`);
  }
  const sorted = [...input.sentenceTimings]
    .filter((sentence) => sentence.text.trim() && Number.isFinite(sentence.start) && Number.isFinite(sentence.end))
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) throw new Error("story spine requires sentence timings");
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].start < 0 || sorted[i].end <= sorted[i].start || sorted[i].end > duration + 0.5) {
      throw new Error(`invalid sentence timing at index ${i}`);
    }
    if (i > 0 && sorted[i].start < sorted[i - 1].end - EPSILON) {
      throw new Error(`overlapping sentence timings at index ${i}`);
    }
  }

  const sentences = sorted.map((sentence, index) => ({
    id: `sentence-${String(index + 1).padStart(4, "0")}`,
    text: sentence.text.trim(),
    t0: sentence.start,
    t1: Math.min(duration, sentence.end),
    sectionId: `section-${String(index + 1).padStart(3, "0")}`,
    evidenceRefs: [`script:sentence:${index + 1}`],
  }));

  const intervals = sentences.map((sentence, index) => ({
    ...sentence,
    t0: index === 0 ? 0 : sentences[index - 1].t1,
    t1: index === sentences.length - 1 ? duration : sentence.t1,
  }));
  const structureBeats = input.structure?.beats ?? [];
  const narrativeBeats = intervals.map((sentence, index) => ({
    id: `beat-${String(index + 1).padStart(4, "0")}`,
    sourceSentenceIds: [sentence.id],
    t0: sentence.t0,
    t1: sentence.t1,
    purpose:
      structureBeats[Math.min(structureBeats.length - 1, Math.floor(index * structureBeats.length / intervals.length))]?.note ||
      structureBeats[Math.min(structureBeats.length - 1, Math.floor(index * structureBeats.length / intervals.length))]?.name ||
      "advance the narrated argument",
    evidenceRefs: sentence.evidenceRefs,
  }));

  const dna = input.styleDNA ?? {};
  const recurringSubject = typeof dna.recurringSubject === "string" ? dna.recurringSubject : "";
  const setting = typeof dna.setting === "string" ? dna.setting : "";
  const palette = strings(dna.palette);
  const negativeConstraints = strings(dna.visualAvoid);
  const visual = input.visualBrief ?? {};
  const cameraGrammar = strings((visual as { directives?: { cameraMoves?: unknown } }).directives?.cameraMoves);
  const continuityLedger = {
    version: "1.0.0" as const,
    entities: recurringSubject ? [{ id: "entity-primary", name: recurringSubject, look: recurringSubject }] : [],
    locations: setting ? [{ id: "location-primary", name: setting, look: setting }] : [],
    era: typeof dna.era === "string" ? dna.era : "unspecified; obey source sentence",
    wardrobe: strings(dna.wardrobe),
    props: strings(dna.props),
    palette,
    cameraGrammar,
    negativeConstraints,
  };

  const profile = generationProfile(input.generationProfile);
  const targetShotSec = Math.max(3, Math.min(10, Number(input.targetShotSec ?? 6)));
  const shotList: StorySpine["shotList"] = [];
  const dpVisualSpecs: StorySpine["dpVisualSpecs"] = [];
  let shotNo = 0;
  // Camera grammar comes from the composition profile, not from this file.
  // `cinematic_third_person` supplies exactly the two arrays that used to be
  // literals here, in the same order — the planner indexes them by
  // `shotNo % length`, so a reorder would silently re-cut existing channels.
  const composition = shotCompositionProfile(input.shotComposition);
  const moves = composition.cameraMoves;
  const scales = composition.shotScales;
  // Same reason as the framing clause: the planner joins with ". ", so a block
  // that ends in its own full stop would produce ".. ".
  const identityBlock = (input.characterPromptBlock ?? "").trim().replace(/\.\s*$/, "");
  const compositionNegatives = compositionNegative(composition, negativeConstraints);
  for (const beat of narrativeBeats) {
    const source = intervals.find((sentence) => sentence.id === beat.sourceSentenceIds[0]);
    if (!source) throw new Error(`missing source for ${beat.id}`);
    const chunks = Math.max(1, Math.ceil((beat.t1 - beat.t0) / targetShotSec));
    for (let chunk = 0; chunk < chunks; chunk++) {
      shotNo++;
      const t0 = beat.t0 + ((beat.t1 - beat.t0) * chunk) / chunks;
      const t1 = chunk === chunks - 1
        ? beat.t1
        : beat.t0 + ((beat.t1 - beat.t0) * (chunk + 1)) / chunks;
      const id = `shot-${String(shotNo).padStart(4, "0")}`;
      const cameraMove = moves[(shotNo - 1) % moves.length];
      const shotScale = scales[(shotNo - 1) % scales.length];
      const styleLock = [recurringSubject, setting, String(dna.colorGrade ?? ""), palette.join(", ")]
        .filter(Boolean)
        .join(". ");
      const literalContent = source.text;
      const framing = compositionPromptParts(composition, shotScale);
      const prompt = [
        // Identity first, then framing, then content: both are constants for
        // the channel and a constant that moves position between renders is a
        // different prompt. Both are "" for every pre-existing family, which is
        // why this join reproduces the previous string exactly.
        identityBlock,
        framing.framing,
        `Literal story moment: ${literalContent}`,
        styleLock ? `Locked channel world: ${styleLock}` : "",
        framing.lens,
        "No text, letters, captions, logos, or watermarks in the image.",
      ].filter(Boolean).join(". ");
      const motion =
        `Continue the literal action implied by: ${literalContent}. ` +
        `Camera performs a restrained ${cameraMove.replaceAll("_", " ")}; preserve identity, setting, wardrobe, props, and lighting through the final frame.` +
        (composition.motionClause ? ` ${composition.motionClause}` : "");
      const continuityState = `entity-primary/location-primary/shot-${shotNo}; no unmotivated identity, era, wardrobe, prop, palette, or lighting change`;
      const highRisk = shotNo === 1 || /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(literalContent);
      const candidateCount = Math.max(profile.image.candidates, highRisk ? 2 : 1);
      shotList.push({
        id,
        beatId: beat.id,
        sourceSentenceIds: beat.sourceSentenceIds,
        t0,
        t1,
        coveragePurpose: beat.purpose,
        literalContent,
        entities: recurringSubject ? ["entity-primary"] : [],
        locationId: setting ? "location-primary" : undefined,
        era: continuityLedger.era,
        wardrobe: continuityLedger.wardrobe,
        props: continuityLedger.props,
        continuityState,
        cameraMove,
        shotScale,
        lens: composition.planLensFor(shotScale),
        lighting: typeof dna.lighting === "string" ? dna.lighting : "consistent motivated natural lighting",
        motion,
        negative: compositionNegatives,
        generationProfile: profile.id,
        candidateCount,
        imageMinScore: profile.qa.imageMinScore,
        shotMinScore: profile.qa.shotMinScore,
        prompt,
        seconds: t1 - t0,
        storyFunction: beat.purpose,
        section: source.sectionId,
        seed: 100_000 + shotNo,
      });
      dpVisualSpecs.push({
        shotId: id,
        keyframePrompt: prompt,
        motionPrompt: motion,
        negativePrompt: compositionNegatives,
        styleLock,
        firstFrameConstraint: `depict the exact story state at ${t0.toFixed(2)}s`,
        lastFrameConstraint: `end in the same identity/setting state at ${t1.toFixed(2)}s with only motivated action advanced`,
        continuityState,
      });
    }
  }

  const spine: StorySpine = {
    version: "1.0.0",
    timedScript: { version: "1.0.0", narrationDurationSec: duration, sentences },
    narrativeBeats,
    continuityLedger,
    shotList,
    dpVisualSpecs,
    editorEdl: {
      version: "1.0.0",
      durationSec: duration,
      shots: shotList.map((shot) => ({
        shotId: shot.id,
        sourceSentenceIds: shot.sourceSentenceIds,
        t0: shot.t0,
        t1: shot.t1,
      })),
    },
    coverage: {
      mappedSec: duration,
      totalSec: duration,
      ratio: 1,
      gaps: [],
    },
  };
  return validateStorySpine(spine);
}
