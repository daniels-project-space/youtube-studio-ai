import { z } from "zod";
import type { FamilyKey } from "./families";
import type { PipelineEntry } from "./types";
import type { VisualPacingPolicy } from "@/lib/visualPacing";

/**
 * A content lane is the durable visual-production contract for a channel.
 *
 * A channel may evolve its topics, hooks, crew briefs, and QA settings, but it
 * must not silently exchange its primary visual language.  Keeping this as
 * small, versioned data lets the contract travel with a pipeline invocation
 * without coupling it to the channel database or the module registry.
 */
export const CONTENT_LANE_VERSION = "content-lane/v1" as const;

export const ContentLaneKeySchema = z.enum([
  "narrated_documentary",
  "cinematic_ai",
  "music_loop",
  "ambient_guided",
  "short_form",
  "documentary_collage_short",
  "whiteboard_explainer",
  "motion_comic",
  "lore_micro_doc",
  "quiz_year",
  "illustrated_explainer",
  "children_learning_supervised",
  "legacy_unclassified",
]);

export type ContentLaneKey = z.infer<typeof ContentLaneKeySchema>;

/**
 * The direct-Novita Visual Matter reference pack is an optional cinematic
 * QA-input lane. It is deliberately not a general-purpose image feature: the
 * admitted renderer remains text-to-image and the resulting R2 pixels are not
 * primary-renderer conditioning inputs.
 */
export const VISUAL_MATTER_REFERENCE_CONTENT_LANE = "cinematic_ai" as const;
export const VISUAL_MATTER_REFERENCE_ARTIFACT = "visualMatterReferenceAssets" as const;
export const VISUAL_MATTER_REFERENCE_COMPOSITION = [
  "story_spine",
  "studio_asset_resolve",
  "visual_matter",
  "visual_matter_references",
  "novita_render_images",
  "qa_assets",
  "studio_ltx_adapter_resolve",
  "novita_render_video",
  "qa_shots",
] as const;

/**
 * This is intentionally shared with ModuleContracts rather than duplicated in
 * a renderer. The pack is useful only when a declared QA block consumes its
 * byte/receipt-bound assets; no primary renderer is a consumer.
 */
export const VISUAL_MATTER_REFERENCE_QA_CONSUMERS = {
  qa_assets: [VISUAL_MATTER_REFERENCE_ARTIFACT],
  qa_shots: [VISUAL_MATTER_REFERENCE_ARTIFACT],
} as const;

export interface ContentLaneDefinition {
  key: ContentLaneKey;
  /** The family that canonically owns this lane. Absent only for unknown legacy flows. */
  family?: FamilyKey;
  /** The visual producer a pipeline must retain to remain in this lane. */
  primaryRenderer: string;
  /** Required end-to-end visual chain blocks (not merely optional creative blocks). */
  requiredBlocks: readonly string[];
  /**
   * Complete interchangeable renderer chains for this lane. Every chain is
   * independently sufficient, but a pipeline must contain one of them in
   * full. This is deliberately a chain rather than an individual optional
   * block: it keeps an alternate Novita handoff from becoming a renderer
   * bypass.
   */
  requiredRendererChains?: readonly (readonly string[])[];
  /**
   * Additional production evidence required when an alternate renderer chain
   * is selected. This keeps a shared renderer from bypassing the module that
   * gives that route its visual/safety semantics.
   */
  rendererChainGuards?: readonly {
    whenPresent: readonly string[];
    requires: readonly string[];
  }[];
  /** Known renderers that would change this channel's visual language. */
  forbiddenRendererBlocks: readonly string[];
  /** Non-renderer blocks that would bypass a self-contained visual engine. */
  forbiddenBlocks?: readonly string[];
}

/**
 * Canonical lane policy.  The lists deliberately contain visual-producer and
 * assembly blocks only; crew, research, safety, metadata, and QA blocks remain
 * free to improve from episode to episode without changing the channel style.
 */
