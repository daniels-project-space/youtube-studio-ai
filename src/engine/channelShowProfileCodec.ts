/**
 * Convex-safe receipt codec for the durable Channel Show Profile.
 *
 * It deliberately avoids the rich renderer/provider capability registry. It
 * validates the receipt's immutable structure plus its pinned, pure V8-safe
 * capability, family, and pipeline-obligation spine. Full registry validation
 * remains in `channelShowProfile.ts` at admission and before provider-capable
 * pipeline runs.
 */
import { z } from "zod";

import {
  CREATIVE_CAPABILITY_RECEIPT_CATALOG_FINGERPRINT,
  assertCreativeCapabilityReceiptPipelineObligations,
  assertCreativeCapabilityReceiptSelection,
  type CreativeCapabilityReceiptPipelineEntry,
} from "@/engine/creative/creativeCapabilityReceiptCatalog";
import {
  assertChannelCompositionReceiptBinding,
  assertCertifiedChannelCompositionPipelineCompatibility,
  assertPersistedChannelCompositionReceiptBinding,
  parseChannelCompositionReceipt,
  type ChannelCompositionReceipt,
} from "@/engine/channelCompositionCatalog";
import {
  assertCanonicalChannelProgramBrief,
  briefToCreativeCapabilityIntent,
  channelProgramBriefFingerprint,
} from "@/engine/channelProgramBrief";
import {
  resolveChannelFamilyManifest,
  type ChannelFamilyManifest,
} from "@/engine/channelFamilyManifest";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CHANNEL_SHOW_PROFILE_VERSION = "channel-show-profile/v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface ChannelShowProfile {
  version: typeof CHANNEL_SHOW_PROFILE_VERSION;
  programBriefFingerprint: string;
  familyManifestFingerprint: string;
  contentLaneFingerprint: string;
  creativeCapabilityCatalogFingerprint: string;
  selectedCapabilityKeys: readonly string[];
  /**
   * Present on receipts created after the certified-composition catalog was
   * introduced. It stays optional solely so historical channels can be read
   * and upgraded by their next exact new-channel admission.
   */
  composition?: ChannelCompositionReceipt;
  designedPipelineFingerprint: string;
  fingerprint: string;
}

type ChannelShowProfileBody = Omit<ChannelShowProfile, "fingerprint">;

export interface AssertChannelShowProfileReceiptProgramBindingInput {
  profile: unknown;
  programBrief: unknown;
}

export interface AssertChannelShowProfileReceiptPipelineCompatibilityInput
  extends AssertChannelShowProfileReceiptProgramBindingInput {
  pipeline: unknown;
}

const ChannelShowProfileSchema = z.object({
  version: z.literal(CHANNEL_SHOW_PROFILE_VERSION),
  programBriefFingerprint: z.string().regex(SHA256_PATTERN),
  familyManifestFingerprint: z.string().regex(SHA256_PATTERN),
  contentLaneFingerprint: z.string().regex(SHA256_PATTERN),
  creativeCapabilityCatalogFingerprint: z.string().min(1).max(512),
  selectedCapabilityKeys: z.array(z.string().min(1).max(160)),
  composition: z.unknown().optional(),
  designedPipelineFingerprint: z.string().regex(SHA256_PATTERN),
  fingerprint: z.string().regex(SHA256_PATTERN),
}).strict();

function profileFingerprint(body: ChannelShowProfileBody): string {
  return sha256Hex(canonicalJson(body));
}

function familyManifestIdentity(manifest: ChannelFamilyManifest) {
  return {
    version: manifest.version,
    family: manifest.family.key,
    archetype: manifest.archetype.key,
    duration: manifest.duration,
    contentLane: manifest.contentLane.key,
    contentLanePolicy: manifest.contentLanePolicy.key,
  };
}

