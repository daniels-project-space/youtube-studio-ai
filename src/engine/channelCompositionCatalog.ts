/**
 * Durable names for the autonomous channel compositions the studio can
 * actually admit today.
 *
 * This is intentionally a receipt catalog, not a second pipeline compiler.
 * Family, capability, and pipeline registries continue to own all execution,
 * spend, and safety authority. The receipt merely preserves the creator's
 * resolved program shape so a generic family label cannot erase a qualified
 * route such as a source-attributed data story after inception.
 *
 * Keep this module V8-safe: `channelShowProfileCodec` imports it from Convex.
 */
import { z } from "zod";

import type { CreativeCapabilityKey } from "./creative/creativeCapabilityCatalog";
import { SOURCE_ATTRIBUTED_DATA_STORY, dataStoryInsertParams } from "./dataStory";
import type { FamilyKey } from "./families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { CHANNEL_COMPOSITION_RECEIPT_VERSION } from "./channelContractVersions";

export { CHANNEL_COMPOSITION_RECEIPT_VERSION } from "./channelContractVersions";

/** Catalog bookkeeping only; receipts never use a whole-catalog fingerprint. */
export const CHANNEL_COMPOSITION_CATALOG_VERSION = "certified-channel-composition-catalog/v4" as const;
/**
 * A sealed capability plan is a new composition authority for newly admitted
 * modular channels. Legacy exact-catalog receipts keep their own version and
 * validation path forever.
 */
export const CHANNEL_COMPOSITION_PLAN_VERSION = "channel-composition-plan/v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * A small, provider-free pipeline operation owned by a certified composition.
 * The composition compiler is intentionally limited to these existing block
 * operations: it cannot invent a provider, renderer, or new execution path.
 */
export type ChannelCompositionPipelineOperation =
  | {
      readonly kind: "ensure_block_before";
      readonly block: string;
      readonly beforeBlock: string;
    }
  | {
      /** The block must stay after one producer and before one consumer. */
      readonly kind: "ensure_block_between";
      readonly block: string;
      /** Producers that must always exist for this composition. */
      readonly afterBlocks: readonly string[];
      /** Optional producers that must precede the block whenever they exist. */
      readonly optionalAfterBlocks?: readonly string[];
      readonly beforeBlock: string;
    }
  | {
      readonly kind: "merge_block_params";
      readonly block: string;
      readonly params: Readonly<Record<string, unknown>>;
      /**
       * A composition may admit only named, bounded numeric tuning knobs.
       * Arbitrary advanced-editor params can never weaken the sealed base
       * contract or create a new execution path.
       */
      readonly numericOverrides?: readonly {
        readonly key: string;
        readonly minimum: number;
        readonly maximum: number;
        readonly integer?: boolean;
      }[];
    };

/** Versioned, exact declarative materialization for one composition definition. */
export interface ChannelCompositionMaterialization {
  readonly version: string;
  readonly operations: readonly ChannelCompositionPipelineOperation[];
}

/**
 * One capability-owned, versioned contribution to an otherwise family-owned
 * composition. It stays deliberately limited to the same provider-free
 * operation grammar as exact catalog definitions; it cannot add a renderer,
 * model, provider, publish authority, or override an independent automation
 * admission gate.
 */
export interface CapabilityCompositionFragmentDefinition {
  readonly capability: CreativeCapabilityKey;
  readonly definitionVersion: string;
  readonly status: "current" | "historical";
  readonly family: FamilyKey;
  /**
   * Current admissions must name these fragments explicitly. Dependencies are
   * never auto-added: the creator catalog remains the authority over what a
   * channel has selected.
   */
  readonly requiredCapabilityKeys?: readonly CreativeCapabilityKey[];
  /**
   * A selected pair that cannot share one effective pipeline. This is a
   * composition safety constraint only; it grants no new automation path.
   */
  readonly incompatibleCapabilityKeys?: readonly CreativeCapabilityKey[];
  readonly materialization: ChannelCompositionMaterialization;
}

export interface CapabilityCompositionFragmentReceipt {
  readonly capability: CreativeCapabilityKey;
  readonly definitionVersion: string;
  readonly definitionFingerprint: string;
  readonly fingerprint: string;
}

/**
 * The base remains an existing exact family receipt; selected capabilities
 * contribute independently sealed fragments. This removes the family × whole
 * capability-set catalog cross-product without weakening historic receipts.
 */
export interface ChannelCompositionPlanReceipt {
  readonly version: typeof CHANNEL_COMPOSITION_PLAN_VERSION;
  readonly family: FamilyKey;
  readonly base: ChannelCompositionReceipt;
  readonly fragments: readonly CapabilityCompositionFragmentReceipt[];
  readonly selectedCapabilityKeys: readonly CreativeCapabilityKey[];
  readonly operationsFingerprint: string;
  readonly fingerprint: string;
}

/**
 * New profiles carry this discriminated authority. `exact_catalog_v1` is
 * retained only for legacy profile migration/validation; new capability plans
 * never rely on a mutable exact-set lookup.
 */
export type ChannelCompositionBinding =
  | { readonly kind: "exact_catalog_v1"; readonly receipt: ChannelCompositionReceipt }
  | { readonly kind: "capability_plan_v1"; readonly plan: ChannelCompositionPlanReceipt };

export interface ChannelCompositionDefinition {
  key: string;
  /** Version of this exact human-visible definition, not the whole catalog. */
  definitionVersion: string;
  /** A retired definition stays here for historical receipt validation. */
  status: "current" | "historical";
  family: FamilyKey;
  title: string;
  qualityFocus: readonly string[];
  /** Existing explicit capability selections that qualify this route. */
  requiredCapabilityKeys: readonly CreativeCapabilityKey[];
  /**
   * Optional because a composition may currently be identity/receipt-only.
   * When present it is part of this exact definition fingerprint, never an
   * unsealed compiler-side switch.
   */
  materialization?: ChannelCompositionMaterialization;
}

/** Historical v2 materialization; retain byte-for-byte for sealed v2 receipts. */
const SOURCE_ATTRIBUTED_DATA_STORY_V2_MATERIALIZATION = {
  version: "source-attributed-data-story-materialization/v1",
  operations: [
    {
      kind: "ensure_block_before",
      block: "visual_inserts",
      beforeBlock: "timeline_assemble",
    },
    {
      kind: "merge_block_params",
      block: "visual_inserts",
      params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY),
      numericOverrides: [
        { key: "maxInserts", minimum: 1, maximum: 8, integer: true },
        { key: "minGapSec", minimum: 0, maximum: 120 },
      ],
    },
    {
      kind: "merge_block_params",
      block: "script_gen",
      params: { dataRich: true, sourceAttributionRequired: true },
    },
    {
      kind: "merge_block_params",
      block: "qa_script",
      params: {
        dataStoryContract: SOURCE_ATTRIBUTED_DATA_STORY.version,
        requireNamedSource: true,
        requireSpokenNumericAnchor: true,
      },
    },
  ],
} as const satisfies ChannelCompositionMaterialization;

/**
 * The current route makes the data visual's quote-overlay dependency explicit:
 * source-attributed inserts are meaningful only after the title and any
 * enabled quote overlays exist, and before the final master is assembled.
 */
/**
 * Historical exact-catalog materialization. Capability fragment v1 reuses
 * this object byte-for-byte, so rows admitted before the post-narration
 * checkpoint keep their original pipeline, reservation, renderer, and
 * quality-policy identity.
 */
