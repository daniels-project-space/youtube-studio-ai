/**
 * Provider-neutral narrative series intelligence.
 *
 * This file plans durable creative intent only. It never generates an image,
 * trains a LoRA, reserves money, calls a model provider, or publishes a Short.
 * Those effects must be performed by a separately admitted adapter which proves
 * the receipts represented by these contracts.
 *
 * The contract deliberately sits beside, rather than inside, Episode Graph,
 * Story Spine, and the immutable serialized-program episode receipt:
 *
 *   channel program brief → season horizon → frozen episode receipt
 *   → Episode Graph / Story Spine → shot-control handoff / Short candidates
 *
 * It is style-aware (including claymotion, brick-built, anime, and drawn
 * animation) but renderer-agnostic. A style profile is a continuity brief, not
 * evidence that any particular renderer can satisfy it.
 */
import { z } from "zod";

import {
  ChannelProgramBriefSchema,
  type ChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import {
  EpisodeGraphSchema,
  episodeGraphFingerprint,
  type EpisodeGraph,
} from "@/engine/episodeGraph";
import {
  StorySpineSchema,
  storySpineFingerprint,
  type StorySpine,
} from "@/engine/storySpine";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  SerializedProgramEpisodeContextSchema,
  type SerializedProgramEpisodeContext,
} from "@/lib/serializedProgramEpisodeContext";
import { sha256Hex } from "@/lib/sha256";

export const NARRATIVE_SERIES_INTELLIGENCE_VERSION = "narrative-series-intelligence/v1" as const;
export const NARRATIVE_SHOT_CONTROL_VERSION = "narrative-shot-control/v1" as const;
export const CHARACTER_SHEET_DATASET_VERSION = "character-sheet-dataset/v1" as const;
export const CHARACTER_LORA_REGISTRY_VERSION = "character-lora-registry/v1" as const;
export const SHORTS_EXPANSION_PLAN_VERSION = "shorts-expansion-plan/v1" as const;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/iu);
const OwnedIdSchema = z.string().trim().min(1).max(320);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const positiveInteger = z.number().int().positive();
const currencyCents = z.number().int().nonnegative();

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sameText(left: string, right: string): boolean {
  return normalizedText(left).toLocaleLowerCase("en") === normalizedText(right).toLocaleLowerCase("en");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

/**
 * `brick_animation` intentionally describes the medium rather than borrowing
 * a brand identity. The same contract can serve any approved brick-built cast.
 */
export const NarrativeVisualStyleSchema = z.enum([
  "cinematic",
  "claymotion",
  "brick_animation",
  "anime",
  "drawn",
  "comic",
  "documentary",
  "other",
]);
export type NarrativeVisualStyle = z.infer<typeof NarrativeVisualStyleSchema>;

export interface NarrativeVisualStyleProfile {
  readonly style: NarrativeVisualStyle;
  readonly displayName: string;
  readonly characterSheetFocus: readonly string[];
  readonly continuityFocus: readonly string[];
  readonly storyboardFocus: readonly string[];
  readonly cameraAndMotionFocus: readonly string[];
}

const NARRATIVE_VISUAL_STYLE_PROFILES: Record<NarrativeVisualStyle, NarrativeVisualStyleProfile> = {
  cinematic: {
    style: "cinematic",
    displayName: "Cinematic",
    characterSheetFocus: ["silhouette", "wardrobe", "facial features", "age cues"],
    continuityFocus: ["cast identity", "location geometry", "wardrobe", "props", "lighting"],
    storyboardFocus: ["dramatic objective", "screen direction", "first and last frame state"],
    cameraAndMotionFocus: ["lens", "framing", "motivated camera motion", "cut continuity"],
  },
  claymotion: {
    style: "claymotion",
    displayName: "Claymotion",
    characterSheetFocus: ["sculpted proportions", "surface texture", "armature silhouette", "wardrobe material"],
    continuityFocus: ["material texture", "handmade scale", "limb proportions", "set dressing"],
    storyboardFocus: ["pose-to-pose action", "contact shadows", "object deformation limits"],
    cameraAndMotionFocus: ["deliberate stop-motion cadence", "stable set scale", "restrained camera moves"],
  },
  brick_animation: {
    style: "brick_animation",
    displayName: "Brick-built animation",
    characterSheetFocus: ["generic brick-built proportions", "head and torso markings", "accessories", "scale"],
    continuityFocus: ["stud geometry", "part colors", "character accessories", "set scale"],
    storyboardFocus: ["clear action poses", "build integrity", "set transitions"],
    cameraAndMotionFocus: ["readable wide geography", "stable scale", "simple motivated moves"],
  },
  anime: {
    style: "anime",
    displayName: "Anime",
    characterSheetFocus: ["line language", "hair shape", "eye design", "palette", "wardrobe"],
    continuityFocus: ["facial proportions", "line weight", "cel shading", "color model"],
    storyboardFocus: ["key poses", "expression beats", "screen direction", "timing holds"],
    cameraAndMotionFocus: ["keyframe silhouettes", "controlled motion arcs", "consistent perspective"],
  },
  drawn: {
    style: "drawn",
    displayName: "Drawn animation",
    characterSheetFocus: ["line weight", "shape language", "palette", "wardrobe marks"],
    continuityFocus: ["line consistency", "proportions", "palette", "background treatment"],
    storyboardFocus: ["readable staging", "pose arcs", "expression", "transition motifs"],
    cameraAndMotionFocus: ["motion arcs", "perspective continuity", "intentional holds"],
  },
  comic: {
    style: "comic",
    displayName: "Comic motion",
    characterSheetFocus: ["silhouette", "ink language", "costume marks", "palette"],
    continuityFocus: ["panel language", "ink treatment", "character scale", "recurring motifs"],
    storyboardFocus: ["panel-to-panel causality", "read order", "visual emphasis"],
    cameraAndMotionFocus: ["panel framing", "limited depth moves", "graphic transitions"],
  },
  documentary: {
    style: "documentary",
    displayName: "Documentary",
    characterSheetFocus: ["only when rights-cleared reenactment is required"],
    continuityFocus: ["source fidelity", "period/location constraints", "disclosure boundaries"],
    storyboardFocus: ["evidence mapping", "claim support", "no invented reenactment facts"],
    cameraAndMotionFocus: ["source-appropriate coverage", "restrained motion", "clear evidence visuals"],
  },
  other: {
    style: "other",
    displayName: "Custom approved style",
    characterSheetFocus: ["approved style bible requirements"],
    continuityFocus: ["sealed style bible", "cast identity", "locations", "props"],
    storyboardFocus: ["clear action", "first and last frame state", "continuity notes"],
    cameraAndMotionFocus: ["explicitly benchmarked controls only"],
  },
};

export function narrativeVisualStyleProfile(value: unknown): NarrativeVisualStyleProfile {
  const style = NarrativeVisualStyleSchema.parse(value);
  const profile = NARRATIVE_VISUAL_STYLE_PROFILES[style];
  return Object.freeze({
    ...profile,
    characterSheetFocus: Object.freeze([...profile.characterSheetFocus]),
    continuityFocus: Object.freeze([...profile.continuityFocus]),
    storyboardFocus: Object.freeze([...profile.storyboardFocus]),
    cameraAndMotionFocus: Object.freeze([...profile.cameraAndMotionFocus]),
  });
}

export const EditorialDiscoveryHypothesisSchema = z.object({
  /** This is deliberately a hypothesis, never a promised ranking or virality outcome. */
  status: z.literal("editorial_hypothesis"),
  nicheKey: boundedText(120),
  audienceNeed: boundedText(360),
  queryHypotheses: z.array(boundedText(180)).min(1).max(8),
  evidenceRefs: z.array(boundedText(800)).min(1).max(12),
}).strict();
export type EditorialDiscoveryHypothesis = z.infer<typeof EditorialDiscoveryHypothesisSchema>;

export const NarrativeEpisodeCandidateSchema = z.object({
  topic: boundedText(300),
  premise: boundedText(600),
  /** Explicitly named characters that must remain continuous if the episode is made. */
  recurringCharacterIds: z.array(boundedText(160)).max(12).default([]),
  discovery: EditorialDiscoveryHypothesisSchema,
}).strict();
export type NarrativeEpisodeCandidate = z.infer<typeof NarrativeEpisodeCandidateSchema>;

/**
 * The bounded, already-researched topic-bet projection available at channel
 * inception.  It intentionally carries a discovery hypothesis rather than a
 * promised ranking, view count, or virality outcome.
 */
export const NarrativeSeriesInceptionTopicBetSchema = z.object({
  topic: boundedText(300),
  rationale: z.string().trim().min(1).max(900).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  thumbnailMoment: z.string().trim().min(1).max(600).optional(),
  hookPromise: z.string().trim().min(1).max(600).optional(),
  betType: z.string().trim().min(1).max(120).optional(),
}).strict();
export type NarrativeSeriesInceptionTopicBet = z.infer<typeof NarrativeSeriesInceptionTopicBetSchema>;

export const NarrativeSeriesInceptionInputSchema = z.object({
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  seriesIdentity: boundedText(1_000),
  channelProgramBrief: ChannelProgramBriefSchema,
  /** Content-addressed research accepted before topic optimisation. */
  researchEvidenceFingerprint: FingerprintSchema,
  topicBets: z.array(NarrativeSeriesInceptionTopicBetSchema).min(1).max(24),
  planningHorizonEpisodes: positiveInteger.max(24).default(12),
  episodesPerSeason: positiveInteger.max(24).optional(),
  plannedSeasonCount: positiveInteger.max(12).optional(),
}).strict();

export const NarrativeSeriesPlanningInputSchema = z.object({
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  /** Route-owned serialized-program identity, not a display title. */
  seriesIdentity: boundedText(1_000),
  channelProgramBrief: ChannelProgramBriefSchema,
  visualStyle: NarrativeVisualStyleSchema,
  /** Number of episode briefs to plan now, not an authorization to render them. */
  planningHorizonEpisodes: positiveInteger.max(24).default(3),
  episodesPerSeason: positiveInteger.max(24).optional(),
  plannedSeasonCount: positiveInteger.max(12).optional(),
  topicCandidates: z.array(NarrativeEpisodeCandidateSchema).min(1).max(100),
}).strict();

const NarrativeSeasonSchema = z.object({
  seasonNumber: positiveInteger,
  startEpisodeNumber: positiveInteger,
  plannedEpisodeCapacity: positiveInteger,
  arcIntent: boundedText(700),
}).strict();

const PlannedShortsExpansionSchema = z.object({
  status: z.literal("awaiting_parent_release_evidence"),
  intent: z.literal("repurpose_only_if_safe_and_relevant"),
  requiredEvidence: z.array(boundedText(300)).min(1).max(8),
  /** The planner is forbidden from treating a prospective Short as published. */
  publishAuthorization: z.literal("none"),
}).strict();

const PlannedNarrativeEpisodeSchema = z.object({
  id: z.string().regex(/^planned-episode-[0-9]+$/u),
  episodeNumber: positiveInteger,
  seasonNumber: positiveInteger,
  episodeWithinSeason: positiveInteger,
  topic: boundedText(300),
  topicFingerprint: FingerprintSchema,
  premise: boundedText(600),
  narrativeFunction: z.enum(["premise", "development", "complication", "turn", "payoff"]),
  recurringCharacterIds: z.array(boundedText(160)).max(12),
  discovery: EditorialDiscoveryHypothesisSchema,
  shorts: PlannedShortsExpansionSchema,
}).strict();

const NarrativeSeriesPlanContentSchema = z.object({
  version: z.literal(NARRATIVE_SERIES_INTELLIGENCE_VERSION),
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  seriesIdentity: boundedText(1_000),
  seriesTitle: boundedText(160),
  programBriefFingerprint: FingerprintSchema,
  visualStyle: NarrativeVisualStyleSchema,
  visualStyleProfileFingerprint: FingerprintSchema,
  knownSeriesEpisodeCount: positiveInteger.max(100).optional(),
  planningHorizonEpisodes: positiveInteger.max(24),
  episodesPerSeason: positiveInteger.max(24),
  seasons: z.array(NarrativeSeasonSchema).min(1).max(12),
  episodes: z.array(PlannedNarrativeEpisodeSchema).min(1).max(24),
}).strict();

function narrativeSeriesPlanFingerprintForContent(
  content: z.infer<typeof NarrativeSeriesPlanContentSchema>,
): string {
  return fingerprint(content);
}

export const NarrativeSeriesPlanSchema = NarrativeSeriesPlanContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== narrativeSeriesPlanFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrative series plan fingerprint is invalid" });
  }
  const expectedEpisodeNumbers = value.episodes.map((episode) => episode.episodeNumber);
  if (new Set(expectedEpisodeNumbers).size !== expectedEpisodeNumbers.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrative series plan contains duplicate episode numbers" });
  }
  for (const episode of value.episodes) {
    const season = value.seasons.find((candidate) => candidate.seasonNumber === episode.seasonNumber);
    if (!season || episode.episodeWithinSeason > season.plannedEpisodeCapacity) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: `planned episode ${episode.id} falls outside its declared season capacity`,
      });
    }
  }
});
export type NarrativeSeriesPlan = z.infer<typeof NarrativeSeriesPlanSchema>;

