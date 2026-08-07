import { canonicalJson } from "@/lib/canonicalJson";
import type { ChannelInceptionModuleKey } from "@/engine/channelInceptionContracts";

type ChannelRecord = Record<string, unknown>;

const POSITIONING_IDENTITY_FIELDS = [
  "persona",
  "styleGrammar",
  "palette",
  "bannedWords",
  "requiredCallbacks",
  "cadence",
  "creativeBrief",
] as const;

const SEO_IDENTITY_FIELDS = ["topicPool"] as const;
const VOICE_IDENTITY_FIELDS = ["voiceCasting", "voiceId", "voiceRef", "toneRefs"] as const;
const AVATAR_IDENTITY_FIELDS = ["imageKey"] as const;
const BANNER_IDENTITY_FIELDS = ["bannerKey"] as const;
const THUMBNAIL_IDENTITY_FIELDS = ["thumbnailIdentity", "thumbnailTemplate"] as const;

function record(value: unknown): ChannelRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ChannelRecord
    : {};
}

function changed(before: unknown, after: unknown): boolean {
  return canonicalJson(before) !== canonicalJson(after);
}

function anyIdentityFieldChanged(
  before: ChannelRecord,
  after: ChannelRecord,
  fields: readonly string[],
): boolean {
  return fields.some((field) => changed(before[field], after[field]));
}

/**
 * Return the smallest directly-owned inception outputs changed by a channel
 * patch. The ledger expands these roots transitively through its real plan DAG.
 * Operational fields (schedule, budget, status, folders and YouTube metadata)
 * deliberately do not invalidate creative proof.
 */
export function channelInceptionInvalidationRoots(
  beforeValue: unknown,
  afterValue: unknown,
): ChannelInceptionModuleKey[] {
  const before = record(beforeValue);
  const after = record(afterValue);
  const roots = new Set<ChannelInceptionModuleKey>();

  if (changed(before["family"], after["family"]) || changed(before["language"], after["language"])) {
    roots.add("channel-inception-research");
  }
  if (changed(before["name"], after["name"])) {
    roots.add("channel-inception-positioning");
  }

  const beforeIdentity = record(before["identity"]);
  const afterIdentity = record(after["identity"]);
  if (changed(beforeIdentity["niche"], afterIdentity["niche"])) {
    roots.add("channel-inception-research");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, POSITIONING_IDENTITY_FIELDS)) {
    roots.add("channel-inception-positioning");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, SEO_IDENTITY_FIELDS)) {
    roots.add("channel-inception-seo");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, VOICE_IDENTITY_FIELDS)) {
    roots.add("channel-inception-voice");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, AVATAR_IDENTITY_FIELDS)) {
    roots.add("channel-inception-avatar");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, BANNER_IDENTITY_FIELDS)) {
    roots.add("channel-inception-banner");
  }
  if (anyIdentityFieldChanged(beforeIdentity, afterIdentity, THUMBNAIL_IDENTITY_FIELDS)) {
    roots.add("channel-inception-thumbnails");
  }

  if (changed(before["styleDNA"], after["styleDNA"]) || changed(before["qaRubric"], after["qaRubric"])) {
    roots.add("channel-inception-positioning");
  }
  if (changed(before["scriptPlaybook"], after["scriptPlaybook"])) {
    roots.add("channel-inception-seo");
  }
  if (
    changed(before["thumbnailPlaybook"], after["thumbnailPlaybook"]) ||
    changed(before["thumbnailer"], after["thumbnailer"])
  ) {
    roots.add("channel-inception-thumbnails");
  }
  if (
    changed(before["pipeline"], after["pipeline"]) ||
    changed(before["moduleConfig"], after["moduleConfig"]) ||
    changed(before["disabledBlocks"], after["disabledBlocks"]) ||
    changed(before["modelRouting"], after["modelRouting"]) ||
    changed(before["architectReport"], after["architectReport"]) ||
    changed(before["template"], after["template"])
  ) {
    roots.add("channel-inception-pipeline");
  }

  return [...roots];
}

/** Fields included in the positioning stage's durable output fingerprint. */
export function positioningIdentityProjection(identityValue: unknown): ChannelRecord {
  const identity = record(identityValue);
  return Object.fromEntries(
    ["niche", ...POSITIONING_IDENTITY_FIELDS].map((field) => [field, identity[field]]),
  );
}

/** Fields included in the SEO stage's durable output fingerprint. */
export function seoIdentityProjection(identityValue: unknown): ChannelRecord {
  const identity = record(identityValue);
  return Object.fromEntries(SEO_IDENTITY_FIELDS.map((field) => [field, identity[field]]));
}