export const SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION = {
  version: "source-attributed-data-story-materialization/v2",
  operations: [
    {
      kind: "ensure_block_between",
      block: "visual_inserts",
      afterBlocks: ["intro_card"],
      optionalAfterBlocks: ["quote_overlays"],
      beforeBlock: "timeline_assemble",
    },
    {
      kind: "merge_block_params",
      block: "visual_inserts",
      params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY),
      numericOverrides: [
        { key: "maxInserts", minimum: 1, maximum: 8, integer: true },
        { key: "minGapSec", minimum: 0, maximum: 120 },
      ],
    },
    {
      kind: "merge_block_params",
      block: "script_gen",
      params: { dataRich: true, sourceAttributionRequired: true },
    },
    {
      kind: "merge_block_params",
      block: "qa_script",
      params: {
        dataStoryContract: SOURCE_ATTRIBUTED_DATA_STORY.version,
        requireNamedSource: true,
        requireSpokenNumericAnchor: true,
      },
    },
  ],
} as const satisfies ChannelCompositionMaterialization;

/**
 * Phase I post-narration materialization. Episode Graph is deterministic and
 * provider-free; placing it between the actual Story Spine and the first
 * narrated-stock visual stage makes the factual review checkpoint available
 * before stock, entity, music, or data-visual work can begin. This is a new
 * immutable row rather than a mutation of v3, so prior plans remain replayable
 * against their exact historical materialization.
 */
export const SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION = {
  version: "source-attributed-data-story-materialization/v3",
  operations: [
    {
      kind: "ensure_block_between",
      block: "episode_graph",
      afterBlocks: ["story_spine"],
      beforeBlock: "stock_footage",
    },
    {
      kind: "ensure_block_between",
      block: "visual_inserts",
      afterBlocks: ["intro_card"],
      optionalAfterBlocks: ["quote_overlays"],
      beforeBlock: "timeline_assemble",
    },
    {
      kind: "merge_block_params",
      block: "visual_inserts",
      params: dataStoryInsertParams(SOURCE_ATTRIBUTED_DATA_STORY),
      numericOverrides: [
        { key: "maxInserts", minimum: 1, maximum: 8, integer: true },
        { key: "minGapSec", minimum: 0, maximum: 120 },
      ],
    },
    {
      kind: "merge_block_params",
      block: "script_gen",
      params: { dataRich: true, sourceAttributionRequired: true },
    },
    {
      kind: "merge_block_params",
      block: "qa_script",
      params: {
        dataStoryContract: SOURCE_ATTRIBUTED_DATA_STORY.version,
        requireNamedSource: true,
        requireSpokenNumericAnchor: true,
      },
    },
  ],
} as const satisfies ChannelCompositionMaterialization;

/**
 * v2 receipts were sealed before the full producer ordering could be encoded
 * in their materialization identity. Keep that identity immutable so existing
 * profiles remain parseable, but reject any persisted v2 graph that drifts
 * from the already-required insert timing contract. v3 seals this same rule
 * directly into the receipt for all new admissions.
 */
const SOURCE_ATTRIBUTED_DATA_STORY_V2_PERSISTED_ORDER_COMPATIBILITY = {
  kind: "ensure_block_between",
  block: "visual_inserts",
  afterBlocks: ["intro_card"],
  optionalAfterBlocks: ["quote_overlays"],
  beforeBlock: "timeline_assemble",
} as const satisfies ChannelCompositionPipelineOperation;

/**
 * Fragment history is independent from the legacy exact-composition history.
 * Never rewrite a row: persisted capability plans bind this exact definition
 * fingerprint and may only replay its original operations.
 */
export const CAPABILITY_COMPOSITION_FRAGMENT_HISTORY = [
  {
    capability: "source_attributed_data_story",
    definitionVersion: "v1",
    status: "historical",
    family: "narrated_stock",
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  },
  {
    capability: "source_attributed_data_story",
    definitionVersion: "v2",
    status: "current",
    family: "narrated_stock",
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION,
  },
] as const satisfies readonly CapabilityCompositionFragmentDefinition[];

/**
 * Historical definition ledger. When a definition changes, retain its old
 * entry with `status: "historical"` and append a new version; never rewrite or
 * remove a sealed definition. Adding another composition is therefore
 * additive and cannot invalidate an existing receipt.
 */
export const CHANNEL_COMPOSITION_DEFINITION_HISTORY = [
  {
    key: "narrated_visual_essay",
    definitionVersion: "v1",
    status: "current",
    family: "narrated_stock",
    title: "Narrated visual essay",
    qualityFocus: ["causal story spine", "voice performance", "evidence-matched b-roll", "retention pacing"],
    requiredCapabilityKeys: [],
  },
  {
    key: "source_attributed_data_story",
    definitionVersion: "v1",
    // Keep v1's pre-materialization identity forever so existing sealed Show
    // Profiles remain readable. v2 below is the first executable declarative
    // composition definition and is selected for all new admissions.
    status: "historical",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
  },
  {
    key: "source_attributed_data_story",
    definitionVersion: "v2",
    status: "historical",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V2_MATERIALIZATION,
  },
  {
    key: "source_attributed_data_story",
    definitionVersion: "v3",
    status: "historical",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
  },
  {
    key: "source_attributed_data_story",
    definitionVersion: "v4",
    status: "current",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V4_MATERIALIZATION,
  },
  {
    key: "original_music_loop",
    definitionVersion: "v1",
    status: "current",
    family: "music_loop",
    title: "Original music-loop program",
    qualityFocus: ["route-sealed instrumental direction", "seamless visual motion", "musical loop continuity", "final-master visual and audio review"],
    requiredCapabilityKeys: [],
  },
  {
    key: "guided_relaxation",
    definitionVersion: "v1",
    status: "current",
    family: "sleep",
    title: "Guided relaxation",
    qualityFocus: ["comforting voice", "safe loudness", "slow visual continuity", "no jarring transitions"],
    requiredCapabilityKeys: [],
  },
  {
    key: "vertical_micro_explainer",
    definitionVersion: "v1",
    status: "current",
    family: "shorts",
    title: "Vertical micro-explainer",
    qualityFocus: ["first-second hook", "caption readability", "pattern interrupts", "clear payoff"],
    requiredCapabilityKeys: [],
  },
  {
    key: "interactive_curated_trivia",
    definitionVersion: "v1",
    status: "current",
    family: "quizyear",
    title: "Interactive curated trivia",
    qualityFocus: ["fact correctness", "question clarity", "answer timing", "interactive pacing"],
    requiredCapabilityKeys: [],
  },
  {
    key: "drawn_whiteboard_explainer",
    definitionVersion: "v1",
    status: "current",
    family: "whiteboard",
    title: "Drawn whiteboard explainer",
    qualityFocus: ["critic-approved causal storyboard", "narration-synchronized drawing", "legible labels", "final-master visual and audio review"],
    requiredCapabilityKeys: [],
  },
  {
    key: "motion_comic_storytelling",
    definitionVersion: "v1",
    status: "current",
    family: "comic",
    title: "Original motion-comic storytelling",
    qualityFocus: ["critic-approved panel progression", "character and panel continuity", "dialogue legibility", "final-master visual and audio review"],
    requiredCapabilityKeys: [],
  },
  {
    key: "lore_micro_documentary",
    definitionVersion: "v1",
    status: "current",
    family: "loreshort",
    title: "First-person lore micro-documentary",
    qualityFocus: ["critic-approved first-person beat arc", "depth-plane artwork and camera travel", "narration continuity", "final-master visual and audio review"],
    requiredCapabilityKeys: [],
  },
  {
    key: "cinematic_visual_control_story",
    definitionVersion: "v1",
    status: "current",
    family: "cinematic",
    title: "Cinematic visual-control story",
    qualityFocus: [
      "causal Story Spine and shot grammar",
      "sealed character, setting, and camera controls",
      "keyframe-to-video temporal continuity",
      "final-master visual, pacing, and narration review",
    ],
    requiredCapabilityKeys: [],
  },
  {
    key: "illustrated_original_explainer",
    definitionVersion: "v1",
    status: "current",
    family: "illustrated_explainer",
    title: "Illustrated original explainer",
    qualityFocus: ["causal Episode Graph", "diagram and label legibility", "narration-to-state timing", "scene continuity"],
    requiredCapabilityKeys: [],
  },
] as const satisfies readonly ChannelCompositionDefinition[];

