import { createHash } from "node:crypto";

import type { FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";

/**
 * Pure, provider-free foundation for a channel family that has a genuinely
 * deterministic creator route.  It deliberately stops before storage/Convex:
 * the caller must durably persist every returned immutable object and prove the
 * zero-cost, draft-only boundary with `verifyDeterministicFoundationPersistence`.
 *
 * The first profile is QuizYear.  The builder itself is profile driven so a
 * future registered non-Gemini family adds a profile and source policy rather
 * than a new one-off creator flow.
 */
export const DETERMINISTIC_CHANNEL_FOUNDATION_VERSION = "deterministic-channel-foundation/v1" as const;

type LocalBrandRenderer = "quiz-tile";

export interface FoundationSourcePolicy {
  readonly id: string;
  readonly requiredLicense: string;
  readonly allowedHosts: readonly string[];
  readonly minimumSourcesPerStarter: number;
}

export interface DeterministicFoundationProfile {
  readonly id: string;
  readonly revision: string;
  readonly family: FamilyKey;
  readonly sourcePolicy: FoundationSourcePolicy;
  readonly positioning: Readonly<{
    audience: string;
    promise: string;
    persona: string;
    styleGrammar: string;
    palette: readonly [string, string, string];
    bannedWords: readonly string[];
  }>;
  readonly brandRenderer: LocalBrandRenderer;
  readonly minimumStarterEntries: number;
}

/**
 * Profile data, not a channel instance: any QuizYear channel can use it while
 * its name and cited starter slate remain caller-provided and fingerprinted.
 */
export const QUIZYEAR_DETERMINISTIC_FOUNDATION_PROFILE: DeterministicFoundationProfile = Object.freeze({
  id: "quizyear-deterministic-foundation",
  revision: "1",
  family: "quizyear",
  sourcePolicy: Object.freeze({
    id: "wikidata-cc0-starter-slate-v1",
    requiredLicense: "CC0-1.0",
    allowedHosts: Object.freeze(["www.wikidata.org"]),
    minimumSourcesPerStarter: 1,
  }),
  positioning: Object.freeze({
    audience: "curious viewers who enjoy fast, fair general-knowledge challenges",
    promise: "a clean timed trivia round with transparent answers and source-linked facts",
    persona: "A sharp, friendly game-show host that rewards curiosity over trick questions.",
    styleGrammar: "crisp midnight game-show grid, cobalt panels, amber timer accents, high-contrast local typography",
    palette: ["#0B1020", "#2E63FF", "#F6B73C"] as const,
    bannedWords: Object.freeze(["shocking", "secret", "you won't believe"]),
  }),
  brandRenderer: "quiz-tile",
  minimumStarterEntries: 3,
});

export interface FoundationSourceRecord {
  readonly id: string;
  /** Direct source citation, not a search-result URL. */
  readonly sourceUrl: string;
  /** Immutable digest of the source snapshot/claim packet consumed by the slate. */
  readonly contentFingerprint: string;
  readonly license: string;
  readonly retrievedAt: number;
  readonly claim: string;
}

export interface SourceFirstStarterEntry {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly premise: string;
  readonly keywords: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface DeterministicChannelFoundationInput {
  readonly profile: DeterministicFoundationProfile;
  readonly family: FamilyKey;
  readonly channelName: string;
  /** Already-validated channel storage prefix, e.g. channels/<owner>/<slug>. */
  readonly storagePrefix: string;
  readonly sources: readonly FoundationSourceRecord[];
  readonly starterSlate: readonly SourceFirstStarterEntry[];
}

export interface DeterministicFoundationPositioning {
  readonly family: FamilyKey;
  readonly channelName: string;
  readonly audience: string;
  readonly promise: string;
  readonly persona: string;
  readonly styleGrammar: string;
  readonly palette: readonly [string, string, string];
  readonly topicPool: readonly string[];
  readonly bannedWords: readonly string[];
  readonly provenance: Readonly<{
    profileId: string;
    profileRevision: string;
    sourcePolicyId: string;
    sourceIds: readonly string[];
    starterSlateFingerprint: string;
  }>;
  readonly fingerprint: string;
}

export interface SourceFirstStarterSlateManifest {
  readonly version: typeof DETERMINISTIC_CHANNEL_FOUNDATION_VERSION;
  readonly family: FamilyKey;
  readonly profile: Readonly<{ id: string; revision: string }>;
  readonly sourcePolicy: FoundationSourcePolicy;
  readonly sources: readonly FoundationSourceRecord[];
  readonly entries: readonly SourceFirstStarterEntry[];
  readonly fingerprint: string;
}

export interface DeterministicBrandAsset {
  readonly slot: "avatar" | "banner";
  readonly key: string;
  readonly contentType: "image/svg+xml";
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly byteLength: number;
  readonly qa: Readonly<{
    renderer: "local-svg";
    dimensions: readonly [number, number];
    checks: readonly string[];
  }>;
}

export interface DeterministicFoundationManifestArtifact {
  readonly key: string;
  readonly contentType: "application/json";
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface DeterministicChannelFoundation {
  readonly version: typeof DETERMINISTIC_CHANNEL_FOUNDATION_VERSION;
  readonly family: FamilyKey;
  readonly foundationFingerprint: string;
  readonly positioning: DeterministicFoundationPositioning;
  readonly starterSlate: SourceFirstStarterSlateManifest;
  readonly brandAssets: readonly [DeterministicBrandAsset, DeterministicBrandAsset];
  readonly manifestArtifact: DeterministicFoundationManifestArtifact;
  /** Hard boundary: this builder is pure and cannot authorize provider work. */
  readonly cost: Readonly<{ providerCalls: "forbidden"; maximumProviderCostUsd: 0 }>;
  /** Hard boundary: founding a channel never authorizes automatic publishing. */
  readonly publishing: Readonly<{ initialState: "draft"; automaticPublishAllowed: false }>;
  readonly integration: Readonly<{
    status: "persistence-required-before-capability-registration";
    requiredWrites: readonly ["positioning", "avatar", "banner", "starter-slate-manifest"];
    requiredProofs: readonly ["immutable-object-hashes", "zero-provider-cost", "draft-only-publish-state"];
  }>;
}

export interface PersistedFoundationObject {
  readonly key: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface DeterministicFoundationPersistenceInput {
  /** Fingerprint returned from the durable channel identity/positioning mutation. */
  readonly positioningFingerprint: string;
  readonly starterSlate: PersistedFoundationObject;
  readonly avatar: PersistedFoundationObject;
  readonly banner: PersistedFoundationObject;
  readonly providerCostUsd: number;
  readonly publishingState: "draft";
}

export interface DeterministicFoundationPersistenceReceipt {
  readonly version: typeof DETERMINISTIC_CHANNEL_FOUNDATION_VERSION;
  readonly foundationFingerprint: string;
  readonly positioningFingerprint: string;
  readonly starterSlateFingerprint: string;
  readonly assetFingerprints: readonly [string, string];
  readonly providerCostUsd: 0;
  readonly publishingState: "draft";
  readonly fingerprint: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function fail(message: string): never {
  throw new Error(`deterministicChannelFoundation: ${message}`);
}

function text(value: string, field: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized) fail(`${field} is required`);
  if (normalized.length > max) fail(`${field} exceeds ${max} characters`);
  return normalized;
}

function id(value: string, field: string): string {
  const normalized = text(value, field, 80);
  if (!SAFE_ID.test(normalized)) fail(`${field} must be a stable safe identifier`);
  return normalized;
}

function storagePrefix(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) fail("storagePrefix is required");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    fail("storagePrefix contains an unsafe path segment");
  }
  return normalized;
}

function sourceHost(sourceUrl: string, sourceId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    fail(`source ${sourceId} has an invalid URL`);
  }
  if (parsed.protocol !== "https:") fail(`source ${sourceId} must use https`);
  return parsed.hostname.toLowerCase();
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderQuizTileAvatar(palette: readonly [string, string, string]): string {
  const [ink, blue, amber] = palette;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="quiz game tile">',
    `<rect width="1024" height="1024" fill="${ink}"/>`,
    `<circle cx="512" cy="512" r="420" fill="${blue}"/>`,
    `<rect x="262" y="262" width="500" height="500" rx="88" fill="${ink}" stroke="${amber}" stroke-width="34"/>`,
    `<path d="M444 427c0-57 45-96 108-96 65 0 112 39 112 98 0 48-23 72-65 98-35 21-44 35-44 71v24h-88v-35c0-55 22-84 66-111 29-18 40-30 40-51 0-20-15-33-37-33-25 0-42 17-42 45h-90Z" fill="${amber}"/>`,
    `<circle cx="511" cy="701" r="45" fill="${amber}"/>`,
    '</svg>',
  ].join("");
}

function renderQuizTileBanner(
  channelName: string,
  palette: readonly [string, string, string],
): string {
  const [ink, blue, amber] = palette;
  const fontSize = channelName.length > 28 ? 84 : 112;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440" viewBox="0 0 2560 1440" role="img" aria-label="channel banner">',
    `<rect width="2560" height="1440" fill="${ink}"/>`,
    `<path d="M0 1180 780 420 1460 1180 2140 420 2560 840V1440H0Z" fill="${blue}" opacity=".22"/>`,
    `<rect x="560" y="500" width="1440" height="440" rx="72" fill="${ink}" stroke="${amber}" stroke-width="12"/>`,
    `<rect x="660" y="606" width="164" height="164" rx="34" fill="${blue}" stroke="${amber}" stroke-width="12"/>`,
    `<path d="M717 650c0-23 18-40 43-40s43 17 43 41c0 20-11 31-27 40-13 8-17 14-17 27v8h-34v-11c0-23 9-34 28-45 11-7 15-11 15-19 0-7-5-12-13-12-10 0-17 7-17 18h-35Z" fill="${amber}"/>`,
    `<circle cx="760" cy="750" r="17" fill="${amber}"/>`,
    `<text x="870" y="704" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800">${xml(channelName)}</text>`,
    `<text x="875" y="790" fill="${amber}" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" letter-spacing="4">PLAY • THINK • REVEAL</text>`,
    '</svg>',
  ].join("");
}