function contentLaneIdentity(manifest: ChannelFamilyManifest) {
  const policy = manifest.contentLanePolicy;
  return {
    contentLane: manifest.contentLane.key,
    policy: {
      key: policy.key,
      family: policy.family ?? null,
      primaryRenderer: policy.primaryRenderer,
      requiredBlocks: policy.requiredBlocks,
      requiredRendererChains: policy.requiredRendererChains ?? [],
      rendererChainGuards: policy.rendererChainGuards ?? [],
      forbiddenRendererBlocks: policy.forbiddenRendererBlocks,
      forbiddenBlocks: policy.forbiddenBlocks ?? [],
    },
  };
}

function parsePipeline(value: unknown): CreativeCapabilityReceiptPipelineEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("channel show profile pipeline must be an array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`channel show profile pipeline entry ${index} is invalid`);
    }
    const candidate = entry as { block?: unknown; params?: unknown };
    if (typeof candidate.block !== "string" || !candidate.block.trim()) {
      throw new Error(`channel show profile pipeline entry ${index} has an invalid block`);
    }
    if (
      candidate.params !== undefined &&
      (!candidate.params || typeof candidate.params !== "object" || Array.isArray(candidate.params))
    ) {
      throw new Error(`channel show profile pipeline entry ${index} has invalid params`);
    }
    return {
      block: candidate.block,
      ...(candidate.params === undefined
        ? {}
        : { params: candidate.params as Readonly<Record<string, unknown>> }),
    };
  });
}

/**
 * v1 source-data receipts predate declarative operation materialization. They
 * remain readable for retry, but a later refiner may not alter their sealed
 * graph because there is no v1 operation list against which to prove a safe
 * refinement. Newer definitions carry their own narrower compatibility rules.
 */
export function assertHistoricalSourceDataStoryPipelineBaseline(
  profile: Pick<ChannelShowProfile, "composition" | "designedPipelineFingerprint">,
  pipeline: readonly CreativeCapabilityReceiptPipelineEntry[],
): void {
  if (
    profile.composition?.key === "source_attributed_data_story" &&
    profile.composition.definitionVersion === "v1" &&
    profile.designedPipelineFingerprint !== sha256Hex(canonicalJson(pipeline))
  ) {
    throw new Error(
      "historical v1 source-attributed data-story profile must retain its exact admitted pipeline baseline",
    );
  }
}

/**
 * Parse only the receipt-level invariant needed by Convex persistence. Do not
 * use this in a creator or execution admission path: `parseChannelShowProfile`
 * additionally pins the live catalog and known capability keys.
 */
export function parseChannelShowProfileReceipt(value: unknown): ChannelShowProfile {
  const profile = ChannelShowProfileSchema.parse(value) as ChannelShowProfile;
  const selectedCapabilityKeys = [...profile.selectedCapabilityKeys];
  for (let index = 0; index < selectedCapabilityKeys.length; index += 1) {
    if (index > 0 && selectedCapabilityKeys[index - 1]! >= selectedCapabilityKeys[index]!) {
      throw new Error("channel show profile capability keys must be sorted and unique");
    }
  }
  const composition = profile.composition === undefined
    ? undefined
    : parseChannelCompositionReceipt(profile.composition);
  const body: ChannelShowProfileBody = {
    version: profile.version,
    programBriefFingerprint: profile.programBriefFingerprint,
    familyManifestFingerprint: profile.familyManifestFingerprint,
    contentLaneFingerprint: profile.contentLaneFingerprint,
    creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
    selectedCapabilityKeys,
    ...(composition ? { composition } : {}),
    designedPipelineFingerprint: profile.designedPipelineFingerprint,
  };
  if (profile.fingerprint !== profileFingerprint(body)) {
    throw new Error("channel show profile fingerprint does not match its canonical composition");
  }
  return { ...body, fingerprint: profile.fingerprint };
}

/**
 * Convex-safe semantic validation for the immutable profile/program binding.
 * It deliberately excludes the executable renderer registry while retaining
 * the program, family/lane, catalog, and capability-admission invariants.
 */