function narrativeFunctionFor(index: number, total: number): z.infer<typeof PlannedNarrativeEpisodeSchema>["narrativeFunction"] {
  if (total <= 1) return "premise";
  if (index === 0) return "premise";
  if (index === total - 1) return "payoff";
  if (total >= 5 && index === total - 2) return "turn";
  return index % 2 === 0 ? "complication" : "development";
}

function plannedShortsExpansion(): z.infer<typeof PlannedShortsExpansionSchema> {
  return {
    status: "awaiting_parent_release_evidence",
    intent: "repurpose_only_if_safe_and_relevant",
    requiredEvidence: [
      "verified parent final-master release certificate",
      "source provenance and rights clearance for the selected moment",
      "portrait assembly and post-transform review evidence",
    ],
    publishAuthorization: "none",
  };
}

/**
 * Creates a small, evidence-backed horizon without pretending that a search
 * phrase guarantees discovery. The source program's `seriesCount`, when set,
 * caps the horizon but does not force extra episodes.
 */
export function createNarrativeSeriesPlan(value: unknown): NarrativeSeriesPlan {
  const input = NarrativeSeriesPlanningInputSchema.parse(value);
  const serialized = input.channelProgramBrief.serializedProgram;
  if (!serialized) {
    throw new Error("narrative series planning requires a serialized_program channel brief");
  }
  const knownSeriesEpisodeCount = serialized.seriesCount;
  const cappedHorizon = Math.min(
    input.planningHorizonEpisodes,
    input.topicCandidates.length,
    knownSeriesEpisodeCount ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(cappedHorizon) || cappedHorizon < 1) {
    throw new Error("narrative series planning requires at least one candidate inside the serialized episode limit");
  }
  const episodesPerSeason = input.episodesPerSeason
    ?? Math.max(1, Math.min(12, knownSeriesEpisodeCount ?? cappedHorizon));
  const naturalSeasonCount = Math.max(1, Math.ceil((knownSeriesEpisodeCount ?? cappedHorizon) / episodesPerSeason));
  const seasonCount = Math.min(
    12,
    Math.max(
      input.plannedSeasonCount ?? naturalSeasonCount,
      Math.ceil(cappedHorizon / episodesPerSeason),
    ),
  );
  const profile = narrativeVisualStyleProfile(input.visualStyle);
  const programBriefFingerprint = fingerprint(input.channelProgramBrief);

  const seasons = Array.from({ length: seasonCount }, (_, index) => {
    const seasonNumber = index + 1;
    const startEpisodeNumber = index * episodesPerSeason + 1;
    const remaining = knownSeriesEpisodeCount === undefined
      ? episodesPerSeason
      : Math.max(0, knownSeriesEpisodeCount - index * episodesPerSeason);
    return {
      seasonNumber,
      startEpisodeNumber,
      plannedEpisodeCapacity: Math.max(1, Math.min(episodesPerSeason, remaining || episodesPerSeason)),
      arcIntent: `Season ${seasonNumber} develops the reviewed ${serialized.seriesTitle} premise without silently resolving future continuity.`,
    };
  });

  const episodes = input.topicCandidates.slice(0, cappedHorizon).map((candidate, index) => {
    const episodeNumber = index + 1;
    const seasonNumber = Math.floor(index / episodesPerSeason) + 1;
    return {
      id: `planned-episode-${episodeNumber}`,
      episodeNumber,
      seasonNumber,
      episodeWithinSeason: ((index % episodesPerSeason) + 1),
      topic: normalizedText(candidate.topic),
      topicFingerprint: fingerprint(normalizedText(candidate.topic)),
      premise: normalizedText(candidate.premise),
      narrativeFunction: narrativeFunctionFor(index, cappedHorizon),
      recurringCharacterIds: uniqueSorted(candidate.recurringCharacterIds),
      discovery: {
        ...candidate.discovery,
        nicheKey: normalizedText(candidate.discovery.nicheKey),
        audienceNeed: normalizedText(candidate.discovery.audienceNeed),
        queryHypotheses: uniqueSorted(candidate.discovery.queryHypotheses.map(normalizedText)),
        evidenceRefs: uniqueSorted(candidate.discovery.evidenceRefs.map(normalizedText)),
      },
      shorts: plannedShortsExpansion(),
    };
  });

  const content: z.infer<typeof NarrativeSeriesPlanContentSchema> = {
    version: NARRATIVE_SERIES_INTELLIGENCE_VERSION,
    accountId: input.accountId,
    channelId: input.channelId,
    seriesIdentity: normalizedText(input.seriesIdentity),
    seriesTitle: normalizedText(serialized.seriesTitle),
    programBriefFingerprint,
    visualStyle: input.visualStyle,
    visualStyleProfileFingerprint: fingerprint(profile),
    ...(knownSeriesEpisodeCount === undefined ? {} : { knownSeriesEpisodeCount }),
    planningHorizonEpisodes: cappedHorizon,
    episodesPerSeason,
    seasons,
    episodes,
  };
  return Object.freeze(NarrativeSeriesPlanSchema.parse({
    ...content,
    fingerprint: narrativeSeriesPlanFingerprintForContent(content),
  }));
}