function structuralBrandQa(slot: "avatar" | "banner", svg: string, channelName: string): readonly string[] {
  if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) fail(`${slot} SVG namespace is missing`);
  if (/<(?:image|script|foreignObject)\b/i.test(svg) || /\bhref\s*=/i.test(svg)) {
    fail(`${slot} SVG must not load external or executable content`);
  }
  if (slot === "avatar") {
    if (!/width="1024" height="1024"/.test(svg)) fail("avatar dimensions are invalid");
    if (/<text\b/i.test(svg)) fail("avatar must remain text-free for tiny-size legibility");
    return Object.freeze(["fixed-1024-square", "text-free", "no-external-content", "circle-safe-composition"]);
  }
  if (!/width="2560" height="1440"/.test(svg)) fail("banner dimensions are invalid");
  if (!svg.includes(`>${xml(channelName)}</text>`)) fail("banner does not contain the exact locally-rendered channel name");
  return Object.freeze(["fixed-youtube-banner-dimensions", "safe-area-local-type", "no-external-content", "exact-name-escape"]);
}

function asset(
  slot: "avatar" | "banner",
  key: string,
  svg: string,
  channelName: string,
): DeterministicBrandAsset {
  const encoded = bytes(svg);
  const checks = structuralBrandQa(slot, svg, channelName);
  return Object.freeze({
    slot,
    key,
    contentType: "image/svg+xml",
    bytes: encoded,
    sha256: sha256(encoded),
    byteLength: encoded.byteLength,
    qa: Object.freeze({
      renderer: "local-svg" as const,
      dimensions: slot === "avatar" ? [1024, 1024] as const : [2560, 1440] as const,
      checks,
    }),
  });
}

