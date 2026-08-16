/**
 * Shared non-Gemini planning and creator-foundation contract for narrated
 * formats.  It is deliberately an admission description, not another text
 * generator: Topiccraft/Scriptcraft already own the executable Claude-only
 * route.  This layer makes the common route and each format's non-negotiable
 * editorial shape inspectable before a family is admitted.
 */

export const NON_GEMINI_NARRATED_FOUNDATION_VERSION = "non-gemini-narrated-foundation/v1" as const;

export type NarratedFoundationFamily = "narrated_stock" | "sleep" | "shorts";

export interface NarratedFoundationPipelineEntry {
  readonly block: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface NarratedPlanningFoundation {
  readonly version: typeof NON_GEMINI_NARRATED_FOUNDATION_VERSION;
  readonly family: NarratedFoundationFamily;
  readonly plannerId: string;
  readonly plannerBlock: "topic_select";
  readonly provenance: string;
  /**
   * Demand evidence is not automatically a factual-claim citation. Formats
   * that make source-bound claims must add their own typed ledger on top of
   * this foundation rather than treating a topic bet as proof.
   */
  readonly sourcePolicy: string;
  /** Upload always begins as a private draft; release is independently gated. */
  readonly publishingPolicy: string;
  readonly requiredEntries: readonly NarratedFoundationPipelineEntry[];
  readonly forbiddenGeminiBlocks: readonly string[];
  readonly inception: Readonly<{
    id: string;
    provenance: string;
    coveredStages: readonly string[];
  }>;
}

const COMMON_REQUIRED_ENTRIES = Object.freeze([
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "director_brief" },
  { block: "dp_brief" },
  { block: "editor_brief" },
  { block: "composer_brief" },
  { block: "critic_spec" },
  { block: "script_gen" },
  { block: "qa_script" },
  { block: "originality_gate" },
  { block: "compliance_check" },
  { block: "narration_tts" },
  { block: "story_spine" },
  { block: "stock_footage" },
  { block: "entity_imagery" },
  { block: "music" },
  { block: "intro_card" },
  { block: "timeline_assemble" },
  { block: "length_check" },
  { block: "captions" },
  { block: "metadata" },
  // The one sealed Google exception is the receipt-bound thumbnail block.
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
] as const satisfies readonly NarratedFoundationPipelineEntry[]);

const COMMON_FORBIDDEN_GEMINI_BLOCKS = Object.freeze([
  "motion_comic",
  "documotion_short",
  "whiteboard_scribe",
  "lore_short",
] as const);

const COMMON_SOURCE_POLICY =
  "Topiccraft requires a verified demand/freshness evidence packet for every automatic topic bet. " +
  "That packet is planning evidence, not a substitute for a source-bound factual-claim ledger.";

const COMMON_PUBLISHING_POLICY =
  "upload_draft is mandatory and starts private; public or scheduled release requires a separate channel-policy authorization.";

const COMMON_INCEPTION_STAGES = Object.freeze([
  "metadata-only-niche-research",
  "claude-positioning-style-dna-show-bible",
  "provider-metadata-voice-selection-and-local-cold-open",
  "novita-channel-art-and-non-google-vision-qa",
  "non-google-starter-topics-and-sealed-thumbnail-slate",
  "draft-only-publication-state",
] as const);

function foundation(args: Omit<NarratedPlanningFoundation, "version">): NarratedPlanningFoundation {
  return Object.freeze({ version: NON_GEMINI_NARRATED_FOUNDATION_VERSION, ...args });
}

/**
 * The family-specific entries are intentionally small. They prevent a generic
 * narrated essay from being relabelled as a guided session or a vertical Short
 * solely by changing its family field.
 */
export const NON_GEMINI_NARRATED_FOUNDATIONS: Readonly<
  Record<NarratedFoundationFamily, NarratedPlanningFoundation>
