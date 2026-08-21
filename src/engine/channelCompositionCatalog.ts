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

/** Catalog bookkeeping only; receipts never use a whole-catalog fingerprint. */
export const CHANNEL_COMPOSITION_CATALOG_VERSION = "certified-channel-composition-catalog/v4" as const;
export const CHANNEL_COMPOSITION_RECEIPT_VERSION = "certified-channel-composition-receipt/v2" as const;

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
const SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION = {
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
    status: "current",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
    materialization: SOURCE_ATTRIBUTED_DATA_STORY_V3_MATERIALIZATION,
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