/** Current entries are selectable; historical entries only validate old receipts. */
export const CERTIFIED_CHANNEL_COMPOSITIONS = CHANNEL_COMPOSITION_DEFINITION_HISTORY
  .filter((definition) => definition.status === "current");

export type ChannelCompositionKey = (typeof CHANNEL_COMPOSITION_DEFINITION_HISTORY)[number]["key"];

export interface ChannelCompositionReceipt {
  version: typeof CHANNEL_COMPOSITION_RECEIPT_VERSION;
  key: ChannelCompositionKey;
  definitionVersion: string;
  /** Digest of one immutable definition, deliberately not the whole catalog. */
  definitionFingerprint: string;
  family: FamilyKey;
  /** The exact creator-visible title and quality promise are sealed too. */
  title: string;
  qualityFocus: readonly string[];
  fingerprint: string;
}

type ChannelCompositionReceiptBody = Omit<ChannelCompositionReceipt, "fingerprint">;
type HistoricalCompositionDefinition = ChannelCompositionDefinition;

function operationKind(operation: unknown): string {
  if (operation && typeof operation === "object" && typeof (operation as { kind?: unknown }).kind === "string") {
    return (operation as { kind: string }).kind;
  }
  return "<missing>";
}

function failUnsupportedOperationKind(operation: unknown): never {
  throw new Error(`unsupported certified composition operation kind ${operationKind(operation)}`);
}

function operationIdentity(operation: ChannelCompositionPipelineOperation): Record<string, unknown> {
  switch (operationKind(operation)) {
    case "ensure_block_before": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>;
      return {
        kind: ordered.kind,
        block: ordered.block,
        beforeBlock: ordered.beforeBlock,
      };
    }
    case "ensure_block_between": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>;
      return {
        kind: ordered.kind,
        block: ordered.block,
        afterBlocks: [...ordered.afterBlocks],
        ...(ordered.optionalAfterBlocks ? { optionalAfterBlocks: [...ordered.optionalAfterBlocks] } : {}),
        beforeBlock: ordered.beforeBlock,
      };
    }
    case "merge_block_params": {
      const merged = operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>;
      return {
        kind: merged.kind,
        block: merged.block,
        params: cloneParams(merged.params),
        ...(merged.numericOverrides
          ? { numericOverrides: merged.numericOverrides.map((override) => ({ ...override })) }
          : {}),
      };
    }
    default:
      return failUnsupportedOperationKind(operation);
  }
}

function definitionIdentity(definition: ChannelCompositionDefinition) {
  return {
    key: definition.key,
    definitionVersion: definition.definitionVersion,
    family: definition.family,
    title: definition.title,
    qualityFocus: [...definition.qualityFocus],
    requiredCapabilityKeys: [...definition.requiredCapabilityKeys],
    ...(definition.materialization
      ? {
          materialization: {
            version: definition.materialization.version,
            operations: definition.materialization.operations.map(operationIdentity),
          },
        }
      : {}),
  };
}

function definitionFingerprint(definition: ChannelCompositionDefinition): string {
  return sha256Hex(canonicalJson(definitionIdentity(definition)));
}

const ChannelCompositionReceiptSchema = z.object({
  version: z.literal(CHANNEL_COMPOSITION_RECEIPT_VERSION),
  key: z.string().min(1).max(160),
  definitionVersion: z.string().min(1).max(80),
  definitionFingerprint: z.string().regex(SHA256_PATTERN),
  family: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  qualityFocus: z.array(z.string().min(1).max(240)).min(1).max(16),
  fingerprint: z.string().regex(SHA256_PATTERN),
}).strict();

const CapabilityCompositionFragmentReceiptSchema = z.object({
  capability: z.string().min(1).max(160),
  definitionVersion: z.string().min(1).max(80),
  definitionFingerprint: z.string().regex(SHA256_PATTERN),
  fingerprint: z.string().regex(SHA256_PATTERN),
}).strict();

const ChannelCompositionPlanReceiptSchema = z.object({
  version: z.literal(CHANNEL_COMPOSITION_PLAN_VERSION),
  family: z.string().min(1).max(160),
  base: ChannelCompositionReceiptSchema,
  fragments: z.array(CapabilityCompositionFragmentReceiptSchema).max(32),
  selectedCapabilityKeys: z.array(z.string().min(1).max(160)).max(32),
  operationsFingerprint: z.string().regex(SHA256_PATTERN),
  fingerprint: z.string().regex(SHA256_PATTERN),
}).strict();

const ChannelCompositionBindingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exact_catalog_v1"),
    receipt: ChannelCompositionReceiptSchema,
  }).strict(),
  z.object({
    kind: z.literal("capability_plan_v1"),
    plan: ChannelCompositionPlanReceiptSchema,
  }).strict(),
]);

function definitionFor(key: string, definitionVersion: string): HistoricalCompositionDefinition | undefined {
  assertCertifiedChannelCompositionCatalog();
  return CHANNEL_COMPOSITION_DEFINITION_HISTORY.find(
    (definition) => definition.key === key && definition.definitionVersion === definitionVersion,
  );
}

function receiptFingerprint(body: ChannelCompositionReceiptBody): string {
  return sha256Hex(canonicalJson(body));
}

function receiptFor(definition: ChannelCompositionDefinition): ChannelCompositionReceipt {
  const body: ChannelCompositionReceiptBody = {
    version: CHANNEL_COMPOSITION_RECEIPT_VERSION,
    key: definition.key as ChannelCompositionKey,
    definitionVersion: definition.definitionVersion,
    definitionFingerprint: definitionFingerprint(definition),
    family: definition.family,
    title: definition.title,
    qualityFocus: [...definition.qualityFocus],
  };
  return { ...body, fingerprint: receiptFingerprint(body) };
}

function fragmentDefinitionIdentity(definition: CapabilityCompositionFragmentDefinition) {
  return {
    capability: definition.capability,
    definitionVersion: definition.definitionVersion,
    family: definition.family,
    ...(definition.requiredCapabilityKeys
      ? { requiredCapabilityKeys: [...definition.requiredCapabilityKeys] }
      : {}),
    ...(definition.incompatibleCapabilityKeys
      ? { incompatibleCapabilityKeys: [...definition.incompatibleCapabilityKeys] }
      : {}),
    materialization: {
      version: definition.materialization.version,
      operations: definition.materialization.operations.map(operationIdentity),
    },
  };
}

function fragmentDefinitionFingerprint(definition: CapabilityCompositionFragmentDefinition): string {
  return sha256Hex(canonicalJson(fragmentDefinitionIdentity(definition)));
}

function fragmentReceiptBody(
  definition: CapabilityCompositionFragmentDefinition,
): Omit<CapabilityCompositionFragmentReceipt, "fingerprint"> {
  return {
    capability: definition.capability,
    definitionVersion: definition.definitionVersion,
    definitionFingerprint: fragmentDefinitionFingerprint(definition),
  };
}

function fragmentReceiptFor(
  definition: CapabilityCompositionFragmentDefinition,
): CapabilityCompositionFragmentReceipt {
  const body = fragmentReceiptBody(definition);
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneJsonValue(nested)]),
    );
  }
  return value;
}

function cloneParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, cloneJsonValue(value)]),
  );
}

function cloneMaterialization(
  materialization: ChannelCompositionMaterialization,
): ChannelCompositionMaterialization {
  return {
    version: materialization.version,
    operations: materialization.operations.map((operation) => {
      switch (operationKind(operation)) {
        case "ensure_block_before": {
          const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>;
          return {
            kind: ordered.kind,
            block: ordered.block,
            beforeBlock: ordered.beforeBlock,
          };
        }
        case "ensure_block_between": {
          const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>;
          return {
            kind: ordered.kind,
            block: ordered.block,
            afterBlocks: [...ordered.afterBlocks],
            ...(ordered.optionalAfterBlocks
              ? { optionalAfterBlocks: [...ordered.optionalAfterBlocks] }
              : {}),
            beforeBlock: ordered.beforeBlock,
          };
        }
        case "merge_block_params": {
          const merged = operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>;
          return {
            kind: merged.kind,
            block: merged.block,
            params: cloneParams(merged.params),
            ...(merged.numericOverrides
              ? { numericOverrides: merged.numericOverrides.map((override) => ({ ...override })) }
              : {}),
          };
        }
        default:
          return failUnsupportedOperationKind(operation);
      }
    }),
  };
}