/**
 * Maps a family to a *planning* treatment. This is not renderer admission: a
 * treatment can still be rejected later unless its exact adapter, assets, and
 * quality benchmark are approved. Keeping that distinction explicit lets
 * serial comic channels gain a useful horizon today without claiming LoRA or
 * reference-image support that their renderer does not yet have.
 */
export function narrativeVisualStyleForFamily(family: string): NarrativeVisualStyle {
  switch (family) {
    case "cinematic":
      return "cinematic";
    case "comic":
      return "comic";
    case "illustrated_explainer":
    case "whiteboard":
      return "drawn";
    case "documentary_collage_short":
      return "documentary";
    default:
      return "other";
  }
}

function compactNarrativeText(value: string | undefined, maximum: number, fallback: string): string {
  const normalized = normalizedText(value ?? "") || fallback;
  return normalized.length <= maximum
    ? normalized
    : normalized.slice(0, Math.max(1, maximum - 1)).trimEnd() + "…";
}

/**
 * Converts the bounded, research-grounded topic bets made during channel
 * inception into a frozen multi-episode horizon.  The two evidence references
 * make the provenance honest: one identifies the validated research sample;
 * the other identifies the complete topic-bet projection that was selected.
 * They are evidence of a discovery hypothesis, never an SEO or virality
 * guarantee.
 */
export function createNarrativeSeriesPlanFromInception(value: unknown): NarrativeSeriesPlan {
  const input = NarrativeSeriesInceptionInputSchema.parse(value);
  const betCollectionFingerprint = fingerprint(input.topicBets);
  const topicCandidates: NarrativeEpisodeCandidate[] = input.topicBets.map((bet) => {
    const topic = compactNarrativeText(bet.topic, 300, "Untitled serial episode");
    const title = compactNarrativeText(bet.title, 180, topic);
    const hook = compactNarrativeText(bet.hookPromise, 360, title);
    const rationale = compactNarrativeText(bet.rationale, 600, hook);
    const betFingerprint = fingerprint(bet);
    return {
      topic,
      premise: hook,
      recurringCharacterIds: [],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: input.channelProgramBrief.nicheKey,
        audienceNeed: hook,
        queryHypotheses: uniqueSorted([title, topic]),
        evidenceRefs: [
          `channel-research-evidence/v1/${input.researchEvidenceFingerprint}`,
          `topic-bet-collection/v1/${betCollectionFingerprint}`,
          `topic-bet/v1/${betFingerprint}`,
          // The bounded rationale is deliberately preserved as an editorial
          // explanation, not promoted into a factual source citation.
          `editorial-rationale/v1/${fingerprint(rationale)}`,
        ],
      },
    };
  });
  return createNarrativeSeriesPlan({
    accountId: input.accountId,
    channelId: input.channelId,
    seriesIdentity: input.seriesIdentity,
    channelProgramBrief: input.channelProgramBrief,
    visualStyle: narrativeVisualStyleForFamily(input.channelProgramBrief.family),
    planningHorizonEpisodes: input.planningHorizonEpisodes,
    ...(input.episodesPerSeason === undefined ? {} : { episodesPerSeason: input.episodesPerSeason }),
    ...(input.plannedSeasonCount === undefined ? {} : { plannedSeasonCount: input.plannedSeasonCount }),
    topicCandidates,
  });
}

export function assertNarrativeSeriesPlan(value: unknown): NarrativeSeriesPlan {
  return NarrativeSeriesPlanSchema.parse(value);
}

export const NarrativeEpisodeSeriesBindingSchema = z.object({
  version: z.literal(NARRATIVE_SERIES_INTELLIGENCE_VERSION),
  seriesPlanFingerprint: FingerprintSchema,
  plannedEpisodeId: z.string().regex(/^planned-episode-[0-9]+$/u),
  episodeNumber: positiveInteger,
  serializedEpisodeContextFingerprint: FingerprintSchema,
  episodeGraphFingerprint: FingerprintSchema,
  storySpineFingerprint: FingerprintSchema,
  fingerprint: FingerprintSchema,
}).strict().superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== fingerprint(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrative episode series binding fingerprint is invalid" });
  }
});
export type NarrativeEpisodeSeriesBinding = z.infer<typeof NarrativeEpisodeSeriesBindingSchema>;

