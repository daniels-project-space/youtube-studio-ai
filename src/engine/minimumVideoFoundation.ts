import type { ContentLane } from "./contentLane";
import { certifiedFamilyAdmission } from "./certifiedFamilyAdmission";
import { FAMILY_KEYS, type FamilyKey } from "./families";
import type { PipelineEntry } from "./types";

/**
 * The non-negotiable outcome contract for every channel episode the automatic
 * creator can certify. It deliberately describes *what* every video needs,
 * not one universal creative recipe: a quiz, a whiteboard explainer, an
 * ambient loop, and a narrated documentary may use different authoring and
 * rendering modules while still producing a safe, packaged, reviewable draft.
 */
export const MINIMUM_VIDEO_FOUNDATION_VERSION = "minimum-video-foundation/v2" as const;

/**
 * A derivative Short is only valid when the parent renderer emits both an
 * already-mixed master and narration timings measured against that master.
 * Keep this capability declarative rather than assuming every video family
 * has generic `narration_tts`: self-contained renderers own their own voice
 * production but can still prove the same input contract to shorts_spinoff.
 *
 * New renderers may join this list only after their block ABI provides
 * `videoKey`, `videoLocalPath`, and trustworthy `sentenceTimings`; a mere
 * script, transcript, or planned dialogue is intentionally insufficient.
 */
export const NARRATION_ALIGNED_SHORTS_SOURCE_BLOCKS = [
  "narration_tts",
  "whiteboard_scribe",
  "motion_comic",
] as const;

export type MinimumVideoFoundationStage = {
  readonly key:
    | "episode_promise"
    | "safety"
    | "episode_differentiation"
    | "approved_renderer"
    | "audience_package"
    | "package_to_opening"
    | "final_master_review"
    | "draft_release";
  readonly title: string;
  readonly requirement: string;
};

/**
 * This is the reusable automatic-channel template. Individual lane contracts
 * supply their own script, narration, storyboard, character, music and visual
 * inputs beneath it; none of those optional creative tools can replace a
 * foundation outcome or quietly become a second renderer.
 */
export const MINIMUM_VIDEO_FOUNDATION_TEMPLATE = [
  {
    key: "episode_promise",
    title: "Episode promise",
    requirement: "One bounded topic/episode promise before creative work starts.",
  },
  {
    key: "safety",
    title: "Safety and compliance",
    requirement: "A fail-closed compliance decision before the approved renderer runs.",
  },
  {
    key: "episode_differentiation",
    title: "Episode differentiation",
    requirement:
      "Every route retains a route-appropriate, cross-episode differentiation authority before final review—narrative originality, source-backed quiz fact history, an approved curriculum/series receipt, or an original music program.",
  },
  {
    key: "approved_renderer",
    title: "One approved renderer",
    requirement: "Exactly the content-lane renderer owns final pixels and timing.",
  },
  {
    key: "audience_package",
    title: "Audience package",
    requirement: "Metadata and a single final thumbnail are prepared from the same episode promise.",
  },
  {
    key: "package_to_opening",
    title: "Package-to-opening binding",
    requirement: "The title and thumbnail promise are structurally bound to the opening before release review.",
  },
  {
    key: "final_master_review",
    title: "Final-master review",
    requirement: "The rendered master clears lane-specific visual and audio quality gates.",
  },
  {
    key: "draft_release",
    title: "Draft-release handoff",
    requirement: "Only a reviewed master may enter the draft upload and publication-intent boundary.",
  },
] as const satisfies readonly MinimumVideoFoundationStage[];

export interface MinimumVideoFoundation {
  readonly version: typeof MINIMUM_VIDEO_FOUNDATION_VERSION;
  readonly family: FamilyKey;
  readonly contentLane: ContentLane["key"];
  readonly primaryRenderer: string;
  readonly stages: typeof MINIMUM_VIDEO_FOUNDATION_TEMPLATE;
}

export function pipelineSupportsNarrationAlignedShorts(
  pipeline: readonly PipelineEntry[],
): boolean {
  return pipeline.some((entry) =>
    (NARRATION_ALIGNED_SHORTS_SOURCE_BLOCKS as readonly string[]).includes(entry.block),
  );
}

function indexesFor(pipeline: readonly PipelineEntry[], blocks: readonly string[]): number[] {
  return pipeline
    .map((entry, index) => blocks.includes(entry.block) ? index : -1)
    .filter((index) => index >= 0);
}

function requireExactlyOne(
  pipeline: readonly PipelineEntry[],
  blocks: readonly string[],
  label: string,
): number {
  const indexes = indexesFor(pipeline, blocks);
  if (indexes.length !== 1) {
    throw new Error(
      `minimum video foundation: ${label} requires exactly one ${blocks.join(" or ")} stage; found ${indexes.length}`,
    );
  }
  return indexes[0];
}

function requireAtLeastOne(
  pipeline: readonly PipelineEntry[],
  blocks: readonly string[],
  label: string,
): number {
  const indexes = indexesFor(pipeline, blocks);
  if (!indexes.length) {
    throw new Error(
      `minimum video foundation: ${label} requires one of ${blocks.join(", ")}; found none`,
    );
  }
  return indexes[0];
}

function requireBefore(left: number, right: number, label: string): void {
  if (left >= right) {
    throw new Error(`minimum video foundation: ${label} must run in this order`);
  }
}

/**
 * Derives the visible baseline that the automatic creator and Studio can show
 * for a sealed channel. The same immutable lane renderer is used by the
 * structural assertion below.
 */