function normalizeProfile(
  profile: DeterministicFoundationProfile,
  family: FamilyKey,
): DeterministicFoundationProfile {
  if (profile.family !== family) fail("profile family does not match requested family");
  const profileId = id(profile.id, "profile.id");
  const revision = id(profile.revision, "profile.revision");
  const sourcePolicyId = id(profile.sourcePolicy.id, "profile.sourcePolicy.id");
  const requiredLicense = text(profile.sourcePolicy.requiredLicense, "profile.sourcePolicy.requiredLicense", 120);
  if (!Number.isInteger(profile.sourcePolicy.minimumSourcesPerStarter) || profile.sourcePolicy.minimumSourcesPerStarter < 1) {
    fail("profile.sourcePolicy.minimumSourcesPerStarter must be a positive integer");
  }
  if (!profile.sourcePolicy.allowedHosts.length || profile.sourcePolicy.allowedHosts.some((host) => !/^[a-z0-9.-]+$/i.test(host))) {
    fail("profile.sourcePolicy.allowedHosts must contain valid hosts");
  }
  const allowedHosts = [...new Set(profile.sourcePolicy.allowedHosts.map((host) => host.toLowerCase()))].sort();
  const palette = [...profile.positioning.palette] as [string, string, string];
  for (const color of palette) {
    if (!HEX.test(color)) fail("profile positioning palette must contain hex colors");
  }
  const bannedWords = [...new Set(profile.positioning.bannedWords.map((word) =>
    text(word, "profile.positioning.bannedWord", 80).toLowerCase(),
  ))].sort();
  if (!Number.isInteger(profile.minimumStarterEntries) || profile.minimumStarterEntries < 1) {
    fail("profile.minimumStarterEntries must be a positive integer");
  }
  return Object.freeze({
    id: profileId,
    revision,
    family,
    sourcePolicy: Object.freeze({
      id: sourcePolicyId,
      requiredLicense,
      allowedHosts: Object.freeze(allowedHosts),
      minimumSourcesPerStarter: profile.sourcePolicy.minimumSourcesPerStarter,
    }),
    positioning: Object.freeze({
      audience: text(profile.positioning.audience, "profile.positioning.audience"),
      promise: text(profile.positioning.promise, "profile.positioning.promise"),
      persona: text(profile.positioning.persona, "profile.positioning.persona"),
      styleGrammar: text(profile.positioning.styleGrammar, "profile.positioning.styleGrammar"),
      palette: Object.freeze(palette) as readonly [string, string, string],
      bannedWords: Object.freeze(bannedWords),
    }),
    brandRenderer: profile.brandRenderer,
    minimumStarterEntries: profile.minimumStarterEntries,
  });
}