/** Bind one frozen run to its horizon entry before a visual adapter can use it. */
export function bindNarrativeEpisodeToSeries(value: {
  readonly plan: unknown;
  readonly serializedEpisodeContext: unknown;
  readonly episodeGraph: unknown;
  readonly storySpine: unknown;
}): NarrativeEpisodeSeriesBinding {
  const plan = NarrativeSeriesPlanSchema.parse(value.plan);
  const context = SerializedProgramEpisodeContextSchema.parse(value.serializedEpisodeContext);
  const graph = EpisodeGraphSchema.parse(value.episodeGraph);
  const spine = StorySpineSchema.parse(value.storySpine);
  if (context.seriesIdentity !== plan.seriesIdentity) {
    throw new Error("serialized episode context does not belong to the narrative series plan");
  }
  const episode = plan.episodes.find((candidate) => candidate.episodeNumber === context.episodeNumber);
  if (!episode) {
    throw new Error("serialized episode number is outside the narrative planning horizon");
  }
  if (!sameText(episode.topic, context.topic) || !sameText(graph.topic, context.topic)) {
    throw new Error("narrative series topic, frozen episode context, and Episode Graph must agree");
  }
  const content = {
    version: NARRATIVE_SERIES_INTELLIGENCE_VERSION,
    seriesPlanFingerprint: plan.fingerprint,
    plannedEpisodeId: episode.id,
    episodeNumber: context.episodeNumber,
    serializedEpisodeContextFingerprint: context.fingerprint,
    episodeGraphFingerprint: episodeGraphFingerprint(graph),
    storySpineFingerprint: storySpineFingerprint(spine),
  } as const;
  return Object.freeze(NarrativeEpisodeSeriesBindingSchema.parse({
    ...content,
    fingerprint: fingerprint(content),
  }));
}

const NarrativeShotControlSchema = z.object({
  shotId: z.string().regex(/^shot-[a-z0-9-]+$/u),
  continuityCharacterIds: z.array(z.string().regex(/^character-[a-z0-9-]+$/u)),
  locationId: z.string().regex(/^setting-[a-z0-9-]+$/u).optional(),
  cameraMove: boundedText(160),
  lens: boundedText(240),
  motion: boundedText(1_600),
  firstFrameConstraint: boundedText(1_600),
  lastFrameConstraint: boundedText(1_600),
  continuityState: boundedText(1_600),
}).strict();

const NarrativeShotControlContractContentSchema = z.object({
  version: z.literal(NARRATIVE_SHOT_CONTROL_VERSION),
  episodeBindingFingerprint: FingerprintSchema,
  immutableProjectBriefFingerprint: FingerprintSchema,
  visualStyle: NarrativeVisualStyleSchema,
  visualStyleProfileFingerprint: FingerprintSchema,
  castLocks: z.array(z.object({
    characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
    displayName: boundedText(80),
    continuityLock: boundedText(600),
  }).strict()).max(24),
  locationLocks: z.array(z.object({
    settingId: z.string().regex(/^setting-[a-z0-9-]+$/u),
    displayName: boundedText(120),
    continuityLock: boundedText(600),
  }).strict()).max(24),
  /** Required capabilities, not a declaration that any adapter provides them. */
  requiredAdapterCapabilities: z.array(z.enum([
    "reusable_cast_or_character_adapter",
    "first_frame_conditioning",
    "last_frame_continuation",
    "camera_lens_motion_controls",
  ])).min(1).max(4),
  shots: z.array(NarrativeShotControlSchema).min(1).max(500),
}).strict();

function narrativeShotControlFingerprintForContent(
  content: z.infer<typeof NarrativeShotControlContractContentSchema>,
): string {
  return fingerprint(content);
}

export const NarrativeShotControlContractSchema = NarrativeShotControlContractContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== narrativeShotControlFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrative shot-control contract fingerprint is invalid" });
  }
});
export type NarrativeShotControlContract = z.infer<typeof NarrativeShotControlContractSchema>;

/**
 * Compiles renderer-neutral first/last-frame and camera locks from existing
 * Story Spine + Episode Graph data. It does not choose or invoke a renderer.
 */
export function createNarrativeShotControlContract(value: {
  readonly binding: unknown;
  readonly immutableProjectBriefFingerprint: string;
  readonly visualStyle: unknown;
  readonly episodeGraph: unknown;
  readonly storySpine: unknown;
}): NarrativeShotControlContract {
  const binding = NarrativeEpisodeSeriesBindingSchema.parse(value.binding);
  const graph = EpisodeGraphSchema.parse(value.episodeGraph);
  const spine = StorySpineSchema.parse(value.storySpine);
  if (episodeGraphFingerprint(graph) !== binding.episodeGraphFingerprint
    || storySpineFingerprint(spine) !== binding.storySpineFingerprint) {
    throw new Error("shot-control inputs do not match the frozen narrative episode binding");
  }
  const immutableProjectBriefFingerprint = FingerprintSchema.parse(value.immutableProjectBriefFingerprint);
  const visualStyle = NarrativeVisualStyleSchema.parse(value.visualStyle);
  const profile = narrativeVisualStyleProfile(visualStyle);
  const graphBeatByStoryBeat = new Map<string, typeof graph.beats>();
  for (const beat of graph.beats) {
    for (const storyBeatId of beat.storySpineBeatIds) {
      const current = graphBeatByStoryBeat.get(storyBeatId) ?? [];
      current.push(beat);
      graphBeatByStoryBeat.set(storyBeatId, current);
    }
  }
  const dpSpecByShotId = new Map(spine.dpVisualSpecs.map((spec) => [spec.shotId, spec] as const));
  const shots = spine.shotList.map((shot) => {
    const dp = dpSpecByShotId.get(shot.id);
    if (!dp) throw new Error(`Story Spine has no DP visual spec for ${shot.id}`);
    const supportedGraphBeats = graphBeatByStoryBeat.get(shot.beatId) ?? [];
    const continuityCharacterIds = uniqueSorted(supportedGraphBeats.flatMap((beat) => beat.characterIds));
    const locationId = supportedGraphBeats.map((beat) => beat.settingId).find(Boolean);
    return {
      shotId: shot.id,
      continuityCharacterIds,
      ...(locationId === undefined ? {} : { locationId }),
      cameraMove: shot.cameraMove,
      lens: shot.lens,
      motion: dp.motionPrompt,
      firstFrameConstraint: dp.firstFrameConstraint,
      lastFrameConstraint: dp.lastFrameConstraint,
      continuityState: dp.continuityState,
    };
  });
  const content: z.infer<typeof NarrativeShotControlContractContentSchema> = {
    version: NARRATIVE_SHOT_CONTROL_VERSION,
    episodeBindingFingerprint: binding.fingerprint,
    immutableProjectBriefFingerprint,
    visualStyle,
    visualStyleProfileFingerprint: fingerprint(profile),
    castLocks: graph.characters.map((character) => ({
      characterId: character.id,
      displayName: character.displayName,
      continuityLock: character.continuityLock,
    })),
    locationLocks: graph.settings.map((setting) => ({
      settingId: setting.id,
      displayName: setting.displayName,
      continuityLock: setting.continuityLock,
    })),
    requiredAdapterCapabilities: [
      "reusable_cast_or_character_adapter",
      "first_frame_conditioning",
      "last_frame_continuation",
      "camera_lens_motion_controls",
    ],
    shots,
  };
  return Object.freeze(NarrativeShotControlContractSchema.parse({
    ...content,
    fingerprint: narrativeShotControlFingerprintForContent(content),
  }));
}

export const ParentShortsReleaseReadinessSchema = z.object({
  finalMasterReleaseEvidence: z.enum(["verified", "missing", "invalid"]),
  finalMasterCertificateFingerprint: FingerprintSchema.optional(),
  sourceProvenance: z.enum(["first_party", "licensed", "unknown", "blocked"]),
  selectedMomentRights: z.enum(["cleared", "unknown", "blocked"]),
  /**
   * A prospective Short has no portrait master yet. This field is only useful
   * for a re-evaluation after a prior transform; its absence must not cause us
   * to pretend that the future derivative has already been reviewed.
   */
  portraitAssemblyAndReviewEvidence: z.enum(["verified", "missing", "invalid"]).optional(),
  /** Allows a future worker to make a private draft only after its own transform review. */
  automaticDraftCreationAllowed: z.boolean(),
}).strict();

