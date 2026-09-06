import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { generationProfile } from "./generationProfiles";
import {
  planCinematicShotLanguage,
  type CinematicCameraMove,
  type CinematicShotScale,
} from "./cinematicShotLanguage";
import {
  causalBeatWindows,
  coverageBoundaries,
  MIN_CINEMATIC_BEAT_SEC,
  pickCoverageCount,
} from "./shotBoundaryTiming";
import type { VisualReviewCreativeLock } from "@/lib/visualReview";

const EPSILON = 0.02;

export const TimedSentenceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  sectionId: z.string().min(1),
  evidenceRefs: z.array(z.string()),
}).refine((value) => value.t1 > value.t0, "sentence t1 must follow t0");

/**
 * Per-beat/shot MOOD TAG (music-mood threading). DATA ONLY — no
 * mood-to-music-section selection logic is built here; that is future work
 * for whatever consumes this field. A bounded enum (not free text) keeps it
 * safe for any automated consumer without needing to sanitize an open
 * string. Optional everywhere it appears, so every existing beat/shot
 * payload that predates this field keeps validating unchanged.
 *
 * Defined here — not in cinematicCaseSequence.ts — because Story Spine is
 * upstream and already the shared ShotPlan source cinematicCaseSequence.ts
 * imports from; cinematicCaseSequence.ts imports this same schema for its
 * own per-beat mood field rather than redeclaring the enum.
 */
export const BeatMoodSchema = z.enum(["tense", "somber", "triumphant", "mysterious", "neutral"]);
export type BeatMood = z.infer<typeof BeatMoodSchema>;

/**
 * Lightweight AUTOMATIC-PATH character-introduction concept (Phase 17). The
 * Casefile cinematic route has its own richer `CinematicNarrativeRoleSchema`
 * (7 values: cold_open/orientation/investigation/contradiction/reveal/
 * aftermath/closing_residue/introduction — see cinematicCaseSequence.ts) with
 * strict evidence-citation/cast-lock validation. Story Spine deliberately
 * does NOT reuse that schema or its validation: this is a narrow, single-value
 * enum (extensible later) for the one concept the automatic path needs —
 * "this beat introduces a character on-screen" — with the same lightweight,
 * additive-only doctrine as `BeatMoodSchema` above: optional everywhere,
 * unrecognized values dropped rather than thrown (see planStorySpine below).
 */
export const NarrativeRoleSchema = z.enum(["introduction"]);
export type NarrativeRole = z.infer<typeof NarrativeRoleSchema>;