function validateSourceFirstSlate(input: DeterministicChannelFoundationInput): {
  sources: readonly FoundationSourceRecord[];
  entries: readonly SourceFirstStarterEntry[];
} {
  const { sourcePolicy } = input.profile;
  const sourceIds = new Set<string>();
  const sources = input.sources.map((source) => {
    const sourceId = id(source.id, "source.id");
    if (sourceIds.has(sourceId)) fail(`duplicate source.id ${sourceId}`);
    sourceIds.add(sourceId);
    const host = sourceHost(source.sourceUrl, sourceId);
    if (!sourcePolicy.allowedHosts.includes(host)) {
      fail(`source ${sourceId} host ${host} is not allowed by ${sourcePolicy.id}`);
    }
    if (source.license !== sourcePolicy.requiredLicense) {
      fail(`source ${sourceId} license must be ${sourcePolicy.requiredLicense}`);
    }
    if (!SHA256.test(source.contentFingerprint)) fail(`source ${sourceId} needs a sha256 contentFingerprint`);
    if (!Number.isFinite(source.retrievedAt) || source.retrievedAt <= 0) fail(`source ${sourceId} needs a positive retrievedAt`);
    return Object.freeze({
      id: sourceId,
      sourceUrl: text(source.sourceUrl, `source ${sourceId}.sourceUrl`, 1_000),
      contentFingerprint: source.contentFingerprint,
      license: source.license,
      retrievedAt: source.retrievedAt,
      claim: text(source.claim, `source ${sourceId}.claim`),
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (!sources.length) fail("at least one cited source is required");

  const entryIds = new Set<string>();
  const ordinals = new Set<number>();
  const entries = input.starterSlate.map((entry) => {
    const entryId = id(entry.id, "starter entry.id");
    if (entryIds.has(entryId)) fail(`duplicate starter entry.id ${entryId}`);
    entryIds.add(entryId);
    if (!Number.isInteger(entry.ordinal) || entry.ordinal < 1 || ordinals.has(entry.ordinal)) {
      fail(`starter entry ${entryId} needs a unique positive ordinal`);
    }
    ordinals.add(entry.ordinal);
    const links = [...new Set(entry.sourceIds.map((sourceId) => id(sourceId, `starter entry ${entryId}.sourceId`)))].sort();
    if (links.length < sourcePolicy.minimumSourcesPerStarter) {
      fail(`starter entry ${entryId} must cite at least ${sourcePolicy.minimumSourcesPerStarter} source(s)`);
    }
    if (links.some((sourceId) => !sourceIds.has(sourceId))) {
      fail(`starter entry ${entryId} cites an unknown source`);
    }
    const keywords = [...new Set(entry.keywords.map((keyword) => text(keyword, `starter entry ${entryId}.keyword`, 80).toLowerCase()))].sort();
    if (!keywords.length) fail(`starter entry ${entryId} needs at least one keyword`);
    return Object.freeze({
      id: entryId,
      ordinal: entry.ordinal,
      title: text(entry.title, `starter entry ${entryId}.title`, 120),
      premise: text(entry.premise, `starter entry ${entryId}.premise`, 500),
      keywords: Object.freeze(keywords),
      sourceIds: Object.freeze(links),
    });
  }).sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  if (entries.length < input.profile.minimumStarterEntries) {
    fail(`starter slate needs at least ${input.profile.minimumStarterEntries} entries`);
  }
  return { sources: Object.freeze(sources), entries: Object.freeze(entries) };
}

function persistedObjectMatches(
  actual: PersistedFoundationObject,
  expected: Pick<PersistedFoundationObject, "key" | "contentType" | "sha256" | "byteLength">,
  label: string,
): void {
  if (
    actual.key !== expected.key ||
    actual.contentType !== expected.contentType ||
    actual.sha256 !== expected.sha256 ||
    actual.byteLength !== expected.byteLength
  ) {
    fail(`${label} persistence receipt does not match the immutable foundation object`);
  }
}

/** Build a content-addressed, pure foundation. This performs no I/O or model call. */
export function buildDeterministicChannelFoundation(
  input: DeterministicChannelFoundationInput,
): DeterministicChannelFoundation {
  const profile = normalizeProfile(input.profile, input.family);
  const channelName = text(input.channelName, "channelName", 60);
  const prefix = storagePrefix(input.storagePrefix);
  const { sources, entries } = validateSourceFirstSlate({ ...input, profile });
  const starterSlateWithoutFingerprint = {
    version: DETERMINISTIC_CHANNEL_FOUNDATION_VERSION,
    family: input.family,
    profile: { id: profile.id, revision: profile.revision },
    sourcePolicy: profile.sourcePolicy,
    sources,
    entries,
  } as const;
  const starterSlateFingerprint = sha256(canonicalJson(starterSlateWithoutFingerprint));
  const starterSlate: SourceFirstStarterSlateManifest = Object.freeze({
    ...starterSlateWithoutFingerprint,
    fingerprint: starterSlateFingerprint,
  });
  const positioningBase = {
    family: input.family,
    channelName,
    audience: profile.positioning.audience,
    promise: profile.positioning.promise,
    persona: profile.positioning.persona,
    styleGrammar: profile.positioning.styleGrammar,
    palette: profile.positioning.palette,
    topicPool: Object.freeze(entries.map((entry) => entry.title)),
    bannedWords: profile.positioning.bannedWords,
    provenance: Object.freeze({
      profileId: profile.id,
      profileRevision: profile.revision,
      sourcePolicyId: profile.sourcePolicy.id,
      sourceIds: Object.freeze(sources.map((source) => source.id)),
      starterSlateFingerprint,
    }),
  } as const;
  const positioning: DeterministicFoundationPositioning = Object.freeze({
    ...positioningBase,
    fingerprint: sha256(canonicalJson(positioningBase)),
  });
  const foundationFingerprint = sha256(canonicalJson({
    version: DETERMINISTIC_CHANNEL_FOUNDATION_VERSION,
    profile: { id: profile.id, revision: profile.revision },
    positioningFingerprint: positioning.fingerprint,
    starterSlateFingerprint,
  }));
  const root = `${prefix}/deterministic-foundations/${DETERMINISTIC_CHANNEL_FOUNDATION_VERSION}/${foundationFingerprint}`;
  if (profile.brandRenderer !== "quiz-tile") fail(`unsupported local brand renderer ${profile.brandRenderer}`);
  const avatar = asset(
    "avatar",
    `${root}/brand/avatar.svg`,
    renderQuizTileAvatar(profile.positioning.palette),
    channelName,
  );
  const banner = asset(
    "banner",
    `${root}/brand/banner.svg`,
    renderQuizTileBanner(channelName, profile.positioning.palette),
    channelName,
  );
  const manifestBytes = bytes(canonicalJson({
    version: DETERMINISTIC_CHANNEL_FOUNDATION_VERSION,
    foundationFingerprint,
    positioning,
    starterSlate,
    brandAssets: [
      { slot: avatar.slot, key: avatar.key, contentType: avatar.contentType, sha256: avatar.sha256, byteLength: avatar.byteLength, qa: avatar.qa },
      { slot: banner.slot, key: banner.key, contentType: banner.contentType, sha256: banner.sha256, byteLength: banner.byteLength, qa: banner.qa },
    ],
    cost: { providerCalls: "forbidden", maximumProviderCostUsd: 0 },
    publishing: { initialState: "draft", automaticPublishAllowed: false },
  }));
  const manifestArtifact: DeterministicFoundationManifestArtifact = Object.freeze({
    key: `${root}/starter-slate-manifest.json`,
    contentType: "application/json",
    bytes: manifestBytes,
    sha256: sha256(manifestBytes),
    byteLength: manifestBytes.byteLength,
  });
  return Object.freeze({
    version: DETERMINISTIC_CHANNEL_FOUNDATION_VERSION,
    family: input.family,
    foundationFingerprint,
    positioning,
    starterSlate,
    brandAssets: Object.freeze([avatar, banner]) as readonly [DeterministicBrandAsset, DeterministicBrandAsset],
    manifestArtifact,
    cost: Object.freeze({ providerCalls: "forbidden" as const, maximumProviderCostUsd: 0 as const }),
    publishing: Object.freeze({ initialState: "draft" as const, automaticPublishAllowed: false as const }),
    integration: Object.freeze({
      status: "persistence-required-before-capability-registration" as const,
      requiredWrites: Object.freeze(["positioning", "avatar", "banner", "starter-slate-manifest"]) as readonly ["positioning", "avatar", "banner", "starter-slate-manifest"],
      requiredProofs: Object.freeze(["immutable-object-hashes", "zero-provider-cost", "draft-only-publish-state"]) as readonly ["immutable-object-hashes", "zero-provider-cost", "draft-only-publish-state"],
    }),
  });
}

/**
 * Verify the receipt an eventual Trigger/Convex integration must produce after
 * immutable writes.  It does not substitute for those writes, which is why the
 * family capability remains unregistered until an end-to-end integration test
 * exercises this boundary.
 */
export function verifyDeterministicFoundationPersistence(
  foundation: DeterministicChannelFoundation,
  persisted: DeterministicFoundationPersistenceInput,
): DeterministicFoundationPersistenceReceipt {
  if (persisted.positioningFingerprint !== foundation.positioning.fingerprint) {
    fail("persisted positioning fingerprint does not match foundation positioning");
  }
  persistedObjectMatches(persisted.starterSlate, foundation.manifestArtifact, "starter slate");
  persistedObjectMatches(persisted.avatar, foundation.brandAssets[0], "avatar");
  persistedObjectMatches(persisted.banner, foundation.brandAssets[1], "banner");
  if (persisted.providerCostUsd !== 0) fail("deterministic foundation must prove zero provider cost");
  if (persisted.publishingState !== "draft") fail("deterministic foundation must remain draft-only");
  const receiptBase = {
    version: DETERMINISTIC_CHANNEL_FOUNDATION_VERSION,
    foundationFingerprint: foundation.foundationFingerprint,
    positioningFingerprint: foundation.positioning.fingerprint,
    starterSlateFingerprint: foundation.starterSlate.fingerprint,
    assetFingerprints: [foundation.brandAssets[0].sha256, foundation.brandAssets[1].sha256] as const,
    providerCostUsd: 0 as const,
    publishingState: "draft" as const,
  };
  return Object.freeze({ ...receiptBase, fingerprint: sha256(canonicalJson(receiptBase)) });
}
