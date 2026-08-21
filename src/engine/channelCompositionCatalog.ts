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
import type { FamilyKey } from "./families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Catalog bookkeeping only; receipts never use a whole-catalog fingerprint. */
export const CHANNEL_COMPOSITION_CATALOG_VERSION = "certified-channel-composition-catalog/v2" as const;
export const CHANNEL_COMPOSITION_RECEIPT_VERSION = "certified-channel-composition-receipt/v2" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

interface ChannelCompositionDefinition {
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
}

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
    status: "current",
    family: "narrated_stock",
    title: "Source-attributed data story",
    qualityFocus: ["named sources", "spoken numeric anchors", "readable chart progression", "causal comparison"],
    requiredCapabilityKeys: ["source_attributed_data_story"],
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
type HistoricalCompositionDefinition = (typeof CHANNEL_COMPOSITION_DEFINITION_HISTORY)[number];

function definitionIdentity(definition: ChannelCompositionDefinition) {
  return {
    key: definition.key,
    definitionVersion: definition.definitionVersion,
    family: definition.family,
    title: definition.title,
    qualityFocus: [...definition.qualityFocus],
    requiredCapabilityKeys: [...definition.requiredCapabilityKeys],
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

function normalizedCapabilityKeys(keys: readonly string[]): readonly string[] {
  return [...new Set(keys)].sort((left, right) => left.localeCompare(right));
}

function matchingCompositionDefinition(input: {
  family: FamilyKey;
  selectedCapabilityKeys?: readonly string[];
}): HistoricalCompositionDefinition | undefined {
  const selectedCapabilityKeys = new Set(normalizedCapabilityKeys(input.selectedCapabilityKeys ?? []));
  return CERTIFIED_CHANNEL_COMPOSITIONS
    .filter((candidate) => candidate.family === input.family)
    .filter((candidate) => candidate.requiredCapabilityKeys.every((key) => selectedCapabilityKeys.has(key)))
    .sort((left, right) =>
      right.requiredCapabilityKeys.length - left.requiredCapabilityKeys.length ||
      left.key.localeCompare(right.key) ||
      right.definitionVersion.localeCompare(left.definitionVersion),
    )[0];
}

/**
 * Resolve only an already-admitted composition. More specific, capability
 * qualified routes win over their family's default route deterministically.
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