function normalizedCapabilityKeys(keys: readonly string[]): readonly string[] {
  return [...new Set(keys)].sort((left, right) => left.localeCompare(right));
}

/**
 * The creator catalog declares which current composition-fragment revision a
 * selected capability is allowed to materialize.  Keep this optional at the
 * catalog boundary so historical receipt parsing remains replay-compatible,
 * but require an exact one-to-one map whenever a current caller provides it.
 */
function assertExpectedCapabilityFragmentVersionBindings(input: {
  selectedCapabilityKeys: readonly string[];
  expectedFragmentVersions: Readonly<Record<string, string>>;
}): void {
  if (!input.expectedFragmentVersions || typeof input.expectedFragmentVersions !== "object") {
    throw new Error("current capability composition plans require declared fragment-version bindings");
  }

  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys);
  const declaredCapabilityKeys = normalizedCapabilityKeys(Object.keys(input.expectedFragmentVersions));
  if (canonicalJson(declaredCapabilityKeys) !== canonicalJson(selectedCapabilityKeys)) {
    throw new Error("capability composition fragment-version bindings must exactly match selected capabilities");
  }

  for (const capability of selectedCapabilityKeys) {
    const version = input.expectedFragmentVersions[capability];
    if (typeof version !== "string" || !version.trim()) {
      throw new Error(`capability composition fragment ${capability} has no declared fragment version`);
    }
  }
}

function capabilitySetIdentity(keys: readonly string[]): string {
  return canonicalJson(normalizedCapabilityKeys(keys));
}

/**
 * Keep current route selection one-to-one. A composition receipt names an
 * exact capability set, so two current definitions may never compete for the
 * same family/set pair. Historical definitions intentionally remain outside
 * this uniqueness constraint because they are resolved only by key/version.
 */
export function assertCertifiedChannelCompositionCatalog(
  definitions: readonly ChannelCompositionDefinition[] = CHANNEL_COMPOSITION_DEFINITION_HISTORY,
): void {
  const historicalDefinitionIds = new Set<string>();
  const currentRoutes = new Set<string>();

  for (const definition of definitions) {
    const definitionId = `${definition.key}\u0000${definition.definitionVersion}`;
    if (historicalDefinitionIds.has(definitionId)) {
      throw new Error(
        `duplicate certified channel composition definition ${definition.key}/${definition.definitionVersion}`,
      );
    }
    historicalDefinitionIds.add(definitionId);

    const normalized = normalizedCapabilityKeys(definition.requiredCapabilityKeys);
    if (normalized.length !== definition.requiredCapabilityKeys.length) {
      throw new Error(
        `certified channel composition ${definition.key}/${definition.definitionVersion} repeats capability keys`,
      );
    }
    if (definition.materialization) {
      assertCapabilityCompositionOperationCompatibility(
        definition.materialization.operations.map((operation) => ({
          source: `exact:${definition.key}@${definition.definitionVersion}`,
          operation,
        })),
      );
    }
    if (definition.status !== "current") continue;

    const routeId = `${definition.family}\u0000${capabilitySetIdentity(normalized)}`;
    if (currentRoutes.has(routeId)) {
      throw new Error(
        `ambiguous current certified composition route for ${definition.family} capability set ${capabilitySetIdentity(normalized)}`,
      );
    }
    currentRoutes.add(routeId);
  }
}

type CapabilityCompositionFragmentConstraintKey =
  | "requiredCapabilityKeys"
  | "incompatibleCapabilityKeys";

type CapabilityCompositionFragmentConstraintDefinition = Pick<
  CapabilityCompositionFragmentDefinition,
  "capability" | "requiredCapabilityKeys" | "incompatibleCapabilityKeys"
> & Partial<Pick<CapabilityCompositionFragmentDefinition, "definitionVersion">>;

function fragmentConstraintLabel(
  definition: CapabilityCompositionFragmentConstraintDefinition,
): string {
  return `capability composition fragment ${definition.capability}${
    definition.definitionVersion ? `/${definition.definitionVersion}` : ""
  }`;
}

function fragmentConstraintKeys(
  definition: CapabilityCompositionFragmentConstraintDefinition,
  key: CapabilityCompositionFragmentConstraintKey,
): readonly CreativeCapabilityKey[] {
  const declared = definition[key];
  if (declared === undefined) return [];
  if (
    !Array.isArray(declared) ||
    !declared.length ||
    declared.some((capability) => typeof capability !== "string" || !capability.trim())
  ) {
    throw new Error(
      `${fragmentConstraintLabel(definition)} has invalid ${key}`,
    );
  }
  const normalized = normalizedCapabilityKeys(declared) as CreativeCapabilityKey[];
  if (canonicalJson(normalized) !== canonicalJson(declared)) {
    throw new Error(
      `${fragmentConstraintLabel(definition)} ${key} must be sorted and unique`,
    );
  }
  if (normalized.includes(definition.capability)) {
    throw new Error(
      `${fragmentConstraintLabel(definition)} cannot ${key === "requiredCapabilityKeys" ? "require" : "be incompatible with"} itself`,
    );
  }
  return normalized;
}

function assertAcyclicCurrentCapabilityCompositionDependencies(
  definitions: readonly CapabilityCompositionFragmentDefinition[],
): void {
  const currentByRoute = new Map(
    definitions.map((definition) => [
      `${definition.family}\u0000${definition.capability}`,
      definition,
    ]),
  );
  const state = new Map<string, "visiting" | "visited">();
  const stack: CapabilityCompositionFragmentDefinition[] = [];

  const visit = (definition: CapabilityCompositionFragmentDefinition): void => {
    const routeId = `${definition.family}\u0000${definition.capability}`;
    const prior = state.get(routeId);
    if (prior === "visited") return;
    if (prior === "visiting") {
      const cycleStart = stack.findIndex((entry) => entry === definition);
      const cycle = [...stack.slice(cycleStart), definition]
        .map((entry) => entry.capability)
        .join(" -> ");
      throw new Error(
        `cyclic current capability composition dependency for ${definition.family}: ${cycle}`,
      );
    }
    state.set(routeId, "visiting");
    stack.push(definition);
    for (const capability of fragmentConstraintKeys(definition, "requiredCapabilityKeys")) {
      const dependency = currentByRoute.get(`${definition.family}\u0000${capability}`);
      if (!dependency) {
        // Target existence is checked before the traversal. Keeping this
        // branch fail-closed protects future callers of this helper.
        throw new Error(
          `capability composition fragment ${definition.capability}/${definition.definitionVersion} requires an unavailable current ${definition.family}/${capability} fragment`,
        );
      }
      visit(dependency);
    }
    stack.pop();
    state.set(routeId, "visited");
  };

  for (const definition of [...definitions].sort((left, right) => (
    `${left.family}\u0000${left.capability}`.localeCompare(`${right.family}\u0000${right.capability}`)
  ))) {
    visit(definition);
  }
}

/**
 * Fragment definitions use the same historical-ledger rule as exact receipts:
 * a current family/capability pair may resolve once, while retired versions
 * remain available only to validate an already sealed plan.
 */