export const CONTENT_LANE_POLICIES: Record<ContentLaneKey, ContentLaneDefinition> = {
  narrated_documentary: {
    key: "narrated_documentary",
    family: "narrated_stock",
    primaryRenderer: "stock_footage",
    requiredBlocks: ["stock_footage", "timeline_assemble", "qa_visual"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  cinematic_ai: {
    key: "cinematic_ai",
    family: "cinematic",
    primaryRenderer: "novita_render_video",
    requiredBlocks: [
      "timeline_assemble",
      "qa_visual",
    ],
    // Standard cinematic channels use the direct image → I2V chain. A
    // source-admitted Casefile may instead use gen_footage, which is not
    // generic stock footage: it runs the same Novita Z-Image/LTX route with
    // mandatory keyframe, clip, and transition review against the approved
    // cinematic sequence. Requiring the whole chain prevents partial mixing.
    requiredRendererChains: [
      ["novita_render_images", "qa_assets", "novita_render_video", "qa_shots"],
      ["gen_footage"],
    ],
    rendererChainGuards: [{
      whenPresent: ["gen_footage"],
      requires: ["cinematic_case_sequence"],
    }],
    forbiddenRendererBlocks: [
      "stock_footage",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  music_loop: {
    key: "music_loop",
    family: "music_loop",
    primaryRenderer: "loop_clips",
    requiredBlocks: ["loop_clips", "assemble", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
    // Visual Matter is a story-visual module, not a decorative-loop feature.
    // Keeping it out of lo-fi prevents an irrelevant paid-reference option
    // from silently appearing in music-loop channels.
    forbiddenBlocks: ["visual_matter"],
  },
  ambient_guided: {
    key: "ambient_guided",
    family: "sleep",
    primaryRenderer: "stock_footage",
    requiredBlocks: ["stock_footage", "timeline_assemble", "qa_visual"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  short_form: {
    key: "short_form",
    family: "shorts",
    primaryRenderer: "stock_footage",
    requiredBlocks: ["stock_footage", "timeline_assemble", "qa_visual"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  documentary_collage_short: {
    key: "documentary_collage_short",
    family: "documentary_collage_short",
    primaryRenderer: "documotion_short",
    requiredBlocks: ["short_strategy", "documotion_short", "short_scene_qa", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
      "motion_comic",
    ],
    // This lane renders a portrait master directly. A legacy timeline/crop path
    // would silently discard the locked beat map and portrait-safe treatment.
    forbiddenBlocks: ["timeline_assemble", "assemble", "shorts_spinoff"],
  },
  whiteboard_explainer: {
    key: "whiteboard_explainer",
    family: "whiteboard",
    primaryRenderer: "whiteboard_scribe",
    requiredBlocks: ["whiteboard_scribe", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "motion_comic",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  motion_comic: {
    key: "motion_comic",
    family: "comic",
    primaryRenderer: "motion_comic",
    requiredBlocks: ["motion_comic", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "lore_short",
      "whiteboard_scribe",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  lore_micro_doc: {
    key: "lore_micro_doc",
    family: "loreshort",
    primaryRenderer: "lore_short",
    requiredBlocks: ["lore_short", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      // NOTE: the lore engine drives the Novita farm from INSIDE itself, so a
      // separate novita_render_* stage in the pipeline would be a second,
      // uncoordinated renderer — exactly the visual-language swap this contract
      // exists to prevent.
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  quiz_year: {
    key: "quiz_year",
    family: "quizyear",
    primaryRenderer: "quiz_year",
    requiredBlocks: ["quiz_year", "qa_visual"],
    // The quiz engine renders its own finished video from typography alone, so
    // ANY pixel-producing sibling would be a second, uncoordinated renderer.
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  illustrated_explainer: {
    key: "illustrated_explainer",
    family: "illustrated_explainer",
    primaryRenderer: "scene_compiler",
    requiredBlocks: ["story_spine", "episode_graph", "scene_compiler", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
      "documotion_short",
      "quiz_year",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  children_learning_supervised: {
    key: "children_learning_supervised",
    family: "children_learning",
    primaryRenderer: "scene_compiler",
    requiredBlocks: ["curriculum_episode_seed", "story_spine", "episode_graph", "learning_contract", "children_show_bible", "child_content_safety", "scene_compiler", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
      "documotion_short",
      "quiz_year",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  legacy_unclassified: {
    key: "legacy_unclassified",
    primaryRenderer: "unclassified",
    requiredBlocks: [],
    forbiddenRendererBlocks: [],
  },
};

/**
 * LANE-TUNED QUALITY CALIBRATION (P1-17).
 *
 * The lane contract above governs pipeline SHAPE. This second map governs how
 * hard the MODEL-GRADED quality loops push on a render from that lane — a lo-fi
 * loop and a narrated essay are not the same product and must not be judged by
 * one generic bar.
 *
 * Deliberately scoped:
 *   - Only MODEL-GRADED checks read this. Deterministic ffmpeg/file/probe rails
 *     (resolution, audio presence, structural integrity) stay lane-agnostic —
 *     a broken file is broken in every lane. The single exception is
 *     `blackSegmentMinSec` and `maxStaticHoldSec`, which are genuinely
 *     lane-dependent DETERMINISTIC facts (a night-time ambient loop can hold a
 *     frame far longer than a 45s Short), not taste judgements.
 *   - `visualPacing` is a separate final-master scene-marker receipt. It never
 *     calls a cut count universal quality: lanes with legitimate sustained
 *     visual evolution request a calibrated human confirmation when markers
 *     are sparse instead of being falsely failed by automation.
 *   - `legacy_unclassified` keeps the historic generic score/hold defaults and
 *     receives the same conservative pacing-calibration receipt as any unknown
 *     lane; it cannot claim automatic editorial readiness from missing context.
 */
export interface LaneQualityPolicy {
  /** Accept threshold (0..1) for produce→critique loops on this lane. */
  critiqueThreshold: number;
  /** Hard cap on produce→critique iterations (each iteration can cost money). */
  maxCritiqueIters: number;
  /** Minimum 1-10 score this lane demands from a holistic visual grader. */
  visualScoreFloor: number;
  /** Minimum 1-10 score this lane demands from the thumbnail grader. */
  thumbnailScoreFloor: number;
  /**
   * Minimum contiguous near-black duration that counts as dead air. Higher for
   * lanes whose visual language legitimately includes long dark holds.
   */
  blackSegmentMinSec: number;
  /**
   * Maximum contiguous near-identical programme hold permitted by deterministic
   * temporal QA. `null` is reserved for genuinely static visual products such
   * as an ambient sound bed; planned title/outro cards are excluded separately.
   */
  maxStaticHoldSec: number | null;
  /**
   * Final-master scene-marker calibration. This complements freeze detection:
   * a changing one-take can pass the latter while still needing a pacing review.
   */
  visualPacing: VisualPacingPolicy;
  /** Lane-specific things the critic must actively scrutinise (prompt input). */
  emphasis: readonly string[];
}

const GENERIC_LANE_QUALITY: LaneQualityPolicy = {
  critiqueThreshold: 0.8,
  maxCritiqueIters: 3,
  visualScoreFloor: 6,
  thumbnailScoreFloor: 5,
  blackSegmentMinSec: 2.5,
  maxStaticHoldSec: 4.5,
  visualPacing: {
    mode: "calibrated_review",
    sceneThreshold: 0.12,
    maxMarkerHoldSec: 10,
    rationale: "Scene markers corroborate editorial movement, but a valid continuous take must be confirmed by the scene-aware reviewer rather than failed by cut count.",
  },
  emphasis: [],
};

export const LANE_QUALITY_POLICIES: Record<ContentLaneKey, LaneQualityPolicy> = {
  narrated_documentary: {
    ...GENERIC_LANE_QUALITY,
    // Documentary maps, archive moves, and carefully held evidence cards can
    // evolve without a hard cut. Ten seconds is a conservative review trigger,
    // not a claim that every narration-led story must cut on a timer.
    visualPacing: {
      ...GENERIC_LANE_QUALITY.visualPacing,
      mode: "calibrated_review",
      maxMarkerHoldSec: 10,
      rationale: "Narrated factual beats should visibly progress, while slow evidence maps and continuous archive moves remain legitimate human-review cases.",
    },
    emphasis: [
      "Every visual must be earned by the sentence being narrated over it; decorative b-roll that ignores the claim is a defect.",
    ],
  },
  cinematic_ai: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.82,
    // A generated shot can be a deliberately sustained camera move. Sparse
    // cut markers therefore request calibrated visual review rather than
    // falsely condemning deliberate cinematography.
    visualPacing: {
      ...GENERIC_LANE_QUALITY.visualPacing,
      mode: "calibrated_review",
      maxMarkerHoldSec: 12,
      rationale: "Cinematic AI may sustain an evolving camera move; a marker-free hold beyond twelve seconds needs scene-aware review, not an automatic cut-count verdict.",
    },
    emphasis: [
      "Generated shots must hold ONE consistent world: subject identity, wardrobe, lighting key and grade may not drift between shots.",
      "Anatomy, hands, text-like artefacts and morphing edges are the known failure modes of generated video — inspect for them explicitly.",
    ],
  },
  music_loop: {
    ...GENERIC_LANE_QUALITY,
    // Music-first: the audio is the product and the visual is a decorative bed.
    // A lower visual bar is honest here; a lower iteration cap keeps a
    // decorative loop from out-spending the track it exists to carry.
    critiqueThreshold: 0.75,
    maxCritiqueIters: 2,
    visualScoreFloor: 5,
    blackSegmentMinSec: 6,
    maxStaticHoldSec: null,
    visualPacing: {
      mode: "exempt",
      sceneThreshold: 0.12,
      maxMarkerHoldSec: null,
      rationale: "Music-loop visuals are a decorative bed; loop continuity and audio quality are the meaningful release evidence, not scene cadence.",
    },
    emphasis: [
      "The loop seam must be invisible: no jump, flash, or frozen hold where the clip wraps.",
      "Slow, uneventful, low-contrast night imagery is the INTENT of this lane, not a defect.",
    ],
  },
  ambient_guided: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.75,
    maxCritiqueIters: 2,
    visualScoreFloor: 5,
    blackSegmentMinSec: 6,
    maxStaticHoldSec: null,
    visualPacing: {
      mode: "exempt",
      sceneThreshold: 0.12,
      maxMarkerHoldSec: null,
      rationale: "Guided ambient visual beds can intentionally stay slow or near-static, so scene-marker cadence is not a valid quality claim.",
    },
    emphasis: [
      "Deliberately slow pacing and long, near-static holds are the intent of this lane, not a defect.",
    ],
  },
  short_form: {
    ...GENERIC_LANE_QUALITY,
    // Highest attention-per-second surface, shortest runtime: a defect costs a
    // proportionally larger share of the video, and a regenerate is cheap.
    critiqueThreshold: 0.85,
    visualScoreFloor: 7,
    thumbnailScoreFloor: 6,
    blackSegmentMinSec: 1.2,
    maxStaticHoldSec: 1.5,
    // A short needs a readable rhythm signal. A one-take may still be good,
    // however, so missing markers deliberately become `needs_human`, never a
    // simplistic automatic "bad video" result.
    visualPacing: {
      ...GENERIC_LANE_QUALITY.visualPacing,
      mode: "scene_rhythm",
      maxMarkerHoldSec: 5.5,
      rationale: "A viewer-facing Short should demonstrate a strong visual change within roughly six seconds; an intentional continuous take is routed to review rather than rejected by cut count.",
    },
    emphasis: [
      "Judge at phone size: anything unreadable on a 6-inch screen is unreadable.",
      "Every element must sit inside the vertical safe areas, clear of the UI chrome.",
    ],
  },
  documentary_collage_short: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.85,
    visualScoreFloor: 7,
    thumbnailScoreFloor: 6,
    blackSegmentMinSec: 1.2,
    maxStaticHoldSec: 1.5,
    visualPacing: {
      ...GENERIC_LANE_QUALITY.visualPacing,
      mode: "scene_rhythm",
      maxMarkerHoldSec: 5.5,
      rationale: "Documentary collage Shorts need visible beat-to-beat rhythm, while a deliberate continuous source clip remains a reviewer-confirmed exception.",
    },
    emphasis: [
      "Judge at phone size; source/evidence cards must stay legible and inside the vertical safe areas.",
    ],
  },
  whiteboard_explainer: {
    ...GENERIC_LANE_QUALITY,
    emphasis: [
      "The drawing must stay in lockstep with the narration: a label that appears before or after the words that explain it is a defect.",
      "Treat a generic isolated icon, a mostly empty board, or a long hold before the board has accumulated its hero scene plus supporting evidence sketches as a visual-style defect. The finished board must feel information-dense, not rationalized down to a diagram placeholder.",
    ],
  },
  motion_comic: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.82,
    emphasis: [
      "Bubbles and captions must sit inside their panel and never cover a face or hero artwork.",
    ],
  },
  lore_micro_doc: {
    ...GENERIC_LANE_QUALITY,
    // Every beat is a paid still AND a paid clip, so an extra critique iteration
    // is far cheaper than an extra render pass — but the cap stays at 2 because
    // the loop sits on the beat sheet, which is where a defect is still free.
    critiqueThreshold: 0.82,
    maxCritiqueIters: 2,
    // Long, dark, near-static painterly holds are the LOOK of this lane.
    blackSegmentMinSec: 5,
    // Calm painterly beats are intentional, but a whole factual beat frozen
    // beyond this is almost certainly a dropped motion layer.
    maxStaticHoldSec: 12,
    emphasis: [
      "The camera must travel through real depth — foreground, midground and background sliding at different rates. A flat pan or zoom on a single plane is the defining defect of this lane.",
      "Painted concept-art stillness is the intent: a calm beat that only breathes is correct, and forced motion on a still subject (warping, melting, drifting statues) is the defect.",
      "The narration is one first-person voice throughout; a slip into neutral documentary register breaks the format.",
    ],
  },
  quiz_year: {
    ...GENERIC_LANE_QUALITY,
    // The critique loop here grades WORDING only and runs at text prices, so an
    // extra iteration is nearly free — but it can never touch an answer, which
    // is why the bar sits at the generic level rather than higher.
    critiqueThreshold: 0.8,
    maxCritiqueIters: 2,
    // Question cards need a readable thinking window; title/outro cards are
    // excluded independently, so this only covers programme content.
    maxStaticHoldSec: 8,
    emphasis: [
      "The question must never contain its own answer, in any form — a year, a city, a currency, a symbol. That either spoils the round or contradicts the cited source.",
      "Every question must be readable at a glance; the viewer has seconds, not paragraphs.",
      "All four options must look equally plausible, so the answer cannot be found by elimination: period-plausible years, same-region capitals, real currencies, real chemical symbols.",
      "The video mixes categories on purpose. Each question must stand alone and read clearly without the one before it.",
    ],
  },
  illustrated_explainer: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.84,
    visualScoreFloor: 7,
    maxStaticHoldSec: 4,
    emphasis: [
      "Every scene must make a causal claim, state transition, or learning step visible; decorative motion is a defect.",
      "Maps, charts, diagrams, labels, and captions must be readable at normal viewing size and change only when the narrated idea changes.",
      "The same character and setting IDs must retain their visual identity throughout the episode.",
    ],
  },
  children_learning_supervised: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.86,
    visualScoreFloor: 7,
    thumbnailScoreFloor: 6,
    // Calm does not mean stalled: an educational story still needs visible
    // progression after its planned title card.
    maxStaticHoldSec: 4,
    // Children’s content must progress without the rapid attention bait of a
    // generic Short. The receipt uses a calm eight-second review threshold and
    // leaves a continuously animated learning scene for human confirmation.
    visualPacing: {
      ...GENERIC_LANE_QUALITY.visualPacing,
      mode: "calibrated_review",
      maxMarkerHoldSec: 8,
      rationale: "Children’s learning scenes need calm visible progression; a long marker-free but continuously animated lesson requires review, not rapid-cut enforcement.",
    },
    emphasis: [
      "One clear age-appropriate learning or life-skill objective must be resolved in a coherent beginning, middle, and safe prosocial ending.",
      "Dialogue, labels, and transitions must be calm, intelligible, and understandable without rapid attention bait or unexplained visual changes.",
      "Only original, stable characters and settings may appear; resemblance to recognizable children’s properties is a release defect.",
    ],
  },
  legacy_unclassified: { ...GENERIC_LANE_QUALITY },
};

/**
 * Resolve the quality calibration for a lane. Accepts a parsed lane, a raw
 * persisted lane, a bare lane key, or nothing — an unresolvable input falls
 * back to the historic generic bar rather than inventing a stricter one.
 */
export function laneQualityPolicy(lane: ContentLane | ContentLaneKey | unknown): LaneQualityPolicy {
  if (typeof lane === "string") {
    return LANE_QUALITY_POLICIES[lane as ContentLaneKey] ?? GENERIC_LANE_QUALITY;
  }
  const parsed = ContentLaneSchema.safeParse(lane);
  return parsed.success ? LANE_QUALITY_POLICIES[parsed.data.key] : GENERIC_LANE_QUALITY;
}

export const CONTENT_LANE_BY_FAMILY: Record<FamilyKey, ContentLaneKey> = {
  narrated_stock: "narrated_documentary",
  cinematic: "cinematic_ai",
  music_loop: "music_loop",
  sleep: "ambient_guided",
  shorts: "short_form",
  documentary_collage_short: "documentary_collage_short",
  whiteboard: "whiteboard_explainer",
  comic: "motion_comic",
  loreshort: "lore_micro_doc",
  quizyear: "quiz_year",
  illustrated_explainer: "illustrated_explainer",
  children_learning: "children_learning_supervised",
};

export const ContentLaneSchema = z.object({
  version: z.literal(CONTENT_LANE_VERSION),
  key: ContentLaneKeySchema,
  /** Preserved on legacy lanes too, so a later migration has useful provenance. */
  family: z.string().min(1).optional(),
  primaryRenderer: z.string().min(1),
}).strict().superRefine((lane, ctx) => {
  const definition = CONTENT_LANE_POLICIES[lane.key];
  if (lane.primaryRenderer !== definition.primaryRenderer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryRenderer"],
      message: `content lane ${lane.key} must use ${definition.primaryRenderer}`,
    });
  }
  if (definition.family && lane.family !== definition.family) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["family"],
      message: `content lane ${lane.key} must be owned by family ${definition.family}`,
    });
  }
});

export type ContentLane = z.infer<typeof ContentLaneSchema>;

export interface ResolveContentLaneInput {
  /** Preferred persisted field name. */
  contentLane?: unknown;
  /** Alias for storage adapters that call the persisted value `stored`. */
  stored?: unknown;
  /** Alias for callers that already extracted the lane. */
  lane?: unknown;
  family?: unknown;
  pipeline?: readonly PipelineEntry[] | null;
}

function knownFamilyKey(value: unknown): FamilyKey | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CONTENT_LANE_BY_FAMILY, value)
    ? value as FamilyKey
    : undefined;
}

function createContentLane(key: ContentLaneKey, legacyFamily?: string): ContentLane {
  const definition = CONTENT_LANE_POLICIES[key];
  return ContentLaneSchema.parse({
    version: CONTENT_LANE_VERSION,
    key,
    ...(definition.family ? { family: definition.family } : legacyFamily ? { family: legacyFamily } : {}),
    primaryRenderer: definition.primaryRenderer,
  });
}

/** Return a canonical locked lane for a known family, if there is one. */
export function contentLaneForFamily(family: unknown): ContentLane | undefined {
  const known = knownFamilyKey(family);
  return known ? createContentLane(CONTENT_LANE_BY_FAMILY[known]) : undefined;
}

/**
 * Infer a lane only when the legacy pipeline has one unambiguous known visual
 * producer. Mixed or unknown producer chains intentionally remain unclassified
 * rather than receiving a misleading style lock.
 */
export function inferContentLane(
  pipeline: readonly PipelineEntry[] | null | undefined,
  legacyFamily?: unknown,
): ContentLane {
  const blocks = new Set(
    (pipeline ?? [])
      .map((entry) => entry?.block)
      .filter((block): block is string => typeof block === "string"),
  );
  const inferred = new Set<ContentLaneKey>();
  if (blocks.has("whiteboard_scribe")) inferred.add("whiteboard_explainer");
  if (blocks.has("motion_comic")) inferred.add("motion_comic");
  if (blocks.has("documotion_short")) inferred.add("documentary_collage_short");
  if (blocks.has("loop_clips")) inferred.add("music_loop");
  if (blocks.has("novita_render_images") || blocks.has("novita_render_video")) inferred.add("cinematic_ai");
  if (blocks.has("stock_footage")) inferred.add("narrated_documentary");

  return inferred.size === 1
    ? createContentLane([...inferred][0])
    : createContentLane("legacy_unclassified", typeof legacyFamily === "string" ? legacyFamily : undefined);
}

/** Derive a canonical lane from a family first, then safely infer one for legacy rows. */
export function deriveContentLane(
  family: unknown,
  pipeline?: readonly PipelineEntry[] | null,
): ContentLane {
  return contentLaneForFamily(family) ?? inferContentLane(pipeline, family);
}

/** Parse an externally supplied persisted lane with an actionable error. */
export function parseContentLane(value: unknown): ContentLane {
  const parsed = ContentLaneSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Invalid content lane: ${detail}`);
}

/**
 * Resolve the durable lane for a channel. A real lane can never be changed by
 * changing the family field; legacy-unclassified rows are the one migration-safe
 * exception and become canonical once their family is known.
 */
export function resolveContentLane(input: ResolveContentLaneInput): ContentLane {
  const stored = input.contentLane ?? input.stored ?? input.lane;
  const requested = contentLaneForFamily(input.family);
  if (stored !== undefined && stored !== null) {
    const parsed = parseContentLane(stored);
    if (parsed.key === "legacy_unclassified" && requested) return requested;
    if (requested && parsed.key !== requested.key) {
      throw new Error(
        `Content lane is immutable: ${parsed.key} cannot be changed to ${requested.key} by changing family`,
      );
    }
    return parsed;
  }
  return requested ?? inferContentLane(input.pipeline, input.family);
}

/** Ensure a requested family does not attempt to relabel an already locked channel. */
export function assertContentLaneMatchesFamily(lane: ContentLane | unknown, family: unknown): void {
  const requested = contentLaneForFamily(family);
  if (!requested) return;
  const parsed = parseContentLane(lane);
  if (parsed.key !== requested.key) {
    throw new Error(
      `Content lane is immutable: ${parsed.key} cannot be changed to ${requested.key} by changing family`,
    );
  }
}

/** Whether a known visual producer is present; useful to architect/upgrade callers. */
export function isContentLaneRendererBlock(block: string): boolean {
  return Object.values(CONTENT_LANE_POLICIES)
    .some((definition) => definition.primaryRenderer === block || definition.forbiddenRendererBlocks.includes(block));
}

/**
 * Guard a concrete pipeline against the channel's style contract. This checks
 * only production-path renderers and self-contained assembly bypasses, so adding
 * a director brief, a critic, captions, or additional QA cannot invalidate it.
 */
export function assertPipelineMatchesContentLane(
  lane: ContentLane | unknown,
  pipeline: readonly PipelineEntry[] | null | undefined,
): void {
  const parsed = parseContentLane(lane);
  if (!Array.isArray(pipeline)) throw new Error(`Content lane ${parsed.key} requires a pipeline array`);

  const orderedBlocks = pipeline
    .map((entry) => entry?.block)
    .filter((block): block is string => typeof block === "string");
  const visualMatterBlocks = orderedBlocks.filter(
    (block) =>
      block === "visual_matter" ||
      block === "visual_matter_references" ||
      block === "studio_ltx_adapter_resolve",
  );
  // Do this before the legacy escape hatch. A legacy snapshot may retain its
  // established renderer, but it must never use an unadmitted paid Visual
  // Matter reference pack (or a Visual Matter plan) in a non-cinematic lane.
  if (parsed.key !== VISUAL_MATTER_REFERENCE_CONTENT_LANE && visualMatterBlocks.length) {
    throw new Error(
      `Pipeline violates content lane ${parsed.key}: ` +
      `forbids ${[...new Set(visualMatterBlocks)].join(", ")}; ` +
      `Visual Matter is cinematic_ai-only`,
    );
  }
  if (parsed.key === "legacy_unclassified") return;

  const definition = CONTENT_LANE_POLICIES[parsed.key];
  const blocks = new Set(orderedBlocks);
  const missing = definition.requiredBlocks.filter((block) => !blocks.has(block));
  const rendererChains = definition.requiredRendererChains ?? [];
  const rendererChainIsOrdered = (chain: readonly string[]): boolean => chain.every((block, index) =>
    index === 0 || orderedBlocks.indexOf(chain[index - 1]) < orderedBlocks.indexOf(block),
  );
  const presentRendererChains = rendererChains.filter((chain) => chain.every((block) => blocks.has(block)));
  const unorderedRendererChains = presentRendererChains.filter((chain) => !rendererChainIsOrdered(chain));
  const completeRendererChains = presentRendererChains.filter(rendererChainIsOrdered);
  const hasRequiredRendererChain = rendererChains.length === 0 || completeRendererChains.length > 0;
  // A lane is a visual-language boundary, not merely a list of allowed
  // modules. Each renderer chain declares a complete alternative final-pixel
  // path: the direct cinematic chain is owned by novita_render_video, whereas
  // the reviewed Casefile handoff is owned by gen_footage. A custom/imported
  // pipeline must select exactly one path and include its owner only once.
  // Count from the ordered graph rather than the set above so duplication
  // cannot hide behind membership checks.
  const rendererOwnershipIssue = (() => {
    if (rendererChains.length === 0) {
      const count = orderedBlocks.filter((block) => block === definition.primaryRenderer).length;
      return count === 1
        ? undefined
        : `requires exactly one primary renderer ${definition.primaryRenderer} (found ${count})`;
    }
    if (completeRendererChains.length > 1) {
      return `requires exactly one complete renderer chain (found ${completeRendererChains.length})`;
    }
    if (completeRendererChains.length !== 1) return undefined;
    const chain = completeRendererChains[0];
    const owner = [...chain].reverse().find((block) => isContentLaneRendererBlock(block)) ?? chain[chain.length - 1];
    const count = orderedBlocks.filter((block) => block === owner).length;
    return count === 1
      ? undefined
      : `requires exactly one renderer owner ${owner} (found ${count})`;
  })();
  const selectedRendererOwner = (() => {
    if (rendererChains.length === 0) return definition.primaryRenderer;
    if (completeRendererChains.length !== 1) return undefined;
    const chain = completeRendererChains[0];
    return [...chain].reverse().find((block) => isContentLaneRendererBlock(block))
      ?? chain[chain.length - 1];
  })();
  const finalQaIndices = orderedBlocks
    .map((block, index) => block === "qa_visual" ? index : -1)
    .filter((index) => index >= 0);
  const finalReviewOrderIssue = (() => {
    if (finalQaIndices.length !== 1) {
      return `requires exactly one final qa_visual stage (found ${finalQaIndices.length})`;
    }
    if (!selectedRendererOwner) return undefined;
    const rendererIndex = orderedBlocks.indexOf(selectedRendererOwner);
    return rendererIndex >= finalQaIndices[0]
      ? `requires renderer owner ${selectedRendererOwner} before final qa_visual`
      : undefined;
  })();
  const missingRendererChainGuards = (definition.rendererChainGuards ?? [])
    .filter((guard) => guard.whenPresent.every((block) => blocks.has(block)))
    .filter((guard) => !guard.requires.every((block) => blocks.has(block)));
  const forbidden = [...definition.forbiddenRendererBlocks, ...(definition.forbiddenBlocks ?? [])]
    .filter((block) => blocks.has(block));
  if (
    rendererOwnershipIssue !== undefined
    || missing.length
    || !hasRequiredRendererChain
    || unorderedRendererChains.length
    || finalReviewOrderIssue !== undefined
    || missingRendererChainGuards.length
    || forbidden.length
  ) {
    const issues = [
      ...(rendererOwnershipIssue ? [rendererOwnershipIssue] : []),
      ...(missing.length ? [`requires ${missing.join(", ")}`] : []),
      ...(!hasRequiredRendererChain
        ? [`requires one renderer chain: ${rendererChains
            .map((chain) => chain.join(" + "))
            .join(" OR ")}`]
        : []),
      ...unorderedRendererChains.map((chain) =>
        `requires renderer chain order ${chain.join(" < ")}`,
      ),
      ...(finalReviewOrderIssue ? [finalReviewOrderIssue] : []),
      ...missingRendererChainGuards.map((guard) =>
        `${guard.whenPresent.join(" + ")} requires ${guard.requires.join(" + ")}`,
      ),
      ...(forbidden.length ? [`forbids ${forbidden.join(", ")}`] : []),
    ];
    throw new Error(`Pipeline violates content lane ${parsed.key}: ${issues.join("; ")}`);
  }
  assertVisualMatterReferenceComposition(parsed, orderedBlocks);
  if (parsed.key === VISUAL_MATTER_REFERENCE_CONTENT_LANE) {
    assertCinematicStudioTreatmentBindings(pipeline);
  }
  // The children curriculum seed is an actual planning boundary, not a badge
  // that can be appended after a generated story. Preserve its order here so a
  // persisted or one-off pipeline cannot place the review after Story Spine.
  if (parsed.key === "children_learning_supervised") {
    const positions = new Map<string, number>();
    pipeline.forEach((entry, index) => {
      if (typeof entry?.block === "string" && !positions.has(entry.block)) positions.set(entry.block, index);
    });
    const prerequisiteOrder = ["curriculum_episode_seed", "story_spine", "episode_graph", "learning_contract", "children_show_bible", "child_content_safety"];
    const outOfOrder = prerequisiteOrder.some((block, index) =>
      index > 0 && (positions.get(prerequisiteOrder[index - 1]) ?? -1) >= (positions.get(block) ?? Number.MAX_SAFE_INTEGER),
    );
    if (outOfOrder) {
      throw new Error(
        "Pipeline violates content lane children_learning_supervised: curriculum_episode_seed must precede Story Spine, Episode Graph, Show Bible, and child safety review",
      );
    }
  }
}

/**
 * Fail closed around the one paid Visual Matter extension. Membership checks
 * alone cannot prove that the pack was planned from the story spine or that
 * QA receives it before either render phase, so preserve an exact, single-pack
 * linear composition whenever the optional pack is present.
 */
export function assertVisualMatterReferenceComposition(
  lane: ContentLane | unknown,
  orderedBlocks: readonly string[],
): void {
  const parsed = parseContentLane(lane);
  const packCount = orderedBlocks.filter((block) => block === "visual_matter_references").length;
  if (packCount === 0) return;
  if (parsed.key !== VISUAL_MATTER_REFERENCE_CONTENT_LANE) {
    throw new Error(
      `Visual Matter reference pack requires contentLane ${VISUAL_MATTER_REFERENCE_CONTENT_LANE}`,
    );
  }
  if (packCount !== 1) {
    throw new Error("Visual Matter reference composition requires exactly one visual_matter_references pack");
  }

  const positions = new Map<string, number>();
  const duplicates: string[] = [];
  for (const block of VISUAL_MATTER_REFERENCE_COMPOSITION) {
    const matches = orderedBlocks
      .map((candidate, index) => candidate === block ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1) {
      duplicates.push(`${block} (${matches.length === 0 ? "missing" : `${matches.length} occurrences`})`);
      continue;
    }
    positions.set(block, matches[0]!);
  }
  if (duplicates.length) {
    throw new Error(
      `Visual Matter reference composition requires exactly one of each ordered block: ${duplicates.join(", ")}`,
    );
  }

  const declaredQaConsumers = Object.keys(VISUAL_MATTER_REFERENCE_QA_CONSUMERS)
    .filter((block) => orderedBlocks.includes(block));
  if (!declaredQaConsumers.length) {
    throw new Error("Visual Matter reference composition requires a declared QA consumer");
  }

  const outOfOrder = VISUAL_MATTER_REFERENCE_COMPOSITION.some((block, index) =>
    index > 0 && (positions.get(VISUAL_MATTER_REFERENCE_COMPOSITION[index - 1]!) ?? -1) >=
      (positions.get(block) ?? Number.MAX_SAFE_INTEGER),
  );
  if (outOfOrder) {
    throw new Error(
      "Visual Matter reference composition requires " +
      VISUAL_MATTER_REFERENCE_COMPOSITION.join(" < "),
    );
  }
}

function optionalPipelineTreatment(entry: PipelineEntry, parameter: string): string | undefined {
  const value = entry.params?.[parameter];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Pipeline ${entry.block} treatment parameter ${parameter} must be a non-empty string when present`);
  }
  return value.trim();
}

/**
 * Visual Matter, recipe resolution, and direct-LTX adapter resolution must
 * share one sealed treatment key. This prevents an imported composition from
 * planning clay/brick/anime/drawn locks while looking up a LoRA benchmarked
 * for another treatment. The check is intentionally scoped to pipelines that
 * actually contain a Visual Matter plan; historical direct-LTX routes without
 * that planner remain readable.
 */
function assertCinematicStudioTreatmentBindings(pipeline: readonly PipelineEntry[]): void {
  const visualMatter = pipeline.find((entry) => entry.block === "visual_matter");
  if (!visualMatter) return;
  const treatment = optionalPipelineTreatment(visualMatter, "visualTreatment");
  for (const entry of pipeline) {
    if (entry.block !== "studio_asset_resolve" && entry.block !== "studio_ltx_adapter_resolve") continue;
    const resolvedTreatment = optionalPipelineTreatment(entry, "treatment");
    if (resolvedTreatment !== treatment) {
      throw new Error(
        `Pipeline ${entry.block} treatment must match visual_matter visualTreatment exactly`,
      );
    }
  }
}

/**
 * A tiny static cross-check used by certification. ModuleContracts consumes
 * these exact declarations, so this guards future catalog edits from turning
 * the QA-only pack into an orphaned paid renderer feature.
 */
export function assertVisualMatterReferenceAdmissionCatalog(): void {
  if (CONTENT_LANE_POLICIES[VISUAL_MATTER_REFERENCE_CONTENT_LANE].family !== "cinematic") {
    throw new Error("Visual Matter reference pack must remain owned by the cinematic content lane");
  }
  const consumers = Object.entries(VISUAL_MATTER_REFERENCE_QA_CONSUMERS);
  if (
    consumers.length !== 2 ||
    consumers.some(([, inputs]) =>
      inputs.length !== 1 || inputs[0] !== VISUAL_MATTER_REFERENCE_ARTIFACT,
    )
  ) {
    throw new Error("Visual Matter reference pack must retain exactly the declared QA consumers");
  }
}

/**
 * A compact deterministic fingerprint suitable for invocation snapshots and QA
 * evidence. FNV-1a avoids a Node-only crypto dependency, so this stays usable
 * from Convex handlers and Trigger workers alike.
 */
export function contentLaneFingerprint(lane: ContentLane | unknown): string {
  const parsed = parseContentLane(lane);
  const source = [parsed.version, parsed.key, parsed.family ?? "", parsed.primaryRenderer].join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `cl_${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Freeze the lane into the QA stage's runtime parameters. The original pipeline
 * is never mutated, which is important when an architecture proposal is compared
 * with the persisted pipeline before it is accepted.
 */
export function injectContentLaneIntoPipeline(
  pipeline: readonly PipelineEntry[],
  lane: ContentLane | unknown,
): PipelineEntry[] {
  const parsed = parseContentLane(lane);
  assertPipelineMatchesContentLane(parsed, pipeline);
  const fingerprint = contentLaneFingerprint(parsed);
  return pipeline.map((entry) => {
    if (entry.block !== "qa_visual") return entry;
    return {
      ...entry,
      params: {
        ...(entry.params ?? {}),
        // Every final master has an audience-facing audio experience: spoken
        // narration, score, ambience, or quiz/game sound. Make the existing
        // aesthetics evaluator mandatory at the runtime boundary even for old
        // persisted pipelines, so a release never relies on loudness alone.
        // Legacy/unclassified lanes remain untouched because they have no
        // approved editorial grammar and already fail closed at upload.
        ...(parsed.key !== "legacy_unclassified" && entry.params?.["audioQa"] !== true
          ? { audioQa: true }
          : {}),
        contentLane: { ...parsed },
        contentLaneFingerprint: fingerprint,
      },
    };
  });
}

/** Backward-friendly name for runtime callers. */
export const withContentLaneParams = injectContentLaneIntoPipeline;