const ShortCandidateSchema = z.object({
  id: z.string().regex(/^short-candidate-[0-9]+$/u),
  parentBeatId: z.string().regex(/^beat-[a-z0-9-]+$/u),
  sourceWindow: z.object({
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
  }).strict().refine((window) => window.t1 > window.t0, "Short source window must be positive"),
  hookBasis: boundedText(1_200),
  editorialAim: boundedText(360),
  discoveryStatus: z.literal("editorial_hypothesis"),
  /** A candidate still needs portrait assembly + the existing Short release gate. */
  disposition: z.literal("candidate_only"),
}).strict();

const ShortsExpansionPlanContentSchema = z.object({
  version: z.literal(SHORTS_EXPANSION_PLAN_VERSION),
  parentEpisodeGraphFingerprint: FingerprintSchema,
  parentSeriesPlanFingerprint: FingerprintSchema,
  status: z.enum(["blocked", "no_safe_candidate", "candidate_briefs_ready"]),
  automaticAction: z.enum(["none", "draft_only_after_post_transform_review"]),
  blockers: z.array(boundedText(500)).max(12),
  candidates: z.array(ShortCandidateSchema).max(3),
  /** This planner has no authority to publish. */
  publishAuthorization: z.literal("none"),
}).strict();

function shortsExpansionPlanFingerprintForContent(
  content: z.infer<typeof ShortsExpansionPlanContentSchema>,
): string {
  return fingerprint(content);
}

export const ShortsExpansionPlanSchema = ShortsExpansionPlanContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== shortsExpansionPlanFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "Shorts expansion plan fingerprint is invalid" });
  }
  if (value.status !== "candidate_briefs_ready" && value.candidates.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "blocked Shorts plans cannot contain candidates" });
  }
});
export type ShortsExpansionPlan = z.infer<typeof ShortsExpansionPlanSchema>;

/**
 * Safe repurposing planner. It will only expose exact source windows after the
 * parent master, rights, and portrait-review evidence are verified. It never
 * turns a planned clip into a publish request.
 */
export function planNarrativeShortsExpansion(value: {
  readonly seriesPlan: unknown;
  readonly episodeBinding: unknown;
  readonly episodeGraph: unknown;
  readonly parentReleaseReadiness: unknown;
  readonly maxCandidateDurationSec?: number;
}): ShortsExpansionPlan {
  const plan = NarrativeSeriesPlanSchema.parse(value.seriesPlan);
  const binding = NarrativeEpisodeSeriesBindingSchema.parse(value.episodeBinding);
  const graph = EpisodeGraphSchema.parse(value.episodeGraph);
  const readiness = ParentShortsReleaseReadinessSchema.parse(value.parentReleaseReadiness);
  const maxCandidateDurationSec = Math.min(180, Math.max(15, Number(value.maxCandidateDurationSec ?? 60)));
  if (!Number.isFinite(maxCandidateDurationSec)) {
    throw new Error("Shorts expansion maximum duration must be finite");
  }
  if (binding.seriesPlanFingerprint !== plan.fingerprint
    || binding.episodeGraphFingerprint !== episodeGraphFingerprint(graph)) {
    throw new Error("Shorts expansion inputs do not match the frozen narrative episode binding");
  }
  const blockers: string[] = [];
  if (readiness.finalMasterReleaseEvidence !== "verified" || !readiness.finalMasterCertificateFingerprint) {
    blockers.push("verified parent final-master release evidence is required");
  }
  if (!(readiness.sourceProvenance === "first_party" || readiness.sourceProvenance === "licensed")) {
    blockers.push("parent source provenance must be first-party or licensed");
  }
  if (readiness.selectedMomentRights !== "cleared") {
    blockers.push("selected moment rights must be cleared before repurposing");
  }
  if (readiness.portraitAssemblyAndReviewEvidence === "invalid") {
    blockers.push("a prior portrait assembly or post-transform review was invalid");
  }
  const base = {
    version: SHORTS_EXPANSION_PLAN_VERSION,
    parentEpisodeGraphFingerprint: episodeGraphFingerprint(graph),
    parentSeriesPlanFingerprint: plan.fingerprint,
    publishAuthorization: "none" as const,
  };
  if (blockers.length) {
    const content: z.infer<typeof ShortsExpansionPlanContentSchema> = {
      ...base,
      status: "blocked",
      automaticAction: "none",
      blockers,
      candidates: [],
    };
    return Object.freeze(ShortsExpansionPlanSchema.parse({
      ...content,
      fingerprint: shortsExpansionPlanFingerprintForContent(content),
    }));
  }
  const hookPriority: Readonly<Record<string, number>> = {
    question: 6,
    problem: 5,
    choice: 5,
    result: 5,
    experiment: 4,
    lesson: 4,
    opening: 3,
    observation: 2,
    claim: 2,
    resolution: 1,
  };
  const candidates = graph.beats
    .filter((beat) => beat.t1 - beat.t0 >= 15 && beat.t1 - beat.t0 <= maxCandidateDurationSec)
    .sort((left, right) => {
      const priority = (hookPriority[right.kind] ?? 0) - (hookPriority[left.kind] ?? 0);
      if (priority) return priority;
      const target = Math.min(45, maxCandidateDurationSec);
      const durationDistance = Math.abs((left.t1 - left.t0) - target) - Math.abs((right.t1 - right.t0) - target);
      return durationDistance || left.t0 - right.t0;
    })
    .slice(0, 3)
    .map((beat, index) => ({
      id: `short-candidate-${index + 1}`,
      parentBeatId: beat.id,
      sourceWindow: { t0: beat.t0, t1: beat.t1 },
      hookBasis: beat.text,
      editorialAim: `Use the existing ${beat.kind} beat as a self-contained entry point, without overstating its discovery outcome.`,
      discoveryStatus: "editorial_hypothesis" as const,
      disposition: "candidate_only" as const,
    }));
  const content: z.infer<typeof ShortsExpansionPlanContentSchema> = candidates.length
    ? {
      ...base,
      status: "candidate_briefs_ready",
      automaticAction: readiness.automaticDraftCreationAllowed
        ? "draft_only_after_post_transform_review"
        : "none",
      blockers: [],
      candidates,
    }
    : {
      ...base,
      status: "no_safe_candidate",
      automaticAction: "none",
      blockers: ["no self-contained 15–180 second source window is available from the reviewed Episode Graph"],
      candidates: [],
    };
  return Object.freeze(ShortsExpansionPlanSchema.parse({
    ...content,
    fingerprint: shortsExpansionPlanFingerprintForContent(content),
  }));
}

/** Script-derived character identities are names/locks, never a training result. */
export const NarrativeCharacterIdentitySchema = z.object({
  characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
  displayName: boundedText(80),
  identityLock: boundedText(1_600),
  visualStyle: NarrativeVisualStyleSchema,
}).strict();
export type NarrativeCharacterIdentity = z.infer<typeof NarrativeCharacterIdentitySchema>;

export const CHARACTER_SHEET_VIEWS = [
  "front",
  "three_quarter",
  "profile",
  "back",
  "expression",
  "wardrobe",
] as const;
export const CharacterSheetViewSchema = z.enum(CHARACTER_SHEET_VIEWS);
export type CharacterSheetView = z.infer<typeof CharacterSheetViewSchema>;

/**
 * Future script-derived character sheets are admitted only with an exact
 * ERNIE/Novita provider receipt. This policy does not assert that the route is
 * live; the production worker must still prove its durable lease and artifact
 * attestation before any dataset can be sealed.
 */
export const CharacterSheetSourcePolicySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attested_ernie_character_sheet"),
    provider: z.literal("novita"),
    route: z.literal("ernie-image-novita-4090"),
    providerReceiptRequired: z.literal(true),
    outputUse: z.literal("one_time_script_derived_character_lora_dataset_only"),
    ordinaryProductionVisualUseProhibited: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("owner_or_licensed_reference_assets"),
    outputUse: z.literal("character_lora_dataset_only"),
    ordinaryProductionVisualUseProhibited: z.literal(true),
  }).strict(),
]);
export type CharacterSheetSourcePolicy = z.infer<typeof CharacterSheetSourcePolicySchema>;

export const SealedCharacterLoRAPolicySchema = z.object({
  policyFingerprint: FingerprintSchema,
  state: z.literal("sealed"),
  characterLoRATrainingEnabled: z.boolean(),
  automaticAdmissionEnabled: z.boolean(),
  attestedErnieCharacterSheetEnabled: z.boolean(),
  perCharacterSpendCapCents: currencyCents,
}).strict();
export type SealedCharacterLoRAPolicy = z.infer<typeof SealedCharacterLoRAPolicySchema>;

function sourcePolicyIsAllowed(
  policy: SealedCharacterLoRAPolicy,
  source: CharacterSheetSourcePolicy,
): boolean {
  if (source.kind === "attested_ernie_character_sheet") {
    return policy.attestedErnieCharacterSheetEnabled;
  }
  return true;
}

const CharacterSheetDatasetPlanContentSchema = z.object({
  version: z.literal(CHARACTER_SHEET_DATASET_VERSION),
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  channelPolicyFingerprint: FingerprintSchema,
  character: NarrativeCharacterIdentitySchema,
  characterSpecFingerprint: FingerprintSchema,
  scriptTreatmentFingerprint: FingerprintSchema,
  sourcePolicy: CharacterSheetSourcePolicySchema,
  requiredViews: z.array(CharacterSheetViewSchema).length(CHARACTER_SHEET_VIEWS.length),
}).strict();

function characterSheetDatasetPlanFingerprintForContent(
  content: z.infer<typeof CharacterSheetDatasetPlanContentSchema>,
): string {
  return fingerprint(content);
}

export const CharacterSheetDatasetPlanSchema = CharacterSheetDatasetPlanContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== characterSheetDatasetPlanFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character-sheet dataset plan fingerprint is invalid" });
  }
  const views = [...value.requiredViews].sort();
  const expected = [...CHARACTER_SHEET_VIEWS].sort();
  if (views.join("|") !== expected.join("|")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character-sheet plan must require each canonical multi-angle view exactly once" });
  }
});
export type CharacterSheetDatasetPlan = z.infer<typeof CharacterSheetDatasetPlanSchema>;

export function createCharacterSheetDatasetPlan(value: {
  readonly accountId: string;
  readonly channelId: string;
  readonly sealedChannelPolicy: unknown;
  readonly character: unknown;
  readonly scriptTreatmentFingerprint: string;
  readonly sourcePolicy: unknown;
}): CharacterSheetDatasetPlan {
  const policy = SealedCharacterLoRAPolicySchema.parse(value.sealedChannelPolicy);
  const character = NarrativeCharacterIdentitySchema.parse(value.character);
  const sourcePolicy = CharacterSheetSourcePolicySchema.parse(value.sourcePolicy);
  if (!policy.characterLoRATrainingEnabled) {
    throw new Error("sealed channel policy does not enable character LoRA training");
  }
  if (!sourcePolicyIsAllowed(policy, sourcePolicy)) {
    throw new Error(`sealed channel policy does not permit ${sourcePolicy.kind}`);
  }
  const content: z.infer<typeof CharacterSheetDatasetPlanContentSchema> = {
    version: CHARACTER_SHEET_DATASET_VERSION,
    accountId: OwnedIdSchema.parse(value.accountId),
    channelId: OwnedIdSchema.parse(value.channelId),
    channelPolicyFingerprint: policy.policyFingerprint,
    character,
    characterSpecFingerprint: fingerprint(character),
    scriptTreatmentFingerprint: FingerprintSchema.parse(value.scriptTreatmentFingerprint),
    sourcePolicy,
    requiredViews: [...CHARACTER_SHEET_VIEWS],
  };
  return Object.freeze(CharacterSheetDatasetPlanSchema.parse({
    ...content,
    fingerprint: characterSheetDatasetPlanFingerprintForContent(content),
  }));
}

const CharacterSheetDatasetAssetSchema = z.object({
  view: CharacterSheetViewSchema,
  r2Key: boundedText(1_500),
  contentSha256: FingerprintSchema,
  assetReceiptFingerprint: FingerprintSchema,
}).strict();

const CharacterSheetDatasetRightsSchema = z.object({
  status: z.literal("verified"),
  scope: z.literal("training_and_inference"),
  rightsReceiptFingerprint: FingerprintSchema,
}).strict();

const CharacterSheetDatasetCoverageSchema = z.object({
  status: z.literal("passed"),
  coverageReceiptFingerprint: FingerprintSchema,
}).strict();

const CharacterSheetDatasetManifestContentSchema = z.object({
  version: z.literal(CHARACTER_SHEET_DATASET_VERSION),
  sheetPlanFingerprint: FingerprintSchema,
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
  assets: z.array(CharacterSheetDatasetAssetSchema).length(CHARACTER_SHEET_VIEWS.length),
  rights: CharacterSheetDatasetRightsSchema,
  coverage: CharacterSheetDatasetCoverageSchema,
}).strict();

function characterSheetDatasetManifestFingerprintForContent(
  content: z.infer<typeof CharacterSheetDatasetManifestContentSchema>,
): string {
  return fingerprint({
    ...content,
    assets: [...content.assets].sort((left, right) => left.view.localeCompare(right.view)),
  });
}

export const CharacterSheetDatasetManifestSchema = CharacterSheetDatasetManifestContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== characterSheetDatasetManifestFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character-sheet dataset manifest fingerprint is invalid" });
  }
  const views = value.assets.map((asset) => asset.view).sort();
  const expected = [...CHARACTER_SHEET_VIEWS].sort();
  if (views.join("|") !== expected.join("|")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character-sheet dataset must contain each required view exactly once" });
  }
});
export type CharacterSheetDatasetManifest = z.infer<typeof CharacterSheetDatasetManifestSchema>;

/**
 * Stores only durable asset references and independently verified rights /
 * coverage receipts. An adapter must provide those receipts after producing or
 * accepting the dataset; this planner does not fabricate them.
 */
export function createCharacterSheetDatasetManifest(value: {
  readonly plan: unknown;
  readonly assets: readonly unknown[];
  readonly rights: unknown;
  readonly coverage: unknown;
}): CharacterSheetDatasetManifest {
  const plan = CharacterSheetDatasetPlanSchema.parse(value.plan);
  const assets = z.array(CharacterSheetDatasetAssetSchema).length(CHARACTER_SHEET_VIEWS.length).parse(value.assets);
  const rights = CharacterSheetDatasetRightsSchema.parse(value.rights);
  const coverage = CharacterSheetDatasetCoverageSchema.parse(value.coverage);
  const content: z.infer<typeof CharacterSheetDatasetManifestContentSchema> = {
    version: CHARACTER_SHEET_DATASET_VERSION,
    sheetPlanFingerprint: plan.fingerprint,
    accountId: plan.accountId,
    channelId: plan.channelId,
    characterId: plan.character.characterId,
    assets: [...assets].sort((left, right) => left.view.localeCompare(right.view)),
    rights,
    coverage,
  };
  return Object.freeze(CharacterSheetDatasetManifestSchema.parse({
    ...content,
    fingerprint: characterSheetDatasetManifestFingerprintForContent(content),
  }));
}