export function assertCapabilityCompositionFragmentCatalog(
  definitions: readonly CapabilityCompositionFragmentDefinition[] = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY,
): void {
  const historicalIds = new Set<string>();
  const currentRoutes = new Map<string, CapabilityCompositionFragmentDefinition>();
  for (const definition of definitions) {
    const definitionId = `${definition.capability}\u0000${definition.definitionVersion}`;
    if (historicalIds.has(definitionId)) {
      throw new Error(
        `duplicate capability composition fragment ${definition.capability}/${definition.definitionVersion}`,
      );
    }
    historicalIds.add(definitionId);
    if (!definition.materialization.version || !definition.materialization.operations.length) {
      throw new Error(
        `capability composition fragment ${definition.capability}/${definition.definitionVersion} has no materialization`,
      );
    }
    const requiredCapabilityKeys = fragmentConstraintKeys(definition, "requiredCapabilityKeys");
    const incompatibleCapabilityKeys = fragmentConstraintKeys(
      definition,
      "incompatibleCapabilityKeys",
    );
    if (requiredCapabilityKeys.some((capability) => incompatibleCapabilityKeys.includes(capability))) {
      throw new Error(
        `capability composition fragment ${definition.capability}/${definition.definitionVersion} both requires and rejects the same capability`,
      );
    }
    // This also rejects an operation kind that a future catalog row might try
    // to introduce without compiler support, incompatible internal params,
    // and impossible intra-fragment ordering before it can be selected.
    assertCapabilityCompositionOperationCompatibility(
      definition.materialization.operations.map((operation) => ({
        source: `capability:${definition.capability}@${definition.definitionVersion}`,
        operation,
      })),
    );
    if (definition.status !== "current") continue;
    const routeId = `${definition.family}\u0000${definition.capability}`;
    if (currentRoutes.has(routeId)) {
      throw new Error(
        `ambiguous current capability composition fragment for ${definition.family}/${definition.capability}`,
      );
    }
    currentRoutes.set(routeId, definition);
  }

  const currentDefinitions = [...currentRoutes.values()];
  for (const definition of currentDefinitions) {
    for (const [key, label] of [
      ["requiredCapabilityKeys", "requires"] as const,
      ["incompatibleCapabilityKeys", "is incompatible with"] as const,
    ]) {
      for (const capability of fragmentConstraintKeys(definition, key)) {
        if (!currentRoutes.has(`${definition.family}\u0000${capability}`)) {
          throw new Error(
            `capability composition fragment ${definition.capability}/${definition.definitionVersion} ${label} an unavailable current ${definition.family}/${capability} fragment`,
          );
        }
      }
    }
  }
  assertAcyclicCurrentCapabilityCompositionDependencies(currentDefinitions);
}

function fragmentDefinitionFor(
  capability: string,
  definitionVersion: string,
): CapabilityCompositionFragmentDefinition | undefined {
  assertCapabilityCompositionFragmentCatalog();
  return CAPABILITY_COMPOSITION_FRAGMENT_HISTORY.find(
    (definition) =>
      definition.capability === capability && definition.definitionVersion === definitionVersion,
  );
}

function currentFragmentDefinitionFor(
  family: FamilyKey,
  capability: CreativeCapabilityKey,
): CapabilityCompositionFragmentDefinition | undefined {
  assertCapabilityCompositionFragmentCatalog();
  const matches = CAPABILITY_COMPOSITION_FRAGMENT_HISTORY.filter(
    (definition) =>
      definition.status === "current" &&
      definition.family === family &&
      definition.capability === capability,
  );
  if (matches.length > 1) {
    throw new Error(
      `ambiguous current capability composition fragment for ${family}/${capability}`,
    );
  }
  return matches[0];
}

/**
 * Validate a complete selected fragment set before sealing a current plan.
 * Dependencies remain explicit selections rather than silently enabling a
 * second capability, preserving creator intent and its existing review gates.
 */
export function assertCapabilityCompositionFragmentSelectionCompatibility(input: {
  readonly selectedCapabilityKeys: readonly CreativeCapabilityKey[];
  readonly fragments: readonly Pick<
    CapabilityCompositionFragmentDefinition,
    "capability" | "requiredCapabilityKeys" | "incompatibleCapabilityKeys"
  >[];
}): void {
  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys) as CreativeCapabilityKey[];
  const fragmentCapabilityKeys = input.fragments.map((fragment) => fragment.capability);
  if (canonicalJson(fragmentCapabilityKeys) !== canonicalJson(selectedCapabilityKeys)) {
    throw new Error("capability composition fragments must exactly match sorted selected capabilities");
  }
  const selected = new Set(selectedCapabilityKeys);
  for (const fragment of input.fragments) {
    for (const capability of fragmentConstraintKeys(fragment, "requiredCapabilityKeys")) {
      if (!selected.has(capability)) {
        throw new Error(
          `capability composition fragment ${fragment.capability} requires selected capability ${capability}`,
        );
      }
    }
    for (const capability of fragmentConstraintKeys(fragment, "incompatibleCapabilityKeys")) {
      if (selected.has(capability)) {
        throw new Error(
          `capability composition fragment ${fragment.capability} is incompatible with selected capability ${capability}`,
        );
      }
    }
  }
}

function matchingCompositionDefinition(input: {
  family: FamilyKey;
  selectedCapabilityKeys?: readonly string[];
}): HistoricalCompositionDefinition | undefined {
  assertCertifiedChannelCompositionCatalog();
  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys ?? []);
  const matches = CERTIFIED_CHANNEL_COMPOSITIONS
    .filter((candidate) => candidate.family === input.family)
    .filter((candidate) => capabilitySetIdentity(candidate.requiredCapabilityKeys) === capabilitySetIdentity(selectedCapabilityKeys));
  if (matches.length > 1) {
    throw new Error(
      `ambiguous current certified composition route for ${input.family} capability set ${capabilitySetIdentity(selectedCapabilityKeys)}`,
    );
  }
  return matches[0];
}

/**
 * Resolve only an already-admitted composition whose normalized capability
 * set exactly matches the requested selection.
 */
export function resolveCertifiedChannelComposition(input: {
  family: FamilyKey;
  selectedCapabilityKeys?: readonly string[];
}): ChannelCompositionReceipt {
  const definition = matchingCompositionDefinition(input);
  if (!definition) {
    throw new Error(`no certified autonomous channel composition is registered for ${input.family}`);
  }
  return receiptFor(definition);
}

/**
 * A generic/supervised family remains a valid Show Profile but has no
 * autonomous composition receipt until its own channel-creation capability is
 * registered. This avoids retroactively granting it creator authority.
 */
export function findCertifiedChannelComposition(input: {
  family: FamilyKey;
  selectedCapabilityKeys?: readonly string[];
}): ChannelCompositionReceipt | undefined {
  const definition = matchingCompositionDefinition(input);
  return definition ? receiptFor(definition) : undefined;
}

/**
 * Structural and historical-definition validation for a persisted receipt.
 * An unrelated future catalog addition is intentionally irrelevant: only the
 * exact definition version named by the receipt is consulted here.
 */
export function parseChannelCompositionReceipt(value: unknown): ChannelCompositionReceipt {
  const receipt = ChannelCompositionReceiptSchema.parse(value) as ChannelCompositionReceipt;
  const definition = definitionFor(receipt.key, receipt.definitionVersion);
  if (!definition || definition.family !== receipt.family) {
    throw new Error("channel composition receipt does not name a certified historical definition");
  }
  if (receipt.definitionFingerprint !== definitionFingerprint(definition)) {
    throw new Error("channel composition receipt definition fingerprint does not match its historical definition");
  }
  const expected = receiptFor(definition);
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new Error("channel composition receipt does not match its sealed historical definition");
  }
  return expected;
}

/**
 * Resolve the sealed, provider-free operation list for an exact receipt.
 * Historical receipt versions intentionally return no operations: a retry may
 * validate its old receipt but must not silently execute a newer definition.
 */
export function certifiedChannelCompositionMaterialization(
  receipt: ChannelCompositionReceipt,
): ChannelCompositionMaterialization | undefined {
  const parsed = parseChannelCompositionReceipt(receipt);
  const definition = definitionFor(parsed.key, parsed.definitionVersion);
  if (!definition?.materialization) return undefined;
  return cloneMaterialization(definition.materialization);
}

