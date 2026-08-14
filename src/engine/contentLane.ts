import { z } from "zod";
import type { FamilyKey } from "./families";
import type { PipelineEntry } from "./types";

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
  "data_chart",
  "sim_story",
  "legacy_unclassified",
]);

export type ContentLaneKey = z.infer<typeof ContentLaneKeySchema>;

export interface ContentLaneDefinition {
  key: ContentLaneKey;
  /** The family that canonically owns this lane. Absent only for unknown legacy flows. */
  family?: FamilyKey;
  /** The visual producer a pipeline must retain to remain in this lane. */
  primaryRenderer: string;
  /** Required end-to-end visual chain blocks (not merely optional creative blocks). */
  requiredBlocks: readonly string[];
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
      "novita_render_images",
      "qa_assets",
      "novita_render_video",
      "qa_shots",
      "timeline_assemble",
      "qa_visual",
    ],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
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
  data_chart: {
    key: "data_chart",
    family: "datachart",
    primaryRenderer: "chart_render",
    // The DATA block is part of the required chain, not an optional garnish: a
    // ranking video whose figures were not sourced is a different (and
    // dishonest) product, so removing rank_data leaves the lane.
    requiredBlocks: ["rank_data", "chart_render", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
      "quiz_year",
    ],
    // chart_render emits the finished master, so an assembler would be a second
    // producer of the same artifact. `story_spine` is forbidden for a different
    // reason: it plans SHOTS for a generated-visual renderer, and this lane has
    // no shots — its output would cost an LLM call per run and be read by
    // nothing. The designer honours this list instead of auto-inserting.
    // `visual_inserts` is forbidden for a third reason: it is a data-viz overlay
    // layer whose output is composited by timeline_assemble, which this lane
    // does not have — and the video is already a data visualisation.
    forbiddenBlocks: ["timeline_assemble", "assemble", "story_spine", "visual_inserts"],
  },
  sim_story: {
    key: "sim_story",
    family: "simstory",
    primaryRenderer: "chart_render",
    // `sim_narrative` is required for the same reason `rank_data` is above, with
    // an extra edge: it is the module that applies the mandatory speculative
    // disclosure. Dropping it would strip the honesty framing from the format.
    requiredBlocks: ["sim_narrative", "chart_render", "qa_visual"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
      "lore_short",
      "quiz_year",
    ],
    // Also forbids `rank_data`: mixing a real cited dataset into a declared
    // illustrative scenario is exactly the confusion this format must not create.
    forbiddenBlocks: ["timeline_assemble", "assemble", "story_spine", "visual_inserts", "rank_data"],
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
 *     `blackSegmentMinSec`, which is a genuinely lane-dependent DETERMINISTIC
 *     fact (a night-time ambient loop legitimately holds near-black far longer
 *     than a 45s Short does), not a taste judgement.
 *   - `legacy_unclassified` reproduces the historic generic defaults EXACTLY,
 *     so an unclassified channel sees zero behaviour change from this map.
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
  /** Lane-specific things the critic must actively scrutinise (prompt input). */
  emphasis: readonly string[];
}

const GENERIC_LANE_QUALITY: LaneQualityPolicy = {
  critiqueThreshold: 0.8,
  maxCritiqueIters: 3,
  visualScoreFloor: 6,
  thumbnailScoreFloor: 5,
  blackSegmentMinSec: 2.5,
  emphasis: [],
};

export const LANE_QUALITY_POLICIES: Record<ContentLaneKey, LaneQualityPolicy> = {
  narrated_documentary: {
    ...GENERIC_LANE_QUALITY,
    emphasis: [
      "Every visual must be earned by the sentence being narrated over it; decorative b-roll that ignores the claim is a defect.",
    ],
  },
  cinematic_ai: {
    ...GENERIC_LANE_QUALITY,
    critiqueThreshold: 0.82,
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
    emphasis: [
      "Judge at phone size; source/evidence cards must stay legible and inside the vertical safe areas.",
    ],
  },
  whiteboard_explainer: {
    ...GENERIC_LANE_QUALITY,
    emphasis: [
      "The drawing must stay in lockstep with the narration: a label that appears before or after the words that explain it is a defect.",
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
    emphasis: [
      "The question must never contain its own answer, in any form — a year, a city, a currency, a symbol. That either spoils the round or contradicts the cited source.",
      "Every question must be readable at a glance; the viewer has seconds, not paragraphs.",
      "All four options must look equally plausible, so the answer cannot be found by elimination: period-plausible years, same-region capitals, real currencies, real chemical symbols.",
      "The video mixes categories on purpose. Each question must stand alone and read clearly without the one before it.",
    ],
  },
  data_chart: {
    ...GENERIC_LANE_QUALITY,
    // The critique surface here is READABILITY and NUMBER FIDELITY, both of
    // which are graded on text at text prices, so iterations are near-free.
    // The bar stays generic because a chart cannot be "beautiful enough" to
    // rescue a wrong figure, and cannot be ugly enough to make a right one fail.
    maxCritiqueIters: 2,
    // Solid backgrounds with typography — a long dark hold is never correct.
    blackSegmentMinSec: 1.5,
    emphasis: [
      "Every number spoken in the narration must be the SAME number shown on the bar. A figure the chart does not display is a defect, and so is a bar the narration never mentions.",
      "Labels and values must be readable at a glance and at phone size; an overflowing label is a defect, not a style choice.",
      "The ranking order on screen must match the order the narration counts down.",
    ],
  },
  sim_story: {
    ...GENERIC_LANE_QUALITY,
    maxCritiqueIters: 2,
    blackSegmentMinSec: 1.5,
    emphasis: [
      "The illustrative disclosure must be legible on screen for the whole video. If it is missing, cropped or unreadable, that is a hard failure, not a style note.",
      "The curve must move WHEN the narration says it moves — a spike the voice never mentions, or a dramatic sentence over a flat line, breaks the format.",
      "The narration must never present the run as a real experiment, a real dataset or a cited study.",
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
  datachart: "data_chart",
  simstory: "sim_story",
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
  if (parsed.key === "legacy_unclassified") return;
  if (!Array.isArray(pipeline)) throw new Error(`Content lane ${parsed.key} requires a pipeline array`);

  const definition = CONTENT_LANE_POLICIES[parsed.key];
  const blocks = new Set(
    pipeline
      .map((entry) => entry?.block)
      .filter((block): block is string => typeof block === "string"),
  );
  const missing = definition.requiredBlocks.filter((block) => !blocks.has(block));
  const forbidden = [...definition.forbiddenRendererBlocks, ...(definition.forbiddenBlocks ?? [])]
    .filter((block) => blocks.has(block));
  if (missing.length || forbidden.length) {
    const issues = [
      ...(missing.length ? [`requires ${missing.join(", ")}`] : []),
      ...(forbidden.length ? [`forbids ${forbidden.join(", ")}`] : []),
    ];
    throw new Error(`Pipeline violates content lane ${parsed.key}: ${issues.join("; ")}`);
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
        // For a music channel, audio is not a supporting asset: it is the
        // product. Make the existing aesthetics evaluator mandatory at the
        // runtime boundary even for old persisted pipelines.
        ...(parsed.key === "music_loop" && entry.params?.["audioQa"] === undefined
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
