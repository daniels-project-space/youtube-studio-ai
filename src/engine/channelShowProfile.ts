/**
 * Immutable creative-composition identity for an admitted channel.
 *
 * A Program Brief answers what the creator is making. This profile answers
 * which current family/lane/capability composition turns that brief into a
 * repeatable show. It deliberately stores compact fingerprints instead of
 * copying registry definitions or freezing the final architect-refined
 * executable pipeline.
 */
import {
  CREATIVE_CAPABILITY_CATALOG,
  CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  assertResolvedCreativeCapabilityPipelineObligations,
  type CreativeCapabilityKey,
  type CreativeCapabilitySelection,
  validateCreativeCapabilitySelections,
} from "@/engine/creative/creativeCapabilityCatalog";
import {
  assertCanonicalChannelProgramBrief,
  briefToCreativeCapabilityIntent,
  channelProgramBriefFingerprint,
} from "@/engine/channelProgramBrief";
import {
  assertCertifiedChannelCompositionPipelineCompatibility,
  assertPersistedChannelCompositionReceiptBinding,
  findCertifiedChannelComposition,
} from "@/engine/channelCompositionCatalog";
import { resolveChannelFamilyManifest, type ChannelFamilyManifest } from "@/engine/channelFamilyManifest";
import type { PipelineEntry } from "@/engine/types";
import {
  CHANNEL_SHOW_PROFILE_VERSION,
  assertHistoricalSourceDataStoryPipelineBaseline,
  parseChannelShowProfileReceipt,
  type ChannelShowProfile as ChannelShowProfileReceipt,
} from "@/engine/channelShowProfileCodec";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export { CHANNEL_SHOW_PROFILE_VERSION } from "@/engine/channelShowProfileCodec";

/**
 * Catalog-aware profile type used by the creator/execution engine. Convex uses
 * the compact receipt codec because it must not import this renderer/provider
 * registry.
 */
export interface ChannelShowProfile extends Omit<ChannelShowProfileReceipt, "selectedCapabilityKeys"> {
  selectedCapabilityKeys: readonly CreativeCapabilityKey[];
}

export interface CreateChannelShowProfileInput {
  programBrief: unknown;
  capabilitySelections?: unknown;
  /** Effective compiler output, including enforced selected-capability obligations. */
  pipeline: readonly Pick<PipelineEntry, "block" | "params">[];
}

export interface AssertChannelShowProfileInput extends CreateChannelShowProfileInput {
  profile: unknown;
}

export interface AssertChannelShowProfileProgramBindingInput {
  profile: unknown;
  programBrief: unknown;
}

export interface AssertChannelShowProfilePipelineCompatibilityInput
  extends AssertChannelShowProfileProgramBindingInput {
  pipeline: readonly Pick<PipelineEntry, "block" | "params">[];
}

type ChannelShowProfileBody = Omit<ChannelShowProfile, "fingerprint">;

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

function assertSortedUniqueCapabilityKeys(keys: readonly string[]): CreativeCapabilityKey[] {
  const normalized = [...keys] as CreativeCapabilityKey[];
  for (let index = 0; index < normalized.length; index += 1) {
    const key = normalized[index]!;
    if (!CREATIVE_CAPABILITY_CATALOG.some((definition) => definition.capability === key)) {
      throw new Error(`channel show profile contains unknown creative capability ${key}`);
    }
    if (index > 0 && normalized[index - 1]! >= key) {
      throw new Error("channel show profile capability keys must be sorted and unique");
    }
  }
  return normalized;
}

function profileBody(input: CreateChannelShowProfileInput): ChannelShowProfileBody {
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const manifest = resolveChannelFamilyManifest(programBrief.family);
  if (manifest.family.key !== programBrief.family || manifest.contentLane.family !== programBrief.family) {
    throw new Error("channel show profile family manifest does not match the canonical program brief");
  }
  const resolvedSelections = validateCreativeCapabilitySelections({
    family: programBrief.family,
    selections: input.capabilitySelections,
    intent: briefToCreativeCapabilityIntent(programBrief),
  });
  assertResolvedCreativeCapabilityPipelineObligations(resolvedSelections, input.pipeline);
  const selectedCapabilityKeys = resolvedSelections
    .map(({ selection }) => selection.capability)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const composition = findCertifiedChannelComposition({
    family: programBrief.family,
    selectedCapabilityKeys,
  });
  return {
    version: CHANNEL_SHOW_PROFILE_VERSION,
    programBriefFingerprint: channelProgramBriefFingerprint(programBrief),
    familyManifestFingerprint: sha256Hex(canonicalJson(familyManifestIdentity(manifest))),
    contentLaneFingerprint: sha256Hex(canonicalJson(contentLaneIdentity(manifest))),
    creativeCapabilityCatalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
    selectedCapabilityKeys,
    ...(composition ? { composition } : {}),
    designedPipelineFingerprint: sha256Hex(canonicalJson(input.pipeline)),
  };
}

/**
 * Validate the static program/family/lane side before an inception plan has a
 * compiler output available. The executor later calls assertChannelShowProfile
 * to bind the same profile to selections and the exact baseline pipeline.
 */