function parseCapabilityCompositionFragmentReceipt(
  value: unknown,
): CapabilityCompositionFragmentReceipt {
  const receipt = CapabilityCompositionFragmentReceiptSchema.parse(value) as CapabilityCompositionFragmentReceipt;
  const definition = fragmentDefinitionFor(receipt.capability, receipt.definitionVersion);
  if (!definition) {
    throw new Error("capability composition fragment does not name a certified historical definition");
  }
  if (receipt.definitionFingerprint !== fragmentDefinitionFingerprint(definition)) {
    throw new Error(
      "capability composition fragment definition fingerprint does not match its historical definition",
    );
  }
  const expected = fragmentReceiptFor(definition);
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new Error("capability composition fragment does not match its sealed historical definition");
  }
  return expected;
}

export interface CapabilityCompositionOperationSource {
  /** Debug identity only; authority remains the sealed base or fragment row. */
  readonly source: string;
  readonly operation: ChannelCompositionPipelineOperation;
}

function capabilityCompositionPlanOperationSources(input: {
  readonly base: ChannelCompositionReceipt;
  readonly fragments: readonly CapabilityCompositionFragmentReceipt[];
}): CapabilityCompositionOperationSource[] {
  const baseOperations = certifiedChannelCompositionMaterialization(input.base)?.operations ?? [];
  const fragmentOperations = input.fragments.flatMap((receipt) => {
    const definition = fragmentDefinitionFor(receipt.capability, receipt.definitionVersion);
    if (!definition) {
      throw new Error("capability composition plan references an unavailable historical fragment");
    }
    return definition.materialization.operations.map((operation) => ({
      source: `capability:${receipt.capability}@${receipt.definitionVersion}`,
      operation,
    }));
  });
  return [
    ...baseOperations.map((operation) => ({
      source: `base:${input.base.key}@${input.base.definitionVersion}`,
      operation,
    })),
    ...fragmentOperations,
  ];
}

interface CapabilityCompositionOrderingEdge {
  readonly before: string;
  readonly after: string;
}

function capabilityCompositionOrderingEdges(
  sources: readonly CapabilityCompositionOperationSource[],
): readonly CapabilityCompositionOrderingEdge[] {
  const edges: CapabilityCompositionOrderingEdge[] = [];
  for (const { operation } of sources) {
    switch (operation.kind) {
      case "ensure_block_before":
        edges.push({ before: operation.block, after: operation.beforeBlock });
        break;
      case "ensure_block_between":
        for (const predecessor of operation.afterBlocks) {
          edges.push({ before: predecessor, after: operation.block });
        }
        // Optional predecessors are still structural ordering edges. A cycle
        // that only occurs when an optional block is enabled remains unsafe.
        for (const predecessor of operation.optionalAfterBlocks ?? []) {
          edges.push({ before: predecessor, after: operation.block });
        }
        edges.push({ before: operation.block, after: operation.beforeBlock });
        break;
      case "merge_block_params":
        break;
      default:
        failUnsupportedOperationKind(operation);
    }
  }
  return edges;
}

function assertAcyclicCapabilityCompositionOrdering(
  sources: readonly CapabilityCompositionOperationSource[],
): void {
  const successors = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const edge of capabilityCompositionOrderingEdges(sources)) {
    if (edge.before === edge.after) {
      throw new Error(`self-referential sealed composition ordering for ${edge.before}`);
    }
    nodes.add(edge.before);
    nodes.add(edge.after);
    const next = successors.get(edge.before) ?? new Set<string>();
    next.add(edge.after);
    successors.set(edge.before, next);
  }

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const visit = (node: string): void => {
    const prior = state.get(node);
    if (prior === "visited") return;
    if (prior === "visiting") {
      const cycleStart = stack.indexOf(node);
      throw new Error(
        `cyclic sealed composition ordering: ${[...stack.slice(cycleStart), node].join(" -> ")}`,
      );
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const successor of [...(successors.get(node) ?? [])].sort((left, right) => left.localeCompare(right))) {
      visit(successor);
    }
    stack.pop();
    state.set(node, "visited");
  };

  for (const node of [...nodes].sort((left, right) => left.localeCompare(right))) visit(node);
}

/**
 * Shared fail-closed relationship check for independently owned fragments.
 * Equal operations can co-exist; competing anchors, params, or bounded
 * override policies must be made explicit in a later versioned fragment.
 */
export function assertCapabilityCompositionOperationCompatibility(
  sources: readonly CapabilityCompositionOperationSource[],
): void {
  const placementByBlock = new Map<string, { source: string; operation: ChannelCompositionPipelineOperation }>();
  const parameterByTarget = new Map<string, { source: string; value: unknown }>();
  const numericOverrideByTarget = new Map<string, { source: string; value: unknown }>();

  for (const source of sources) {
    const operation = source.operation;
    // Normalize and validate the limited grammar before checking relationships.
    operationIdentity(operation);
    if (operation.kind === "ensure_block_before" || operation.kind === "ensure_block_between") {
      const prior = placementByBlock.get(operation.block);
      if (prior && canonicalJson(operationIdentity(prior.operation)) !== canonicalJson(operationIdentity(operation))) {
        throw new Error(
          `conflicting sealed composition anchors for ${operation.block}: ${prior.source} vs ${source.source}`,
        );
      }
      if (!prior) placementByBlock.set(operation.block, { source: source.source, operation });
      continue;
    }
    if (operation.kind === "merge_block_params") {
      for (const [key, value] of Object.entries(operation.params)) {
        const target = `${operation.block}\u0000${key}`;
        const prior = parameterByTarget.get(target);
        if (prior && canonicalJson(prior.value) !== canonicalJson(value)) {
          throw new Error(
            `conflicting sealed composition parameter ${operation.block}.${key}: ${prior.source} vs ${source.source}`,
          );
        }
        if (!prior) parameterByTarget.set(target, { source: source.source, value });
      }
      for (const override of operation.numericOverrides ?? []) {
        const target = `${operation.block}\u0000${override.key}`;
        const prior = numericOverrideByTarget.get(target);
        if (prior && canonicalJson(prior.value) !== canonicalJson(override)) {
          throw new Error(
            `conflicting sealed composition override ${operation.block}.${override.key}: ${prior.source} vs ${source.source}`,
          );
        }
        if (!prior) numericOverrideByTarget.set(target, { source: source.source, value: override });
      }
      continue;
    }
    failUnsupportedOperationKind(operation);
  }
  assertAcyclicCapabilityCompositionOrdering(sources);
}

function capabilityCompositionPlanOperations(input: {
  readonly base: ChannelCompositionReceipt;
  readonly fragments: readonly CapabilityCompositionFragmentReceipt[];
}): ChannelCompositionPipelineOperation[] {
  const sources = capabilityCompositionPlanOperationSources(input);
  assertCapabilityCompositionOperationCompatibility(sources);
  return sources.map(({ operation }) =>
    cloneMaterialization({ version: "channel-composition-operation-clone/v1", operations: [operation] }).operations[0]!,
  );
}

function capabilityCompositionPlanOperationsFingerprint(
  operations: readonly ChannelCompositionPipelineOperation[],
): string {
  return sha256Hex(canonicalJson(operations.map(operationIdentity)));
}

function channelCompositionPlanFingerprint(
  body: Omit<ChannelCompositionPlanReceipt, "fingerprint">,
): string {
  return sha256Hex(canonicalJson(body));
}

/**
 * Resolve a fresh plan from one base receipt plus independently versioned
 * selected-capability fragments. The creator never submits this object; it is
 * derived only after selections pass catalog eligibility. Separate automated
 * build/release gates remain authoritative for spend and publication.
 */