export function assertCharacterSheetDatasetBinding(value: {
  readonly plan: unknown;
  readonly manifest: unknown;
}): { readonly plan: CharacterSheetDatasetPlan; readonly manifest: CharacterSheetDatasetManifest } {
  const plan = CharacterSheetDatasetPlanSchema.parse(value.plan);
  const manifest = CharacterSheetDatasetManifestSchema.parse(value.manifest);
  if (manifest.sheetPlanFingerprint !== plan.fingerprint
    || manifest.accountId !== plan.accountId
    || manifest.channelId !== plan.channelId
    || manifest.characterId !== plan.character.characterId) {
    throw new Error("character-sheet dataset manifest is not bound to the requested channel/account/character plan");
  }
  return Object.freeze({ plan, manifest });
}

export const CharacterLoRAProviderSchema = z.enum(["comfyui", "novita", "ltx"]);
export type CharacterLoRAProvider = z.infer<typeof CharacterLoRAProviderSchema>;
export const CharacterLoRAFlavorSchema = z.enum(["lora", "ic_lora"]);
export type CharacterLoRAFlavor = z.infer<typeof CharacterLoRAFlavorSchema>;

export const CharacterLoRACapabilityBenchmarkSchema = z.object({
  provider: CharacterLoRAProviderSchema,
  adapterFlavor: CharacterLoRAFlavorSchema,
  runtimeProfileFingerprint: FingerprintSchema,
  requiredCapabilities: z.array(z.enum([
    "character_adapter_loading",
    "identity_consistency",
    "first_last_frame_support",
    "camera_motion_control",
  ])).min(1).max(4),
  status: z.enum(["unverified", "failed", "passed"]),
  proofReceiptFingerprint: FingerprintSchema.optional(),
}).strict().superRefine((value, issue) => {
  if (value.status === "passed" && !value.proofReceiptFingerprint) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "a passed adapter capability benchmark requires a proof receipt" });
  }
});
export type CharacterLoRACapabilityBenchmark = z.infer<typeof CharacterLoRACapabilityBenchmarkSchema>;

export const CharacterLoRABudgetReservationSchema = z.object({
  reservationId: boundedText(500),
  budgetLedgerFingerprint: FingerprintSchema,
  currency: z.literal("USD"),
  plannedSpendCents: positiveInteger,
  reservedCents: positiveInteger,
  status: z.literal("held"),
}).strict().superRefine((value, issue) => {
  if (value.plannedSpendCents !== value.reservedCents) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character LoRA reservation must exactly equal planned spend" });
  }
});
export type CharacterLoRABudgetReservation = z.infer<typeof CharacterLoRABudgetReservationSchema>;

const CharacterLoRARegistryIdentityInputSchema = z.object({
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
  characterSpecFingerprint: FingerprintSchema,
  datasetFingerprint: FingerprintSchema,
}).strict();

/**
 * The permanent uniqueness key. A storage adapter must insert this atomically;
 * do not key a new training task only by episode/run, which would retrain the
 * same character for every episode.
 */
export function characterLoRARegistryIdentity(value: unknown): string {
  return fingerprint({
    version: CHARACTER_LORA_REGISTRY_VERSION,
    ...CharacterLoRARegistryIdentityInputSchema.parse(value),
  });
}

const CharacterLoRATrainingRequestContentSchema = z.object({
  version: z.literal(CHARACTER_LORA_REGISTRY_VERSION),
  registryIdentity: FingerprintSchema,
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
  characterSpecFingerprint: FingerprintSchema,
  datasetFingerprint: FingerprintSchema,
  sheetPlanFingerprint: FingerprintSchema,
  channelPolicyFingerprint: FingerprintSchema,
  target: CharacterLoRACapabilityBenchmarkSchema,
  budgetReservation: CharacterLoRABudgetReservationSchema,
  gates: z.object({
    sealedChannelPolicy: z.boolean(),
    sourcePolicy: z.boolean(),
    datasetRights: z.boolean(),
    datasetCoverage: z.boolean(),
    exactBudgetReservation: z.boolean(),
    capabilityBenchmark: z.boolean(),
  }).strict(),
  status: z.enum(["blocked", "admitted"]),
  autoEligible: z.boolean(),
  blockers: z.array(boundedText(500)).max(12),
  /** No training task ID exists until a later approved adapter dispatches one. */
  providerInvocation: z.literal("not_started"),
}).strict();

function characterLoRATrainingRequestFingerprintForContent(
  content: z.infer<typeof CharacterLoRATrainingRequestContentSchema>,
): string {
  return fingerprint(content);
}

export const CharacterLoRATrainingRequestSchema = CharacterLoRATrainingRequestContentSchema.extend({
  fingerprint: FingerprintSchema,
}).superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== characterLoRATrainingRequestFingerprintForContent(content)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character LoRA training request fingerprint is invalid" });
  }
  if (value.autoEligible !== (value.status === "admitted")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "character LoRA training status must match automatic eligibility" });
  }
});
export type CharacterLoRATrainingRequest = z.infer<typeof CharacterLoRATrainingRequestSchema>;

const AcceptedCharacterLoRAAdapterSchema = z.object({
  provider: CharacterLoRAProviderSchema,
  adapterFlavor: CharacterLoRAFlavorSchema,
  runtimeProfileFingerprint: FingerprintSchema,
  adapterReference: boundedText(1_500),
  lifecycleReceiptFingerprint: FingerprintSchema,
  benchmarkProofReceiptFingerprint: FingerprintSchema,
}).strict();

export const CharacterLoRARegistryEntrySchema = z.object({
  version: z.literal(CHARACTER_LORA_REGISTRY_VERSION),
  registryIdentity: FingerprintSchema,
  accountId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  characterId: z.string().regex(/^character-[a-z0-9-]+$/u),
  characterSpecFingerprint: FingerprintSchema,
  datasetFingerprint: FingerprintSchema,
  trainingRequestFingerprint: FingerprintSchema,
  status: z.enum(["admitted", "training_started", "accepted", "rejected"]),
  acceptedAdapter: AcceptedCharacterLoRAAdapterSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((value, issue) => {
  if (value.status === "accepted" && !value.acceptedAdapter) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "accepted character LoRA registry entry requires an adapter receipt" });
  }
  if (value.status !== "accepted" && value.acceptedAdapter) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "only an accepted character LoRA entry may expose an adapter" });
  }
});
export type CharacterLoRARegistryEntry = z.infer<typeof CharacterLoRARegistryEntrySchema>;

/** Persistence boundary: adapters must implement an atomic uniqueness write. */
export interface CharacterLoRARegistryAuthority {
  findByRegistryIdentity(registryIdentity: string): Promise<CharacterLoRARegistryEntry | null>;
  insertIfAbsent(entry: CharacterLoRARegistryEntry): Promise<{
    readonly inserted: boolean;
    readonly entry: CharacterLoRARegistryEntry;
  }>;
}

const CharacterLoRATrainingAdmissionInputSchema = z.object({
  sealedChannelPolicy: SealedCharacterLoRAPolicySchema,
  sheetPlan: CharacterSheetDatasetPlanSchema,
  datasetManifest: CharacterSheetDatasetManifestSchema,
  budgetReservation: CharacterLoRABudgetReservationSchema,
  capabilityBenchmark: CharacterLoRACapabilityBenchmarkSchema,
  existingRegistryEntries: z.array(CharacterLoRARegistryEntrySchema).max(100),
}).strict();