export function assertChannelShowProfileProgramBinding(
  input: AssertChannelShowProfileProgramBindingInput,
): ChannelShowProfile {
  const profile = parseChannelShowProfile(input.profile);
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const manifest = resolveChannelFamilyManifest(programBrief.family);
  if (profile.programBriefFingerprint !== channelProgramBriefFingerprint(programBrief)) {
    throw new Error("channel show profile does not match the canonical program brief");
  }
  if (profile.familyManifestFingerprint !== sha256Hex(canonicalJson(familyManifestIdentity(manifest)))) {
    throw new Error("channel show profile does not match the current channel family manifest");
  }
  if (profile.contentLaneFingerprint !== sha256Hex(canonicalJson(contentLaneIdentity(manifest)))) {
    throw new Error("channel show profile does not match the current content-lane policy");
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
 * A final architect-refined pipeline need not equal the baseline fingerprint,
 * but it may never shed the selected capability obligations that define the
 * show. This is the generic pipeline-edit guard.
 */
export function assertChannelShowProfilePipelineCompatibility(
  input: AssertChannelShowProfilePipelineCompatibilityInput,
): ChannelShowProfile {
  const profile = assertChannelShowProfileProgramBinding(input);
  const programBrief = assertCanonicalChannelProgramBrief(input.programBrief);
  const selections: CreativeCapabilitySelection[] = profile.selectedCapabilityKeys.map((capability) => ({
    capability,
    catalogFingerprint: CREATIVE_CAPABILITY_CATALOG_FINGERPRINT,
  }));
  const resolvedSelections = validateCreativeCapabilitySelections({
    family: programBrief.family,
    selections,
    intent: briefToCreativeCapabilityIntent(programBrief),
  });
  assertResolvedCreativeCapabilityPipelineObligations(resolvedSelections, input.pipeline);
  if (profile.composition) {
    assertCertifiedChannelCompositionPipelineCompatibility({
      receipt: profile.composition,
      pipeline: input.pipeline,
    });
  }
  assertHistoricalSourceDataStoryPipelineBaseline(profile, input.pipeline);
  return profile;
}

function profileFingerprint(body: ChannelShowProfileBody): string {
  return sha256Hex(canonicalJson(body));
}

/**
 * Resolve the current catalog-backed composition and seal it to the exact
 * compiler output. This is provider-free and must run before any durable
 * channel identity or paid pipeline admission is written.
 */
export function createChannelShowProfile(input: CreateChannelShowProfileInput): ChannelShowProfile {
  const body = profileBody(input);
  return {
    ...body,
    fingerprint: profileFingerprint(body),
  };
}

/** Strict structural parser for a persisted composition receipt. */
export function parseChannelShowProfile(value: unknown): ChannelShowProfile {
  const profile = parseChannelShowProfileReceipt(value);
  if (profile.creativeCapabilityCatalogFingerprint !== CREATIVE_CAPABILITY_CATALOG_FINGERPRINT) {
    throw new Error("channel show profile uses a stale creative-capability catalog fingerprint");
  }
  const selectedCapabilityKeys = assertSortedUniqueCapabilityKeys(profile.selectedCapabilityKeys);
  const body: ChannelShowProfileBody = {
    version: profile.version,
    programBriefFingerprint: profile.programBriefFingerprint,
    familyManifestFingerprint: profile.familyManifestFingerprint,
    contentLaneFingerprint: profile.contentLaneFingerprint,
    creativeCapabilityCatalogFingerprint: profile.creativeCapabilityCatalogFingerprint,
    selectedCapabilityKeys,
    ...(profile.composition ? { composition: profile.composition } : {}),
    designedPipelineFingerprint: profile.designedPipelineFingerprint,
  };
  if (profile.fingerprint !== profileFingerprint(body)) {
    throw new Error("channel show profile fingerprint does not match its canonical composition");
  }
  return {
    ...body,
    fingerprint: profile.fingerprint,
  };
}

/**
 * Re-derive and compare a stored profile against the current explicit
 * program/selections/compiler output. This prevents a retry from presenting
 * one composition while executing another.
 */
export function assertChannelShowProfile(input: AssertChannelShowProfileInput): ChannelShowProfile {
  const supplied = assertChannelShowProfilePipelineCompatibility(input);
  const expected = createChannelShowProfile(input);
  // Historical records remain readable and must still pass their original
  // family/program/pipeline checks. They are not composition-attested: a new
  // exact profile is derived for this new snapshot rather than treating the
  // legacy receipt as proof of a named certified route.
  if (!supplied.composition) return expected;
  if (canonicalJson(supplied) === canonicalJson(expected)) return expected;
  const { composition: _suppliedComposition, fingerprint: _suppliedFingerprint, ...suppliedWithoutComposition } = supplied;
  const { composition: _expectedComposition, fingerprint: _expectedFingerprint, ...expectedWithoutComposition } = expected;
  void _suppliedComposition;
  void _suppliedFingerprint;
  void _expectedComposition;
  void _expectedFingerprint;
  if (canonicalJson(suppliedWithoutComposition) !== canonicalJson(expectedWithoutComposition)) {
    throw new Error("channel show profile does not match the admitted channel composition");
  }
  // The only allowed non-identical replay is a historically sealed composition
  // definition whose family, exact selected capabilities, and baseline graph
  // all still match. Return a freshly current receipt for the new write.
  return expected;
}

/** Stable content identity for pipeline certification and frozen invocations. */
export function channelShowProfileFingerprint(value: unknown): string {
  return parseChannelShowProfile(value).fingerprint;
}

/** Exposed for safe persistence schemas without allowing a browser to construct authority. */
export function channelShowProfileCapabilityKeys(value: unknown): readonly CreativeCapabilityKey[] {
  return [...parseChannelShowProfile(value).selectedCapabilityKeys];
}