export const NarrativeBeatSchema = z.object({
  id: z.string().min(1),
  sourceSentenceIds: z.array(z.string()).min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  purpose: z.string().min(1),
  /** Optional bounded mood tag; threaded down onto this beat's shots. */
  mood: BeatMoodSchema.optional(),
  /** Optional narrow narrative-role tag; see NarrativeRoleSchema above. */
  narrativeRole: NarrativeRoleSchema.optional(),
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
  /** Optional bounded mood tag inherited from the parent narrative beat. */
  mood: BeatMoodSchema.optional(),
  /** Optional narrative-role tag inherited from the parent beat (see
   *  NarrativeRoleSchema above). */
  narrativeRole: NarrativeRoleSchema.optional(),
  /**
   * Character-introduction NAME CARD text (automatic-path lightweight
   * counterpart to the Casefile route's `nameCardText` on
   * `CinematicCoverageShotSchema`, cinematicCaseSequence.ts). Rendered via
   * `applyNameCardOverlay`/`nameCardOverlayFilter` (src/lib/ffmpeg.ts).
   * Optional so every shot payload that predates this field keeps validating
   * unchanged. Lightly validated in `validateStorySpine` below (requires a
   * non-empty `entities` list on the same shot) — NOT the Casefile route's
   * strict citation/locked-cast checks; see the field's own comment there.
   */
  nameCardText: z.string().min(1).max(120).optional(),
  /**
   * REAL-IMAGE INSERT query (Phase 18). When present, the automatic-path
   * renderer substitutes a real Wikimedia Commons photograph for this
   * shot's LTX-generated clip instead of rendering it — see the
   * `realImageInsertQuery` handling inside `gen_footage`'s per-scene loop
   * (src/trigger/blocks/genFootageBlocks.ts), which resolves it via
   * `searchWikimediaImage` (src/lib/wikimedia.ts) and turns the result into
   * a short clip via `kenBurns` (src/lib/ffmpeg.ts). Lightweight and
   * additive-only, same doctrine as `nameCardText` above: optional
   * everywhere, so every shot payload that predates this field keeps
   * validating unchanged. UNLIKE `nameCardText`, this is schema-only —
   * intentionally NOT threaded through `PlanStorySpineInput`/
   * `planStorySpine` (no automatic-path caller sets this on a beat today)
   * and `validateStorySpine` has no companion check for it (unlike
   * `nameCardText`'s `entities` requirement): a real-image insert is not a
   * Casefile-style cited claim, so there is nothing to cross-validate. Any
   * future story-outline/entity-tagging step can set it directly on a
   * `shotList` entry — the same "standalone primitive, no live caller yet"
   * status `src/lib/hyperframesOverlay.ts` documents for itself.
   */
  realImageInsertQuery: z.string().min(1).max(200).optional(),
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
  /**
   * Carried for provenance, deliberately NOT planned from. Every shot's content
   * comes from the narrated sentence it covers, so steering the plan by the
   * topic as well would let a shot depict the video's subject instead of the
   * line being spoken at that second. Flagged by
   * scripts/audit-inert-inputs.ts and kept on purpose.
   */
  topic: string;
  narrationDurationSec: number;
  sentenceTimings: Array<{ text: string; start: number; end: number }>;
  structure?: {
    beats?: Array<{
      name?: string;
      note?: string;
      /**
       * The Director's pacing intent for this beat, in on-screen seconds.
       *
       * This is what decides WHERE each beat's purpose lands on the narration
       * clock (see assignStructureBeats). Until it was wired, structure beats
       * were mapped onto sentences by COUNT — every beat got the same share of
       * sentences however long the Director asked it to run — and
       * scripts/story-spine-pacing-harness.ts measured the result on real
       * briefDirector output: a mean 30.6% of the timeline carried the wrong
       * beat purpose, worst case 46.2%. The error was largest exactly where the
       * Director had the strongest opinion (a 15s hook next to a 65s body),
       * which is the opposite of what a pacing input should do.
       */
      intentSec?: number;
      mood?: string;
      /** See NarrativeRoleSchema; unrecognized values are dropped, not thrown. */
      narrativeRole?: string;
      /** See ShotPlanSchema.nameCardText; only honored on an "introduction"
       *  narrativeRole beat, and only on that beat's first cut shot. */
      nameCardText?: string;
    }>;
  };
  visualBrief?: Record<string, unknown>;
  styleDNA?: Record<string, unknown> | null;
  /** Immutable serial-episode projection; never sourced from live series state. */
  serializedEpisodeContinuity?: {
    episodeNumber: number;
    seriesTitle: string;
    arcSummary?: string;
    unresolvedThreads?: readonly string[];
    entities?: readonly { name: string; role: string }[];
  };
  generationProfile?: unknown;
  targetShotSec?: number;
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
  // Lightweight automatic-path validation for the character-introduction
  // name-card exception (ShotPlanSchema.nameCardText above): NOT the
  // Casefile route's strict evidence-citation/locked-cast checks
  // (evaluateCinematicCaseSequence in cinematicCaseSequence.ts) — this only
  // requires that a shot carrying on-screen name-card text also identifies
  // which entity it introduces, so the render pipeline has something
  // concrete to key the overlay off.
  for (const shot of spine.shotList) {
    if (shot.nameCardText && shot.entities.length === 0) {
      throw new Error(`shot ${shot.id} carries nameCardText but has no entities to introduce`);
    }
  }
  return spine;
}

/**
 * Immutable identity of a fully validated timed Story Spine.
 *
 * This intentionally covers the entire spine (timed script, continuity,
 * shots, DP specs, EDL, and coverage), rather than a renderer-specific
 * projection such as only the ShotPlan. It is provider-free and reusable by
 * any downstream receipt that needs to prove it consumed the same story.
 */
export function storySpineFingerprint(value: unknown): string {
  const spine = validateStorySpine(StorySpineSchema.parse(value));
  return sha256Hex(canonicalJson(spine));
}

function compactReviewText(value: string, maxLength: number): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Projects the exact, fingerprinted Story Spine shot plan onto the released
 * master's clock. These locks make the existing final visual reviewer judge a
 * sampled frame against the literal narrated moment, continuity state, and
 * authored shot purpose that should be visible at that time. They remain
 * sampled visual evidence; they do not claim continuous shot realization.
 */
export function storySpineVisualReviewLocks(input: {
  readonly storySpine: unknown;
  readonly expectedStorySpineFingerprint: unknown;
  readonly narrationStartSec: number;
  readonly finalMasterDurationSec: number;
}): readonly VisualReviewCreativeLock[] {
  const spine = validateStorySpine(StorySpineSchema.parse(input.storySpine));
  if (
    typeof input.expectedStorySpineFingerprint !== "string" ||
    input.expectedStorySpineFingerprint !== storySpineFingerprint(spine)
  ) {
    throw new Error("Story Spine visual-review fingerprint does not match the retained pre-render plan");
  }
  if (!Number.isFinite(input.narrationStartSec) || input.narrationStartSec < 0) {
    throw new Error("Story Spine visual review requires a valid final-master narration start");
  }
  if (!Number.isFinite(input.finalMasterDurationSec) || input.finalMasterDurationSec <= 0) {
    throw new Error("Story Spine visual review requires a valid final-master duration");
  }
  const plannedEndSec = input.narrationStartSec + spine.timedScript.narrationDurationSec;
  if (plannedEndSec > input.finalMasterDurationSec + 0.75) {
    throw new Error("Story Spine visual-review timing extends beyond the final master");
  }

  const dpByShotId = new Map(spine.dpVisualSpecs.map((spec) => [spec.shotId, spec]));
  return Object.freeze(spine.shotList.map((shot) => {
    const dp = dpByShotId.get(shot.id);
    if (!dp) throw new Error(`Story Spine visual review is missing DP evidence for ${shot.id}`);
    const startSec = Number((input.narrationStartSec + shot.t0).toFixed(3));
    const endSec = Number((input.narrationStartSec + shot.t1).toFixed(3));
    return {
      shotId: `story-spine-${shot.id}`,
      startSec,
      endSec,
      expected: compactReviewText(
        `Story Spine ${shot.id}: depict the literal narrated moment "${shot.literalContent}"; ` +
          `visual purpose: ${shot.coveragePurpose}; story function: ${shot.storyFunction}.`,
        700,
      ),
      acceptanceCriteria: [
        compactReviewText(
          "The visible subject, action, and setting support the exact current narrated idea rather than generic, decorative, or temporally misplaced imagery.",
          220,
        ),
        compactReviewText(
          `Continuity remains locked: ${shot.continuityState}; era ${shot.era}; ` +
            `wardrobe ${shot.wardrobe.join(", ") || "unchanged"}; props ${shot.props.join(", ") || "as authored"}.`,
          220,
        ),
        compactReviewText(
          `${dp.firstFrameConstraint}; ${dp.lastFrameConstraint}.`,
          220,
        ),
      ],
    } satisfies VisualReviewCreativeLock;
  }));
}

/**
 * Which structure beat owns each narrated sentence.
 *
 * The Director declares `intentSec` per beat — how long that beat should be on
 * screen. Honouring it means placing beat boundaries on the narration CLOCK,
 * not at evenly-spaced sentence counts, because sentences are not uniform and
 * because a Director who wants a 15-second hook in front of a 65-second body is
 * expressing exactly the thing a count-split destroys.
 *
 * Three properties this must keep, in order of importance:
 *
 *   monotonic   the returned index never decreases, so beat purposes cannot
 *               interleave and every narrative beat stays contiguous.
 *   surjective  when there are at least as many sentences as beats, every
 *               declared beat receives at least one — otherwise a beat carrying
 *               narrativeRole "introduction" and its nameCardText could be
 *               skipped entirely and the character introduction would silently
 *               vanish from the render.
 *   compatible  with no usable intentSec (all zero, absent, or non-finite) this
 *               returns the historical count-proportional mapping unchanged, so
 *               a Director that omits pacing is no worse off than before.
 */
function assignStructureBeats(
  intervals: ReadonlyArray<{ t0: number; t1: number }>,
  beats: ReadonlyArray<{ intentSec?: number }>,
  durationSec: number,
): number[] {
  const n = intervals.length;
  const m = beats.length;
  if (!m || !n) return new Array(n).fill(0);

  const usable = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const declared = beats.reduce((total, beat) => total + usable(beat.intentSec), 0);
  if (declared <= 0) {
    return intervals.map((_, index) => Math.min(m - 1, Math.floor((index * m) / n)));
  }

  // Cumulative intended end of each beat, scaled onto the real narration clock.
  // Scaling matters: a Director's seconds sum to roughly, not exactly, the
  // delivered narration length, and the spine must tile the real duration.
  const intendedEnd: number[] = [];
  let accumulated = 0;
  for (const beat of beats) {
    accumulated += usable(beat.intentSec);
    intendedEnd.push((accumulated / declared) * durationSec);
  }

  const assignment: number[] = [];
  let cursor = 0;
  for (let index = 0; index < n; index++) {
    // Advance past every beat this sentence already starts after, but never so
    // far that the sentences still to come cannot cover the beats still to
    // come — that guard is what makes the mapping surjective.
    while (
      cursor < m - 1 &&
      intervals[index]!.t0 >= intendedEnd[cursor]! - EPSILON &&
      n - index > m - 1 - cursor
    ) {
      cursor++;
    }
    // The mirror of that guard: once only as many sentences remain as beats,
    // each remaining sentence must take the next beat or the tail goes unused.
    cursor = Math.min(m - 1, Math.max(cursor, m - n + index));
    assignment.push(cursor);
  }
  return assignment;
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
  const structureBeatIndexBySentence = assignStructureBeats(intervals, structureBeats, duration);
  // Factored out of the duplicated modulo-index expression below so the new
  // mood lookup does not triple it a third time.
  const structureBeatForIndex = (index: number) =>
    structureBeats.length ? structureBeats[structureBeatIndexBySentence[index]!] : undefined;
  // Beat id -> reviewed name-card text, populated below alongside
  // narrativeBeats. Kept OUT of NarrativeBeatSchema (name-card text is a
  // shot-level concept, applied to only the beat's first cut shot below) but
  // needs to survive from this map into the shot-construction loop further
  // down, which only has the built beat object (not the raw structureBeat)
  // in scope.
  const introNameCardByBeatId = new Map<string, string>();
  const narrativeBeats = intervals.map((sentence, index) => {
    const structureBeat = structureBeatForIndex(index);
    // Unrecognized mood/narrativeRole values are dropped, not thrown: this is
    // optional, non-critical metadata and must never fail an otherwise-valid
    // spine.
    const moodParsed = structureBeat?.mood ? BeatMoodSchema.safeParse(structureBeat.mood) : undefined;
    const narrativeRoleParsed = structureBeat?.narrativeRole
      ? NarrativeRoleSchema.safeParse(structureBeat.narrativeRole)
      : undefined;
    const beatId = `beat-${String(index + 1).padStart(4, "0")}`;
    // Same drop-not-throw doctrine for an oversized/empty name-card string.
    const nameCardParsed = structureBeat?.nameCardText?.trim()
      ? z.string().min(1).max(120).safeParse(structureBeat.nameCardText.trim())
      : undefined;
    if (nameCardParsed?.success) introNameCardByBeatId.set(beatId, nameCardParsed.data);
    return {
      id: beatId,
      sourceSentenceIds: [sentence.id],
      t0: sentence.t0,
      t1: sentence.t1,
      purpose: structureBeat?.note || structureBeat?.name || "advance the narrated argument",
      mood: moodParsed?.success ? moodParsed.data : undefined,
      narrativeRole: narrativeRoleParsed?.success ? narrativeRoleParsed.data : undefined,
      evidenceRefs: sentence.evidenceRefs,
    };
  });

  const dna = input.styleDNA ?? {};
  const recurringSubject = typeof dna.recurringSubject === "string" ? dna.recurringSubject : "";
  const setting = typeof dna.setting === "string" ? dna.setting : "";
  const palette = strings(dna.palette);
  const serializedEpisodeContinuity = input.serializedEpisodeContinuity;
  const serialEntities = (serializedEpisodeContinuity?.entities ?? [])
    .map((entity, index) => {
      const name = typeof entity.name === "string" ? entity.name.trim().slice(0, 120) : "";
      if (!name) return undefined;
      const role = typeof entity.role === "string" ? entity.role.trim().slice(0, 280) : "";
      return {
        id: `serial-entity-${String(index + 1).padStart(2, "0")}`,
        name,
        // Episode context carries a narrative role, not a physical description.
        // Make that boundary explicit for any downstream visual consumer.
        look: role
          ? `Narrative continuity role only: ${role}. Do not infer physical appearance from this role.`
          : "Narrative continuity entity; do not invent or change physical appearance.",
      };
    })
    .filter((entity): entity is { id: string; name: string; look: string } => Boolean(entity));
  const serialArcSummary = typeof serializedEpisodeContinuity?.arcSummary === "string"
    ? serializedEpisodeContinuity.arcSummary.replace(/\s+/g, " ").trim().slice(0, 420)
    : "";
  const serialOpenThreads = (serializedEpisodeContinuity?.unresolvedThreads ?? [])
    .map((thread) => typeof thread === "string" ? thread.replace(/\s+/g, " ").trim().slice(0, 160) : "")
    .filter(Boolean)
    .slice(0, 2);
  const serializedContinuityConstraint = serializedEpisodeContinuity
    ? [
        `Serialized episode ${serializedEpisodeContinuity.episodeNumber} of ${serializedEpisodeContinuity.seriesTitle}: preserve named narrative continuity and do not contradict the immutable episode receipt.`,
        serialArcSummary ? `Sealed arc context: ${serialArcSummary}` : "",
        serialOpenThreads.length
          ? `Do not visually imply these sealed open threads are already resolved unless the narration explicitly resolves them: ${serialOpenThreads.join("; ")}`
          : "",
      ].filter(Boolean).join(" ")
    : "";
  const negativeConstraints = [
    ...strings(dna.visualAvoid),
    ...(serializedContinuityConstraint ? [serializedContinuityConstraint] : []),
  ];
  const visual = input.visualBrief ?? {};
  const cameraGrammar = strings((visual as { directives?: { cameraMoves?: unknown } }).directives?.cameraMoves);
  const continuityLedger = {
    version: "1.0.0" as const,
    entities: [
      ...(recurringSubject ? [{ id: "entity-primary", name: recurringSubject, look: recurringSubject }] : []),
      ...serialEntities,
    ],
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

  /**
   * Not every rendered shot needs to be the same length. A beat with
   * enough contiguous narration (>= MIN_CINEMATIC_BEAT_SEC) earns the
   * same weighted, purpose-appropriate coverage split the Casefile
   * cinematic draft uses instead of a blind equal division: this saves
   * render time by putting duration where a cut earns it, while every
   * shot still respects the locked LTX minimum. A beat too short to
   * safely support that split (most single narrated sentences) keeps
   * the original bounded equal division unchanged.
   */
  function boundariesForBeat(beat: { t0: number; t1: number }): number[][] {
    const beatDuration = beat.t1 - beat.t0;
    if (beatDuration < MIN_CINEMATIC_BEAT_SEC) {
      const chunks = Math.max(1, Math.ceil(beatDuration / targetShotSec));
      const boundaries = [beat.t0];
      for (let chunk = 1; chunk < chunks; chunk++) {
        boundaries.push(beat.t0 + (beatDuration * chunk) / chunks);
      }
      boundaries.push(beat.t1);
      return [boundaries];
    }
    // Seed causalBeatWindows with the same bounded-length candidate
    // pieces the equal split would have used, then let it regroup them
    // into >= MIN_CINEMATIC_BEAT_SEC windows (merging a short tail into
    // its predecessor). Each window then gets a weighted, non-uniform
    // coverageBoundaries split instead of an equal one. Safe to call
    // unconditionally here: causalBeatWindows only throws when total
    // input duration is below MIN_CINEMATIC_BEAT_SEC, already excluded.
    const candidateChunks = Math.max(1, Math.ceil(beatDuration / targetShotSec));
    const candidates: { t0: number; t1: number }[] = [];
    for (let chunk = 0; chunk < candidateChunks; chunk++) {
      const t0 = beat.t0 + (beatDuration * chunk) / candidateChunks;
      const t1 = chunk === candidateChunks - 1
        ? beat.t1
        : beat.t0 + (beatDuration * (chunk + 1)) / candidateChunks;
      candidates.push({ t0, t1 });
    }
    return causalBeatWindows(candidates).map((window) => {
      const windowT0 = window[0]!.t0;
      const windowT1 = window.at(-1)!.t1;
      const coverageCount = pickCoverageCount(windowT1 - windowT0);
      return coverageBoundaries(windowT0, windowT1, coverageCount);
    });
  }

  for (const beat of narrativeBeats) {
    const source = intervals.find((sentence) => sentence.id === beat.sourceSentenceIds[0]);
    if (!source) throw new Error(`missing source for ${beat.id}`);
    const groupedBoundaries = boundariesForBeat(beat);
    const totalChunks = groupedBoundaries.reduce((total, boundaries) => total + (boundaries.length - 1), 0);
    let chunk = 0;
    for (const boundaries of groupedBoundaries) {
      for (let slot = 0; slot < boundaries.length - 1; slot++) {
        shotNo++;
        const t0 = boundaries[slot]!;
        const t1 = boundaries[slot + 1]!;
        const id = `shot-${String(shotNo).padStart(4, "0")}`;
        const shotLanguage = planCinematicShotLanguage({
          literalContent: source.text,
          beatPurpose: beat.purpose,
          shotIndex: shotNo,
          chunkIndex: chunk,
          chunksInBeat: totalChunks,
          previous: shotList.length
            ? {
                cameraMove: shotList[shotList.length - 1]!.cameraMove as CinematicCameraMove,
                shotScale: shotList[shotList.length - 1]!.shotScale as CinematicShotScale,
              }
            : undefined,
        });
        const { cameraMove, shotScale, lens } = shotLanguage;
        const styleLock = [recurringSubject, setting, String(dna.colorGrade ?? ""), palette.join(", ")]
          .filter(Boolean)
          .join(". ");
        const literalContent = source.text;
        const prompt = [
          `Literal story moment: ${literalContent}`,
          styleLock ? `Locked channel world: ${styleLock}` : "",
          `Visual purpose: ${shotLanguage.coveragePurpose}`,
          `Cut rationale: ${shotLanguage.cutRationale}`,
          `Shot scale: ${shotScale}; lens: ${lens}; camera: ${cameraMove.replaceAll("_", " ")}`,
          "No text, letters, captions, logos, or watermarks in the image.",
        ].filter(Boolean).join(". ");
        const motion =
          `Continue the literal action implied by: ${literalContent}. ${shotLanguage.motionDirection} ` +
          `Camera performs a restrained ${cameraMove.replaceAll("_", " ")}; preserve identity, setting, wardrobe, props, and lighting through the final frame.`;
        // A continuity state describes a *continuous dramatic unit*, not an
        // individual shot. Shots within one narrated beat may therefore share
        // an endpoint-conditioned LTX handoff; a new beat remains a deliberate
        // editorial cut even when it happens in the same world.
        const continuityState = `entity-primary/location-primary/${beat.id}; no unmotivated identity, era, wardrobe, prop, palette, or lighting change`;
        const highRisk = shotNo === 1 || /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(literalContent);
        const candidateCount = Math.max(profile.image.candidates, highRisk ? 2 : 1);
        shotList.push({
          id,
          beatId: beat.id,
          sourceSentenceIds: beat.sourceSentenceIds,
          t0,
          t1,
          coveragePurpose: shotLanguage.coveragePurpose,
          literalContent,
          entities: recurringSubject ? ["entity-primary"] : [],
          locationId: setting ? "location-primary" : undefined,
          era: continuityLedger.era,
          wardrobe: continuityLedger.wardrobe,
          props: continuityLedger.props,
          continuityState,
          cameraMove,
          shotScale,
          lens,
          lighting: typeof dna.lighting === "string" ? dna.lighting : "consistent motivated natural lighting",
          motion,
          negative: negativeConstraints.join(", "),
          generationProfile: profile.id,
          candidateCount,
          imageMinScore: profile.qa.imageMinScore,
          shotMinScore: profile.qa.shotMinScore,
          prompt,
          seconds: t1 - t0,
          storyFunction: `${beat.purpose}; ${shotLanguage.intent}; ${shotLanguage.cutRationale}`,
          // Threaded straight from the parent beat — no mood-to-music-section
          // selection logic here yet; this only makes the data available on
          // the shot object for a future consumer.
          mood: beat.mood,
          narrativeRole: beat.narrativeRole,
          // The name card is placed on the beat's FIRST cut shot only (chunk
          // === 0) — a multi-shot introduction beat should not repeat the
          // same on-screen text on every one of its shots.
          nameCardText:
            chunk === 0 && beat.narrativeRole === "introduction"
              ? introNameCardByBeatId.get(beat.id)
              : undefined,
          section: source.sectionId,
          seed: 100_000 + shotNo,
        });
        dpVisualSpecs.push({
          shotId: id,
          keyframePrompt: prompt,
          motionPrompt: motion,
          negativePrompt: negativeConstraints.join(", "),
          styleLock,
          firstFrameConstraint: `depict the exact story state at ${t0.toFixed(2)}s`,
          lastFrameConstraint: `end in the same identity/setting state at ${t1.toFixed(2)}s with only motivated action advanced`,
          continuityState,
        });
        chunk++;
      }
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