export function assertChannelShowProfileReceiptProgramBinding(
  input: AssertChannelShowProfileReceiptProgramBindingInput,
): ChannelShowProfile {
  const profile = parseChannelShowProfileReceipt(input.profile);
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const manifest = resolveChannelFamilyManifest(programBrief.family);
  if (profile.programBriefFingerprint !== channelProgramBriefFingerprint(programBrief)) {
    throw new Error("channel show profile does not match the canonical channel program brief");
  }
  if (
    profile.familyManifestFingerprint !==
    sha256Hex(canonicalJson(familyManifestIdentity(manifest)))
  ) {
    throw new Error("channel show profile does not match the current channel family manifest");
  }
  if (
    profile.contentLaneFingerprint !==
    sha256Hex(canonicalJson(contentLaneIdentity(manifest)))
  ) {
    throw new Error("channel show profile does not match the current content-lane policy");
  }
  if (
    profile.creativeCapabilityCatalogFingerprint !==
    CREATIVE_CAPABILITY_RECEIPT_CATALOG_FINGERPRINT
  ) {
    throw new Error("channel show profile uses a stale creative-capability catalog fingerprint");
  }
  const intent = briefToCreativeCapabilityIntent(programBrief);
  for (const capability of profile.selectedCapabilityKeys) {
    assertCreativeCapabilityReceiptSelection({
      capability,
      family: programBrief.family,
      intent,
    });
  }
  if (profile.composition) {
    assertPersistedChannelCompositionReceiptBinding({
      receipt: profile.composition,
      family: programBrief.family,
      selectedCapabilityKeys: profile.selectedCapabilityKeys,
    });
  }
  return profile;
}

/**
 * Database-write counterpart to the pre-spend Show Profile gate. It rejects a
 * pipeline that drops a receipt-selected capability before the bad state can
 * become durable, while keeping Convex away from renderer/provider imports.
 */
export function assertChannelShowProfileReceiptPipelineCompatibility(
  input: AssertChannelShowProfileReceiptPipelineCompatibilityInput,
): ChannelShowProfile {
  const profile = assertChannelShowProfileReceiptProgramBinding(input);
  const pipeline = parsePipeline(input.pipeline);
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const definitions = profile.selectedCapabilityKeys.map((capability) =>
    assertCreativeCapabilityReceiptSelection({
      capability,
      family: programBrief.family,
      intent: briefToCreativeCapabilityIntent(programBrief),
    }),
  );
  assertCreativeCapabilityReceiptPipelineObligations(definitions, pipeline);
  if (profile.composition) {
    assertCertifiedChannelCompositionPipelineCompatibility({
      receipt: profile.composition,
      pipeline,
    });
  }
  assertHistoricalSourceDataStoryPipelineBaseline(profile, pipeline);
  return profile;
}

/**
 * A newly admitted channel must bind to the route selected by the live
 * capability catalog. Historical receipt binding is intentionally reserved
 * for an already-persisted identity retry or compatible pipeline update.
 */
function assertCurrentChannelShowProfileCompositionBinding(
  profile: ChannelShowProfile,
  programBrief: unknown,
): void {
  if (!profile.composition) return;
  const canonicalProgramBrief = assertCanonicalChannelProgramBrief(programBrief);
  assertChannelCompositionReceiptBinding({
    receipt: profile.composition,
    family: canonicalProgramBrief.family,
    selectedCapabilityKeys: profile.selectedCapabilityKeys,
  });
}

/**
 * New-channel admission must additionally seal the receipt to the exact
 * compiler baseline. Later architect refinements use the compatibility-only
 * assertion above, which intentionally permits safe non-capability changes.
 */
export function assertChannelShowProfileReceiptExactComposition(
  input: AssertChannelShowProfileReceiptPipelineCompatibilityInput,
): ChannelShowProfile {
  const profile = assertChannelShowProfileReceiptPipelineCompatibility(input);
  const pipeline = parsePipeline(input.pipeline);
  assertCurrentChannelShowProfileCompositionBinding(profile, input.programBrief);
  if (profile.designedPipelineFingerprint !== sha256Hex(canonicalJson(pipeline))) {
    throw new Error("channel show profile does not match the admitted channel composition");
  }
  return profile;
}

export function channelShowProfileReceiptFingerprint(value: unknown): string {
  return parseChannelShowProfileReceipt(value).fingerprint;
}