export function resolveChannelCapabilityCompositionPlan(input: {
  family: FamilyKey;
  selectedCapabilityKeys: readonly CreativeCapabilityKey[];
  /**
   * Current-catalog declaration supplied by creator/profile admission. Durable
   * historical plans are parsed separately and never re-resolved here.
   */
  expectedFragmentVersions: Readonly<Record<string, string>>;
}): ChannelCompositionPlanReceipt {
  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys) as CreativeCapabilityKey[];
  if (!selectedCapabilityKeys.length) {
    throw new Error("capability composition plans require at least one selected capability");
  }
  assertExpectedCapabilityFragmentVersionBindings({
    selectedCapabilityKeys,
    expectedFragmentVersions: input.expectedFragmentVersions,
  });
  const base = resolveCertifiedChannelComposition({
    family: input.family,
    selectedCapabilityKeys: [],
  });
  const fragmentDefinitions = selectedCapabilityKeys.map((capability) => {
    const definition = currentFragmentDefinitionFor(input.family, capability);
    if (!definition) {
      throw new Error(
        `no certified capability composition fragment is registered for ${input.family}/${capability}`,
      );
    }
    const expectedFragmentVersion = input.expectedFragmentVersions[capability];
    if (definition.definitionVersion !== expectedFragmentVersion) {
      throw new Error(
        `capability composition fragment ${capability} resolves ${definition.definitionVersion} but the declared fragment version is ${expectedFragmentVersion}`,
      );
    }
    return definition;
  });
  assertCapabilityCompositionFragmentSelectionCompatibility({
    selectedCapabilityKeys,
    fragments: fragmentDefinitions,
  });
  const fragments = fragmentDefinitions.map(fragmentReceiptFor);
  const operations = capabilityCompositionPlanOperations({ base, fragments });
  const body: Omit<ChannelCompositionPlanReceipt, "fingerprint"> = {
    version: CHANNEL_COMPOSITION_PLAN_VERSION,
    family: input.family,
    base,
    fragments,
    selectedCapabilityKeys,
    operationsFingerprint: capabilityCompositionPlanOperationsFingerprint(operations),
  };
  return { ...body, fingerprint: channelCompositionPlanFingerprint(body) };
}

/** Parse and validate a persisted plan against its immutable base/fragment rows. */
export function parseChannelCapabilityCompositionPlan(value: unknown): ChannelCompositionPlanReceipt {
  const plan = ChannelCompositionPlanReceiptSchema.parse(value) as ChannelCompositionPlanReceipt;
  const base = parseChannelCompositionReceipt(plan.base);
  if (base.family !== plan.family) {
    throw new Error("capability composition plan base family does not match the plan family");
  }
  assertPersistedChannelCompositionReceiptBinding({
    receipt: base,
    family: plan.family,
    selectedCapabilityKeys: [],
  });
  const selectedCapabilityKeys = normalizedCapabilityKeys(plan.selectedCapabilityKeys) as CreativeCapabilityKey[];
  if (canonicalJson(selectedCapabilityKeys) !== canonicalJson(plan.selectedCapabilityKeys)) {
    throw new Error("capability composition plan capability keys must be sorted and unique");
  }
  if (!selectedCapabilityKeys.length) {
    throw new Error("capability composition plan must select at least one capability");
  }
  const fragments = plan.fragments.map(parseCapabilityCompositionFragmentReceipt);
  if (
    fragments.length !== selectedCapabilityKeys.length ||
    canonicalJson(fragments.map((fragment) => fragment.capability)) !== canonicalJson(selectedCapabilityKeys)
  ) {
    throw new Error("capability composition plan fragments do not exactly match its selected capabilities");
  }
  const fragmentDefinitions: CapabilityCompositionFragmentDefinition[] = [];
  for (const fragment of fragments) {
    const definition = fragmentDefinitionFor(fragment.capability, fragment.definitionVersion);
    if (!definition || definition.family !== plan.family) {
      throw new Error("capability composition plan fragment family does not match the plan family");
    }
    fragmentDefinitions.push(definition);
  }
  // These constraints are part of each fragment's immutable definition
  // fingerprint. Re-check them while parsing a persisted plan, rather than
  // assuming every durable row was originally written by the current creator
  // admission path. Otherwise a re-fingerprinted malformed plan could omit a
  // required fragment (or retain an incompatible pair) on retry.
  assertCapabilityCompositionFragmentSelectionCompatibility({
    selectedCapabilityKeys,
    fragments: fragmentDefinitions,
  });
  const operations = capabilityCompositionPlanOperations({ base, fragments });
  const expectedBody: Omit<ChannelCompositionPlanReceipt, "fingerprint"> = {
    version: CHANNEL_COMPOSITION_PLAN_VERSION,
    family: plan.family,
    base,
    fragments,
    selectedCapabilityKeys,
    operationsFingerprint: capabilityCompositionPlanOperationsFingerprint(operations),
  };
  if (plan.operationsFingerprint !== expectedBody.operationsFingerprint) {
    throw new Error("capability composition plan operations fingerprint does not match its sealed fragments");
  }
  const expected = { ...expectedBody, fingerprint: channelCompositionPlanFingerprint(expectedBody) };
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error("capability composition plan does not match its sealed historical definitions");
  }
  return expected;
}

/** Current admission must use the exact freshly resolved base + fragment plan. */
export function assertCurrentChannelCapabilityCompositionPlanBinding(input: {
  plan: unknown;
  family: FamilyKey;
  /** Receipt codecs keep durable keys as strings; resolution remains fail-closed. */
  selectedCapabilityKeys: readonly string[];
  /** Current creator/profile catalog declaration required at admission. */
  expectedFragmentVersions: Readonly<Record<string, string>>;
}): ChannelCompositionPlanReceipt {
  const plan = parseChannelCapabilityCompositionPlan(input.plan);
  const expected = resolveChannelCapabilityCompositionPlan({
    family: input.family,
    selectedCapabilityKeys: input.selectedCapabilityKeys as readonly CreativeCapabilityKey[],
    expectedFragmentVersions: input.expectedFragmentVersions,
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error("capability composition plan does not match the admitted channel route");
  }
  return expected;
}

/** Persisted plans retain their historical fragment versions but never their key set. */
export function assertPersistedChannelCapabilityCompositionPlanBinding(input: {
  plan: unknown;
  family: FamilyKey;
  selectedCapabilityKeys: readonly string[];
}): ChannelCompositionPlanReceipt {
  const plan = parseChannelCapabilityCompositionPlan(input.plan);
  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys);
  if (
    plan.family !== input.family ||
    canonicalJson(plan.selectedCapabilityKeys) !== canonicalJson(selectedCapabilityKeys)
  ) {
    throw new Error("capability composition plan does not match the persisted selected capabilities");
  }
  return plan;
}

/** Return a defensive copy of every exact operation a plan seals. */
export function capabilityCompositionPlanMaterialization(
  plan: ChannelCompositionPlanReceipt,
): ChannelCompositionMaterialization {
  const parsed = parseChannelCapabilityCompositionPlan(plan);
  return {
    version: `${CHANNEL_COMPOSITION_PLAN_VERSION}/materialization`,
    operations: capabilityCompositionPlanOperations({
      base: parsed.base,
      fragments: parsed.fragments,
    }),
  };
}

/** Structural parser for the one composition authority a new profile may carry. */
export function parseChannelCompositionBinding(value: unknown): ChannelCompositionBinding {
  const binding = ChannelCompositionBindingSchema.parse(value) as ChannelCompositionBinding;
  if (binding.kind === "exact_catalog_v1") {
    return { kind: binding.kind, receipt: parseChannelCompositionReceipt(binding.receipt) };
  }
  return { kind: binding.kind, plan: parseChannelCapabilityCompositionPlan(binding.plan) };
}