> = Object.freeze({
  narrated_stock: foundation({
    family: "narrated_stock",
    plannerId: "narrated-stock-claude-story-spine/v1",
    plannerBlock: "topic_select",
    provenance:
      "non-Google Topiccraft research, Claude crew/script planning, local narration evidence, Story Spine assembly, and independent non-Google visual review; Gemini is sealed to thumbnail_gen only",
    sourcePolicy: COMMON_SOURCE_POLICY,
    publishingPolicy: COMMON_PUBLISHING_POLICY,
    requiredEntries: COMMON_REQUIRED_ENTRIES,
    forbiddenGeminiBlocks: COMMON_FORBIDDEN_GEMINI_BLOCKS,
    inception: {
      id: "narrated-stock-claude-novita-inception/v1",
      provenance:
        "metadata-only YouTube research, Claude positioning/Style DNA/Show Bible, deterministic ElevenLabs voice selection with local cold-open evidence, Novita channel art verified by non-Google vision, and a sealed thumbnail-only Gemini exception",
      coveredStages: COMMON_INCEPTION_STAGES,
    },
  }),
  sleep: foundation({
    family: "sleep",
    plannerId: "guided-ambient-claude-story-spine/v1",
    plannerBlock: "topic_select",
    provenance:
      "non-Google Topiccraft research, Claude-guided original meditation writing, slow narration performance evidence, Story Spine assembly, and independent non-Google visual review; Gemini is sealed to thumbnail_gen only",
    sourcePolicy:
      `${COMMON_SOURCE_POLICY} Guided ambient episodes are original practice/narration rather than an automatically source-claimed factual format.`,
    publishingPolicy: COMMON_PUBLISHING_POLICY,
    requiredEntries: [
      ...COMMON_REQUIRED_ENTRIES,
      { block: "script_gen", params: { style: "meditation" } },
      { block: "narration_tts", params: { pace: "slow" } },
    ],
    forbiddenGeminiBlocks: COMMON_FORBIDDEN_GEMINI_BLOCKS,
    inception: {
      id: "guided-ambient-claude-novita-inception/v1",
      provenance:
        "metadata-only YouTube research, Claude positioning/Style DNA/Show Bible, deterministic voice selection with local cold-open evidence, Novita channel art verified by non-Google vision, and a sealed thumbnail-only Gemini exception",
      coveredStages: COMMON_INCEPTION_STAGES,
    },
  }),
  shorts: foundation({
    family: "shorts",
    plannerId: "vertical-short-claude-story-spine/v1",
    plannerBlock: "topic_select",
    provenance:
      "non-Google Topiccraft research, Claude hook/script/critic loop, portrait Story Spine assembly, independent non-Google visual review, and a sealed thumbnail-only Gemini exception",
    sourcePolicy:
      `${COMMON_SOURCE_POLICY} The admitted Short route is the original motivational/micro-lesson format; source-bound documentary claims remain a separate documentary-collage admission path.`,
    publishingPolicy: COMMON_PUBLISHING_POLICY,
    requiredEntries: [
      ...COMMON_REQUIRED_ENTRIES,
      { block: "script_gen", params: { style: "shorts" } },
      { block: "hook_craft" },
      { block: "story_spine", params: { targetShotSec: 4 } },
      { block: "stock_footage", params: { aspect: "9:16" } },
      { block: "entity_imagery", params: { aspect: "9:16" } },
      { block: "intro_card", params: { aspect: "9:16" } },
      { block: "timeline_assemble", params: { aspect: "9:16", captions: true } },
    ],
    forbiddenGeminiBlocks: COMMON_FORBIDDEN_GEMINI_BLOCKS,
    inception: {
      id: "vertical-short-claude-novita-inception/v1",
      provenance:
        "metadata-only YouTube research, Claude positioning/Style DNA/Show Bible, deterministic voice selection with local cold-open evidence, Novita channel art verified by non-Google vision, and a sealed thumbnail-only Gemini exception",
      coveredStages: COMMON_INCEPTION_STAGES,
    },
  }),
});

export function narratedPlanningFoundation(
  family: string,
): NarratedPlanningFoundation | undefined {
  return NON_GEMINI_NARRATED_FOUNDATIONS[family as NarratedFoundationFamily];
}

function findEntry(
  pipeline: readonly NarratedFoundationPipelineEntry[],
  block: string,
): NarratedFoundationPipelineEntry | undefined {
  return pipeline.find((entry) => entry.block === block);
}

function finiteParam(
  entry: NarratedFoundationPipelineEntry | undefined,
  key: string,
): number | undefined {
  const value = entry?.params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Format checks whose values intentionally vary by requested episode length.
 * Static requiredEntries above protect the identity of the route; these checks
 * protect its bounded editorial envelope.
 */
export function assertNarratedFoundationFormatContract(
  family: string,
  pipeline: readonly NarratedFoundationPipelineEntry[],
): void {
  if (family !== "shorts") return;

  const scriptSeconds = finiteParam(findEntry(pipeline, "script_gen"), "maxSeconds");
  const topicSeconds = finiteParam(findEntry(pipeline, "topic_select"), "targetSeconds");
  const lengthCheck = findEntry(pipeline, "length_check");
  const minimumSeconds = finiteParam(lengthCheck, "minSeconds");
  const maximumSeconds = finiteParam(lengthCheck, "maxSeconds");

  if (scriptSeconds === undefined || scriptSeconds < 15 || scriptSeconds > 60) {
    throw new Error("Shorts: non-Gemini narrated foundation requires script_gen.maxSeconds inside 15–60 seconds");
  }
  if (topicSeconds === undefined || topicSeconds < 15 || topicSeconds > 60) {
    throw new Error("Shorts: non-Gemini narrated foundation requires topic_select.targetSeconds inside 15–60 seconds");
  }
  if (
    minimumSeconds === undefined ||
    maximumSeconds === undefined ||
    minimumSeconds < 15 ||
    minimumSeconds > maximumSeconds ||
    maximumSeconds > 60
  ) {
    throw new Error("Shorts: non-Gemini narrated foundation requires a 15–60 second length_check envelope");
  }
}