export type CharacterLoRATrainingAdmission =
  | Readonly<{
    decision: "reuse_accepted";
    registryIdentity: string;
    entry: CharacterLoRARegistryEntry;
  }>
  | Readonly<{
    decision: "wait_for_existing";
    registryIdentity: string;
    entry: CharacterLoRARegistryEntry;
  }>
  | Readonly<{
    decision: "training_admitted" | "training_blocked";
    registryIdentity: string;
    request: CharacterLoRATrainingRequest;
  }>;

/**
 * Evaluates a train-or-reuse decision without a side effect. Matching accepted
 * character/spec/dataset fingerprints always resolve to reuse, never retrain.
 */
export function assessCharacterLoRATrainingAdmission(value: unknown): CharacterLoRATrainingAdmission {
  const input = CharacterLoRATrainingAdmissionInputSchema.parse(value);
  const { plan, manifest } = assertCharacterSheetDatasetBinding({
    plan: input.sheetPlan,
    manifest: input.datasetManifest,
  });
  const registryIdentity = characterLoRARegistryIdentity({
    accountId: plan.accountId,
    channelId: plan.channelId,
    characterId: plan.character.characterId,
    characterSpecFingerprint: plan.characterSpecFingerprint,
    datasetFingerprint: manifest.fingerprint,
  });
  const matchingEntries = input.existingRegistryEntries.filter((entry) => entry.registryIdentity === registryIdentity);
  if (matchingEntries.length > 1) {
    throw new Error("character LoRA registry has duplicate entries for one durable account/channel/character/spec/dataset identity");
  }
  const existing = matchingEntries[0];
  if (existing?.status === "accepted") {
    return Object.freeze({ decision: "reuse_accepted", registryIdentity, entry: existing });
  }
  if (existing) {
    return Object.freeze({ decision: "wait_for_existing", registryIdentity, entry: existing });
  }
  const sourcePolicy = sourcePolicyIsAllowed(input.sealedChannelPolicy, plan.sourcePolicy);
  const exactBudgetReservation = input.budgetReservation.status === "held"
    && input.budgetReservation.plannedSpendCents === input.budgetReservation.reservedCents
    && input.budgetReservation.plannedSpendCents <= input.sealedChannelPolicy.perCharacterSpendCapCents;
  const capabilityBenchmark = input.capabilityBenchmark.status === "passed"
    && Boolean(input.capabilityBenchmark.proofReceiptFingerprint);
  const gates = {
    sealedChannelPolicy: input.sealedChannelPolicy.state === "sealed"
      && input.sealedChannelPolicy.characterLoRATrainingEnabled
      && input.sealedChannelPolicy.automaticAdmissionEnabled
      && plan.channelPolicyFingerprint === input.sealedChannelPolicy.policyFingerprint,
    sourcePolicy,
    datasetRights: manifest.rights.status === "verified" && manifest.rights.scope === "training_and_inference",
    datasetCoverage: manifest.coverage.status === "passed",
    exactBudgetReservation,
    capabilityBenchmark,
  };
  const blockers = [
    !gates.sealedChannelPolicy ? "sealed channel policy does not admit automatic character LoRA training" : "",
    !gates.sourcePolicy ? "the selected character-sheet source is not enabled by the sealed channel policy" : "",
    !gates.datasetRights ? "character-sheet dataset rights are not verified for training and inference" : "",
    !gates.datasetCoverage ? "character-sheet dataset coverage has not passed review" : "",
    !gates.exactBudgetReservation ? "character LoRA budget reservation is missing, inexact, or above the per-character cap" : "",
    !gates.capabilityBenchmark ? "target adapter capability benchmark is not passed with a proof receipt" : "",
  ].filter(Boolean);
  const autoEligible = blockers.length === 0;
  const content: z.infer<typeof CharacterLoRATrainingRequestContentSchema> = {
    version: CHARACTER_LORA_REGISTRY_VERSION,
    registryIdentity,
    accountId: plan.accountId,
    channelId: plan.channelId,
    characterId: plan.character.characterId,
    characterSpecFingerprint: plan.characterSpecFingerprint,
    datasetFingerprint: manifest.fingerprint,
    sheetPlanFingerprint: plan.fingerprint,
    channelPolicyFingerprint: input.sealedChannelPolicy.policyFingerprint,
    target: input.capabilityBenchmark,
    budgetReservation: input.budgetReservation,
    gates,
    status: autoEligible ? "admitted" : "blocked",
    autoEligible,
    blockers,
    providerInvocation: "not_started",
  };
  const request = Object.freeze(CharacterLoRATrainingRequestSchema.parse({
    ...content,
    fingerprint: characterLoRATrainingRequestFingerprintForContent(content),
  }));
  return Object.freeze({
    decision: autoEligible ? "training_admitted" : "training_blocked",
    registryIdentity,
    request,
  });
}

/**
 * Converts a later adapter's independently verified lifecycle result into a
 * durable reusable entry. This does not contact that adapter itself.
 */
export function acceptCharacterLoRARegistryEntry(value: {
  readonly admission: CharacterLoRATrainingAdmission;
  readonly acceptedAdapter: unknown;
  readonly now: number;
}): CharacterLoRARegistryEntry {
  if (value.admission.decision !== "training_admitted") {
    throw new Error("only an admitted, not-yet-dispatched character LoRA request may become accepted");
  }
  const acceptedAdapter = AcceptedCharacterLoRAAdapterSchema.parse(value.acceptedAdapter);
  const request = value.admission.request;
  if (acceptedAdapter.provider !== request.target.provider
    || acceptedAdapter.adapterFlavor !== request.target.adapterFlavor
    || acceptedAdapter.runtimeProfileFingerprint !== request.target.runtimeProfileFingerprint
    || acceptedAdapter.benchmarkProofReceiptFingerprint !== request.target.proofReceiptFingerprint) {
    throw new Error("accepted character LoRA adapter does not match its benchmarked admitted target");
  }
  const now = z.number().int().nonnegative().parse(value.now);
  return Object.freeze(CharacterLoRARegistryEntrySchema.parse({
    version: CHARACTER_LORA_REGISTRY_VERSION,
    registryIdentity: request.registryIdentity,
    accountId: request.accountId,
    channelId: request.channelId,
    characterId: request.characterId,
    characterSpecFingerprint: request.characterSpecFingerprint,
    datasetFingerprint: request.datasetFingerprint,
    trainingRequestFingerprint: request.fingerprint,
    status: "accepted",
    acceptedAdapter,
    createdAt: now,
    updatedAt: now,
  }));
}

/** Convenience resolver for a future renderer adapter; returns no render call. */
export function resolveAcceptedCharacterLoRA(value: {
  readonly sheetPlan: unknown;
  readonly datasetManifest: unknown;
  readonly registryEntries: readonly unknown[];
}): CharacterLoRARegistryEntry | undefined {
  const { plan, manifest } = assertCharacterSheetDatasetBinding({
    plan: value.sheetPlan,
    manifest: value.datasetManifest,
  });
  const registryIdentity = characterLoRARegistryIdentity({
    accountId: plan.accountId,
    channelId: plan.channelId,
    characterId: plan.character.characterId,
    characterSpecFingerprint: plan.characterSpecFingerprint,
    datasetFingerprint: manifest.fingerprint,
  });
  return z.array(CharacterLoRARegistryEntrySchema).parse(value.registryEntries)
    .find((entry) => entry.registryIdentity === registryIdentity && entry.status === "accepted");
}

/**
 * Structural type anchors. They make the intended existing handoffs visible to
 * callers without importing a renderer or weakening their schemas.
 */
export type NarrativeSeriesSourceContracts = Readonly<{
  programBrief: ChannelProgramBrief;
  serializedEpisodeContext: SerializedProgramEpisodeContext;
  episodeGraph: EpisodeGraph;
  storySpine: StorySpine;
}>;