export function minimumVideoFoundationFor(args: {
  readonly family: FamilyKey;
  readonly contentLane: ContentLane;
}): MinimumVideoFoundation {
  return {
    version: MINIMUM_VIDEO_FOUNDATION_VERSION,
    family: args.family,
    contentLane: args.contentLane.key,
    primaryRenderer: args.contentLane.primaryRenderer,
    stages: MINIMUM_VIDEO_FOUNDATION_TEMPLATE,
  };
}

/**
 * Enforces the creator-wide baseline after policy completion and lane injection.
 * It intentionally has no fallback or auto-repair branch: the compiler may add
 * proven universal support modules, but a final channel graph missing a core
 * outcome must not be certified as a workable automatic channel.
 */
export function assertMinimumVideoFoundation(args: {
  readonly family: FamilyKey;
  readonly contentLane: ContentLane;
  readonly pipeline: readonly PipelineEntry[];
}): MinimumVideoFoundation {
  const foundation = minimumVideoFoundationFor(args);
  // Some certified self-contained routes replace generic topic selection with
  // a typed quiz/curriculum/case seed. They remain a single immutable episode
  // promise, rather than a reason to force an irrelevant generic planner into
  // their lane.
  const episodePromise = requireAtLeastOne(
    args.pipeline,
    ["topic_select", "quiz_topic_plan", "curriculum_episode_seed", "cinematic_case_sequence"],
    "episode promise",
  );
  const compliance = requireAtLeastOne(
    args.pipeline,
    ["compliance_check", "quiz_topic_safety", "child_content_safety", "scenario_disclosure_gate"],
    "safety",
  );
  // A repeatable system needs a durable reason why this episode is not merely
  // another interchangeable template. The authority varies by product: most
  // narrative lanes use originality, QuizYear carries source-backed fact
  // history, supervised curricula/series carry a sealed episode receipt, and
  // music carries a distinct program plan. Do not force the same prose-based
  // gate into every renderer, but never leave the foundation without one.
  const differentiation = requireAtLeastOne(
    args.pipeline,
    [
      "originality_gate",
      "quiz_topic_plan",
      "curriculum_episode_seed",
      "cinematic_case_sequence",
      "music_program_plan",
    ],
    "episode differentiation",
  );
  const renderer = requireExactlyOne(args.pipeline, [args.contentLane.primaryRenderer], "approved renderer");
  const metadata = requireExactlyOne(args.pipeline, ["metadata", "quiz_metadata"], "audience package");
  const packageToOpening = requireExactlyOne(args.pipeline, ["package_to_opening_plan"], "package-to-opening binding");
  const thumbnail = requireExactlyOne(args.pipeline, ["thumbnail_gen"], "thumbnail package");
  const finalReview = requireExactlyOne(args.pipeline, ["qa_visual"], "final-master review");
  const draftRelease = requireExactlyOne(args.pipeline, ["upload_draft"], "draft-release handoff");

  const finalReviewParams = args.pipeline[finalReview]?.params ?? {};
  if (finalReviewParams["qaProfile"] !== "production") {
    throw new Error("minimum video foundation requires production qa_visual, not a draft or unspecified review profile");
  }
  if (finalReviewParams["audioQa"] !== true) {
    throw new Error("minimum video foundation requires final-master audio-aesthetics QA");
  }

  requireBefore(episodePromise, compliance, "episode promise before safety");
  requireBefore(compliance, renderer, "safety before the approved renderer");
  requireBefore(renderer, metadata, "approved renderer before the audience package");
  requireBefore(metadata, packageToOpening, "metadata before package-to-opening binding");
  requireBefore(packageToOpening, thumbnail, "package-to-opening binding before thumbnail generation");
  requireBefore(thumbnail, finalReview, "thumbnail package before final-master review");
  requireBefore(differentiation, finalReview, "episode differentiation before final-master review");
  requireBefore(finalReview, draftRelease, "final-master review before draft release");

  return foundation;
}

/**
 * The persisted channel graph is a second admission boundary.  A lane can be
 * visually valid while still omitting the package, final-review, or release
 * stages that make an automatic channel safe to operate.  Keep supervised and
 * unregistered lanes editable here; their dedicated policy owns their route.
 */
export function assertMinimumVideoFoundationForAutomaticFamily(args: {
  readonly family: unknown;
  readonly contentLane: ContentLane;
  readonly pipeline: readonly PipelineEntry[];
}): boolean {
  if (
    typeof args.family !== "string" ||
    !(FAMILY_KEYS as readonly string[]).includes(args.family)
  ) {
    return false;
  }
  const family = args.family as FamilyKey;
  if (!certifiedFamilyAdmission(family).automatic) return false;
  assertMinimumVideoFoundation({ family, contentLane: args.contentLane, pipeline: args.pipeline });
  // This applies only to automatic production. Supervised, blocked, and
  // wordless future lanes must not fake a narrative-text or quiz-fact receipt
  // just to look like an executable automatic channel.
  const episodePromise = requireExactlyOne(
    args.pipeline,
    ["topic_select", "quiz_topic_plan", "curriculum_episode_seed", "cinematic_case_sequence"],
    "automatic episode promise",
  );
  const differentiation = requireExactlyOne(
    args.pipeline,
    ["originality_gate", "quiz_topic_plan"],
    "automatic episode differentiation",
  );
  const finalReview = requireExactlyOne(args.pipeline, ["qa_visual"], "final-master review");
  // QuizYear's source-backed quiz planner is intentionally both the sole
  // episode promise and the differentiation authority. Other automatic lanes
  // must keep their separate planners in causal order.
  if (episodePromise !== differentiation) {
    requireBefore(episodePromise, differentiation, "automatic episode promise before differentiation");
  }
  requireBefore(differentiation, finalReview, "automatic episode differentiation before final-master review");
  return true;
}
