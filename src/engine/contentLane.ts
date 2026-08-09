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
  "whiteboard_explainer",
  "motion_comic",
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
    requiredBlocks: ["stock_footage", "timeline_assemble"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  cinematic_ai: {
    key: "cinematic_ai",
    family: "cinematic",
    primaryRenderer: "novita_render_video",
    requiredBlocks: ["novita_render_images", "novita_render_video", "timeline_assemble"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  music_loop: {
    key: "music_loop",
    family: "music_loop",
    primaryRenderer: "loop_clips",
    requiredBlocks: ["loop_clips", "assemble"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  ambient_guided: {
    key: "ambient_guided",
    family: "sleep",
    primaryRenderer: "stock_footage",
    requiredBlocks: ["stock_footage", "timeline_assemble"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  short_form: {
    key: "short_form",
    family: "shorts",
    primaryRenderer: "stock_footage",
    requiredBlocks: ["stock_footage", "timeline_assemble"],
    forbiddenRendererBlocks: [
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
      "motion_comic",
    ],
  },
  whiteboard_explainer: {
    key: "whiteboard_explainer",
    family: "whiteboard",
    primaryRenderer: "whiteboard_scribe",
    requiredBlocks: ["whiteboard_scribe"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "motion_comic",
    ],
    forbiddenBlocks: ["timeline_assemble", "assemble"],
  },
  motion_comic: {
    key: "motion_comic",
    family: "comic",
    primaryRenderer: "motion_comic",
    requiredBlocks: ["motion_comic"],
    forbiddenRendererBlocks: [
      "stock_footage",
      "gen_footage",
      "novita_render_images",
      "novita_render_video",
      "loop_clips",
      "whiteboard_scribe",
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

export const CONTENT_LANE_BY_FAMILY: Record<FamilyKey, ContentLaneKey> = {
  narrated_stock: "narrated_documentary",
  cinematic: "cinematic_ai",
  music_loop: "music_loop",
  sleep: "ambient_guided",
  shorts: "short_form",
  whiteboard: "whiteboard_explainer",
  comic: "motion_comic",
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