/** Minimal V8-safe shape shared by Show Profile compatibility gates. */
export interface ChannelCompositionPipelineEntry {
  readonly block: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

function exactPipelineEntryIndex(
  pipeline: readonly ChannelCompositionPipelineEntry[],
  block: string,
  operation: ChannelCompositionPipelineOperation,
): number {
  const indexes = pipeline
    .map((entry, index) => entry.block === block ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires exactly one ${block} block; found ${indexes.length}`,
    );
  }
  return indexes[0]!;
}

function optionalPipelineEntryIndex(
  pipeline: readonly ChannelCompositionPipelineEntry[],
  block: string,
  operation: ChannelCompositionPipelineOperation,
): number | undefined {
  const indexes = pipeline
    .map((entry, index) => entry.block === block ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) {
    throw new Error(
      `certified composition operation ${operation.kind} requires at most one optional ${block} block; found ${indexes.length}`,
    );
  }
  return indexes[0];
}

function assertOperationCompatibility(
  pipeline: readonly ChannelCompositionPipelineEntry[],
  operation: ChannelCompositionPipelineOperation,
): void {
  switch (operationKind(operation)) {
    case "ensure_block_before": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_before" }>;
      const target = exactPipelineEntryIndex(pipeline, ordered.block, ordered);
      const anchor = exactPipelineEntryIndex(pipeline, ordered.beforeBlock, ordered);
      if (target >= anchor) {
        throw new Error(
          `certified composition operation ${ordered.kind} requires ${ordered.block} before ${ordered.beforeBlock}`,
        );
      }
      return;
    }
    case "ensure_block_between": {
      const ordered = operation as Extract<ChannelCompositionPipelineOperation, { kind: "ensure_block_between" }>;
      const target = exactPipelineEntryIndex(pipeline, ordered.block, ordered);
      const anchor = exactPipelineEntryIndex(pipeline, ordered.beforeBlock, ordered);
      if (target >= anchor) {
        throw new Error(
          `certified composition operation ${ordered.kind} requires ${ordered.block} before ${ordered.beforeBlock}`,
        );
      }
      for (const predecessor of ordered.afterBlocks) {
        const predecessorIndex = exactPipelineEntryIndex(pipeline, predecessor, ordered);
        if (predecessorIndex >= target) {
          throw new Error(
            `certified composition operation ${ordered.kind} requires ${predecessor} before ${ordered.block}`,
          );
        }
      }
      for (const predecessor of ordered.optionalAfterBlocks ?? []) {
        const predecessorIndex = optionalPipelineEntryIndex(pipeline, predecessor, ordered);
        if (predecessorIndex !== undefined && predecessorIndex >= target) {
          throw new Error(
            `certified composition operation ${ordered.kind} requires optional ${predecessor} before ${ordered.block} when present`,
          );
        }
      }
      return;
    }
    case "merge_block_params": {
      const merged = operation as Extract<ChannelCompositionPipelineOperation, { kind: "merge_block_params" }>;
      const index = exactPipelineEntryIndex(pipeline, merged.block, merged);
      const params = pipeline[index]!.params;
      for (const [key, expected] of Object.entries(merged.params)) {
        if (!params || canonicalJson(params[key]) !== canonicalJson(expected)) {
          throw new Error(
            `certified composition operation ${merged.kind} has incomplete effective pipeline evidence at ${merged.block}.${key}`,
          );
        }
      }
      for (const override of merged.numericOverrides ?? []) {
        const value = params?.[override.key];
        if (value === undefined) continue;
        const numeric = Number(value);
        if (
          !Number.isFinite(numeric) ||
          numeric < override.minimum ||
          numeric > override.maximum ||
          (override.integer === true && !Number.isInteger(numeric))
        ) {
          throw new Error(
            `certified composition operation ${merged.kind} has invalid bounded override ${merged.block}.${override.key}`,
          );
        }
      }
      return;
    }
    default:
      return failUnsupportedOperationKind(operation);
  }
}

/**
 * Checks that a persisted/frozen executable graph still honors every order and
 * parameter invariant sealed into its receipt's materialization. This never
 * materializes or repairs a later graph: a drifted graph is rejected rather
 * than silently mutated after approval.
 */
export function assertCertifiedChannelCompositionPipelineCompatibility(input: {
  receipt: unknown;
  pipeline: readonly ChannelCompositionPipelineEntry[];
}): ChannelCompositionReceipt {
  const receipt = parseChannelCompositionReceipt(input.receipt);
  const materialization = certifiedChannelCompositionMaterialization(receipt);
  for (const operation of materialization?.operations ?? []) {
    assertOperationCompatibility(input.pipeline, operation);
  }
  if (
    receipt.key === "source_attributed_data_story" &&
    receipt.definitionVersion === "v2"
  ) {
    assertOperationCompatibility(
      input.pipeline,
      SOURCE_ATTRIBUTED_DATA_STORY_V2_PERSISTED_ORDER_COMPATIBILITY,
    );
  }
  return receipt;
}

/**
 * Plans are validated against the same immutable order/parameter grammar as
 * legacy receipts. This only rejects drift; it never re-materializes a later
 * architect refinement or creates a new execution path.
 */
export function assertChannelCapabilityCompositionPlanPipelineCompatibility(input: {
  plan: unknown;
  pipeline: readonly ChannelCompositionPipelineEntry[];
}): ChannelCompositionPlanReceipt {
  const plan = parseChannelCapabilityCompositionPlan(input.plan);
  const materialization = capabilityCompositionPlanMaterialization(plan);
  for (const operation of materialization.operations) {
    assertOperationCompatibility(input.pipeline, operation);
  }
  return plan;
}

/**
 * Validates a persisted historical receipt against its own immutable
 * definition. New admission still uses the exact-current binding below; this
 * compatibility form prevents a v1 receipt from being invalidated merely
 * because a newer definition version became current.
 */
export function assertPersistedChannelCompositionReceiptBinding(input: {
  receipt: unknown;
  family: FamilyKey;
  selectedCapabilityKeys: readonly string[];
}): ChannelCompositionReceipt {
  const receipt = parseChannelCompositionReceipt(input.receipt);
  const definition = definitionFor(receipt.key, receipt.definitionVersion);
  if (!definition || definition.family !== input.family || receipt.family !== input.family) {
    throw new Error("channel composition receipt does not match the persisted channel family");
  }
  const selectedCapabilityKeys = normalizedCapabilityKeys(input.selectedCapabilityKeys);
  const requiredCapabilityKeys = normalizedCapabilityKeys(definition.requiredCapabilityKeys);
  if (canonicalJson(selectedCapabilityKeys) !== canonicalJson(requiredCapabilityKeys)) {
    throw new Error("channel composition receipt does not match the persisted selected capabilities");
  }
  return receipt;
}

/**
 * Bind a persisted receipt to the already-validated profile inputs. This owns
 * no capability eligibility or pipeline rules; those remain in their existing
 * catalogs and are checked by the caller before or alongside this receipt.
 */
export function assertChannelCompositionReceiptBinding(input: {
  receipt: unknown;
  family: FamilyKey;
  selectedCapabilityKeys: readonly string[];
}): ChannelCompositionReceipt {
  const receipt = parseChannelCompositionReceipt(input.receipt);
  const expected = resolveCertifiedChannelComposition({
    family: input.family,
    selectedCapabilityKeys: input.selectedCapabilityKeys,
  });
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new Error("channel composition receipt does not match the admitted channel route");
  }
  return expected;
}

/** Read-only catalog metadata for creator presentation; never execution authority. */
export function certifiedChannelCompositionDefinition(
  receipt: ChannelCompositionReceipt,
): Pick<ChannelCompositionDefinition, "key" | "definitionVersion" | "title" | "qualityFocus"> {
  const parsed = parseChannelCompositionReceipt(receipt);
  const definition = definitionFor(parsed.key, parsed.definitionVersion);
  if (!definition || definition.family !== parsed.family) {
    throw new Error("channel composition receipt does not name a certified historical definition");
  }
  return {
    key: parsed.key,
    definitionVersion: parsed.definitionVersion,
    title: parsed.title,
    qualityFocus: [...parsed.qualityFocus],
  };
}
