/**
 * Convex-safe semantic spine for durable creative-capability receipts.
 *
 * The full catalog owns presentation, discovery, and module-registry parity.
 * This compact projection owns only the facts a durable Show Profile must
 * preserve at a database write boundary: known keys, family eligibility,
 * automatic-selection status, and the effective-pipeline evidence each
 * executable capability requires. It must stay free of renderer, provider,
 * and module-registry imports so Convex V8 can enforce the receipt before it
 * is persisted.
 */
import type { FamilyKey } from "../families";
import {
  DATA_STORY_CONTRACT_VERSION,
  SOURCE_ATTRIBUTED_DATA_STORY,
  dataStoryInsertParams,
  dataStoryRecommendationForIntent,
} from "../dataStory";

/** Keep this pinned to the rich catalog's current, creator-facing fingerprint. */
export const CREATIVE_CAPABILITY_RECEIPT_CATALOG_FINGERPRINT =
  "creative-capability-catalog/v3:ebe23da5" as const;

export type CreativeCapabilityReceiptKey =
  | "source_attributed_data_story"
  | "editorial_evidence_packet"
  | "casefile_cinematic"
  | "children_show_bible";

export type CreativeCapabilityReceiptSelectionMode =
  | "explicit_opt_in"
  | "private_review_only";

export interface CreativeCapabilityReceiptIntent {
  concept?: string;
  niche?: string;
  nicheKey?: string;
  audience?: string;
  sampleTopics?: readonly string[];
}

export interface CreativeCapabilityReceiptPipelineEntry {
  block: string;
  params?: Readonly<Record<string, unknown>>;
}

export interface CreativeCapabilityReceiptPipelineObligation {
  block: string;
  params?: Readonly<Record<string, unknown>>;
}

type CreativeCapabilityReceiptEligibility = "data_story_intent" | "none";

export interface CreativeCapabilityReceiptDefinition {
  capability: CreativeCapabilityReceiptKey;
  supportedFamilies: readonly FamilyKey[];
  selectionMode: CreativeCapabilityReceiptSelectionMode;
  eligibility: CreativeCapabilityReceiptEligibility;
  pipelineObligations: readonly CreativeCapabilityReceiptPipelineObligation[];
}

const SOURCE_ATTRIBUTED_DATA_STORY_PIPELINE_OBLIGATIONS = [
  { block: "timeline_assemble" },
  {
    block: "visual_inserts",
    params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY),
  },
  {
    block: "script_gen",
    params: { dataRich: true, sourceAttributionRequired: true },
  },
  {
    block: "qa_script",
    params: {
      dataStoryContract: DATA_STORY_CONTRACT_VERSION,
      requireNamedSource: true,
      requireSpokenNumericAnchor: true,
    },
  },
] as const satisfies readonly CreativeCapabilityReceiptPipelineObligation[];

/**
 * This is intentionally a semantic projection rather than a second rich
 * creator catalog. A parity test binds it to the catalog's current offers.
 */
export const CREATIVE_CAPABILITY_RECEIPT_CATALOG = [
  {
    capability: "source_attributed_data_story",
    supportedFamilies: ["narrated_stock"],
    selectionMode: "explicit_opt_in",
    eligibility: "data_story_intent",
    pipelineObligations: SOURCE_ATTRIBUTED_DATA_STORY_PIPELINE_OBLIGATIONS,
  },
  {
    capability: "editorial_evidence_packet",
    supportedFamilies: ["illustrated_explainer"],
    selectionMode: "private_review_only",
    eligibility: "none",
    pipelineObligations: [],
  },
  {
    capability: "casefile_cinematic",
    supportedFamilies: ["cinematic"],
    selectionMode: "private_review_only",
    eligibility: "none",
    pipelineObligations: [],
  },
  {
    capability: "children_show_bible",
    supportedFamilies: ["children_learning"],
    selectionMode: "private_review_only",
    eligibility: "none",
    pipelineObligations: [],
  },
] as const satisfies readonly CreativeCapabilityReceiptDefinition[];

export function creativeCapabilityReceiptDefinition(
  capability: string,
): CreativeCapabilityReceiptDefinition | undefined {
  return CREATIVE_CAPABILITY_RECEIPT_CATALOG.find((definition) =>
    definition.capability === capability,
  );
}

function matchesRequiredParams(
  actual: Readonly<Record<string, unknown>> | undefined,
  expected: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => {
    const candidate = actual[key];
    return Array.isArray(value)
      ? Array.isArray(candidate) &&
        candidate.length === value.length &&
        candidate.every((item, index) => item === value[index])
      : candidate === value;
  });
}

/**
 * Fail closed before durable storage: only an explicit, current, family- and
 * intent-eligible capability may be represented by a Show Profile receipt.
 */
export function assertCreativeCapabilityReceiptSelection(input: {
  capability: string;
  family: FamilyKey;
  intent: CreativeCapabilityReceiptIntent;
}): CreativeCapabilityReceiptDefinition {
  const definition = creativeCapabilityReceiptDefinition(input.capability);
  if (!definition) {
    throw new Error(`channel show profile contains unknown creative capability ${input.capability}`);
  }
  if (!definition.supportedFamilies.includes(input.family)) {
    throw new Error(
      `creative capability ${definition.capability} is not eligible for ${input.family}`,
    );
  }
  if (definition.selectionMode !== "explicit_opt_in") {
    throw new Error(`${definition.capability} is private review only`);
  }
  if (
    definition.eligibility === "data_story_intent" &&
    dataStoryRecommendationForIntent(input.intent, input.family).length === 0
  ) {
    throw new Error(
      `creative capability ${definition.capability} is not eligible for the stated channel concept`,
    );
  }
  return definition;
}

/**
 * Prove that every receipt-selected capability remains represented by the
 * effective pipeline that a Convex mutation is about to persist.
 */
export function assertCreativeCapabilityReceiptPipelineObligations(
  definitions: readonly CreativeCapabilityReceiptDefinition[],
  pipeline: readonly CreativeCapabilityReceiptPipelineEntry[],
): void {
  for (const definition of definitions) {
    for (const obligation of definition.pipelineObligations) {
      const entry = pipeline.find((candidate) => candidate.block === obligation.block);
      if (!entry) {
        throw new Error(
          `creative capability ${definition.capability} requires effective pipeline block ${obligation.block}`,
        );
      }
      if (!matchesRequiredParams(entry.params, obligation.params)) {
        throw new Error(
          `creative capability ${definition.capability} has incomplete effective pipeline evidence at ${obligation.block}`,
        );
      }
    }
  }
}
