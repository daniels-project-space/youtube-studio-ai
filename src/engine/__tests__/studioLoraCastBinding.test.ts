/**
 * A CHARACTER LoRA MAY NEVER REACH A SHOT WHOSE CAST WAS NOT FULLY RESOLVED.
 *
 * studio_ltx_adapter_resolve decides a per-shot adapter with:
 *
 *     const exact = exactCharacters?.length ? cached(exactCharacters) : null;
 *     return { continuityCharacterRegistryIdentities: exactCharacters ?? [],
 *              selection: exact ?? selected };
 *
 * exactCharacterRegistryIdentitiesForShot returns `null` to REFUSE a shot that
 * mixes a registered actor with an unregistered one — binding the registered
 * actor's LoRA there would claim a continuity guarantee that does not hold. But
 * `null` and `[]` both fall through to `selected`, the global selection, so the
 * refusal appears to be ignored.
 *
 * It is not, and nothing at that call site says why. The safety lives in two
 * assertions in studioAssetLibrary.ts, and BOTH WERE UNTESTED when this file was
 * written — so the property held by accident of nobody having edited them:
 *
 *   1. an entry cannot be portable AND character-bound (rejected when the entry
 *      is created)
 *   2. a resolve request naming NO target characters cannot match a character
 *      adapter or a character stack (rejected by the entry filter)
 *
 * Together those force the global selection to be portable, which is what makes
 * the fallback safe. This file pins all three layers, because a change to any
 * one of them turns a refusal into a false continuity guarantee — silently, on a
 * paid render path, in a way no type would catch.
 *
 * The third layer is the backstop: createStudioLtxShotAdapterSelections throws
 * if a character-bound selection is ever attached to a mismatched cast.
 */
import assert from "node:assert/strict";

import {
  createStudioAssetLibraryEntry,
  createStudioLtxShotAdapterSelections,
  resolveStudioAssetLibrary,
  studioLtxCreativeAdapterSelection,
  type StudioAssetLibraryEntryCore,
  type StudioAssetResolveRequest,
} from "@/engine/studioAssetLibrary";
import { exactCharacterRegistryIdentitiesForShot } from "@/trigger/blocks/studioAssetLibraryBlocks";
import { DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT } from "@/lib/ltxCreativeAdapter";
import { sha256Hex } from "@/lib/sha256";

const digest = (value: string) => sha256Hex(value);
const OWNER = "owner-cast";
const CHANNEL = "channel-cast";
const SERIES = "brick-chronicles";
const SERIES_BINDING = digest("cast-series-binding");
const HERO = digest("hero-registry-identity");
const RIVAL = digest("rival-registry-identity");

/* ============ 1. the three outcomes, and why two of them differ ============ */

const registry = new Map([["character-hero", HERO], ["character-rival", RIVAL]]);

assert.deepEqual(
  exactCharacterRegistryIdentitiesForShot({ continuityCharacterIds: [], registryIdentityByCharacterId: registry }),
  [],
  "a shot with no continuity characters resolves to an empty cast, not a refusal",
);

assert.deepEqual(
  exactCharacterRegistryIdentitiesForShot({
    continuityCharacterIds: ["character-rival", "character-hero"],
    registryIdentityByCharacterId: registry,
  }),
  [HERO, RIVAL].sort(),
  "a fully registered cast resolves to its exact identities, order-independent",
);

assert.equal(
  exactCharacterRegistryIdentitiesForShot({
    continuityCharacterIds: ["character-hero", "character-extra"],
    registryIdentityByCharacterId: registry,
  }),
  null,
  "a shot mixing a registered actor with an unregistered one REFUSES, rather than binding the one it has",
);

assert.throws(
  () => exactCharacterRegistryIdentitiesForShot({
    continuityCharacterIds: ["character-hero", "character-twin"],
    registryIdentityByCharacterId: new Map([["character-hero", HERO], ["character-twin", HERO]]),
  }),
  /multiple visible characters to one registry identity/i,
  "two on-screen characters cannot collapse onto one actor's LoRA",
);

/* ========== 2. LAYER ONE: portable and character-bound are exclusive ======== */

function core(overrides: Partial<StudioAssetLibraryEntryCore> = {}): StudioAssetLibraryEntryCore {
  return {
    version: "studio-asset-library/v1",
    logicalId: "cast-adapter",
    title: "Cast adapter",
    scope: "owned_studio",
    assetKind: "standard_lora_adapter",
    identitySensitivity: "portable",
    status: "approved",
    compatibility: {
      families: ["cinematic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["novita_render_video"],
      treatments: [],
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
    },
    approval: {
      provenanceFingerprint: digest("cast-provenance"),
      qualityEvidenceFingerprint: digest("cast-benchmark"),
      qualityScore: 91,
      approvedBy: "reviewer-cast",
      approvedAt: 1_700_000_000_000,
    },
    resource: {
      r2Key: "studio/ltx/cast.safetensors",
      contentSha256: digest("cast-adapter-bytes"),
      contentType: "application/octet-stream",
      byteLength: 512,
    },
    lora: {
      candidateId: "ltx-creative-cast-style",
      adapterClass: "standard_lora",
      adapterSha256: digest("cast-adapter-bytes"),
      benchmarkFingerprint: digest("cast-benchmark"),
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      renderStrength: 0.6,
      controlKinds: [],
      requiresSeriesBinding: false,
    },
    recipe: undefined,
    ...overrides,
  };
}

const portableAdapter = createStudioAssetLibraryEntry(core());

assert.throws(
  () => createStudioAssetLibraryEntry(core({
    logicalId: "cast-adapter-smuggling-a-character",
    lora: { ...core().lora!, characterRegistryIdentity: HERO },
  })),
  /portable standard LoRA cannot carry a series or character binding/i,
  "LAYER 1: if this ever stops throwing, a portable selection could carry a character identity — " +
  "and every refused shot would silently receive one",
);

/* ===== 3. LAYER TWO: no target characters cannot match a character LoRA ===== */

const characterAdapter = createStudioAssetLibraryEntry(core({
  logicalId: "cast-adapter-hero",
  title: "Hero character adapter",
  scope: "series",
  identitySensitivity: "series",
  channelId: CHANNEL,
  seriesIdentity: SERIES,
  resource: {
    r2Key: "studio/ltx/hero.safetensors",
    contentSha256: digest("hero-adapter-bytes"),
    contentType: "application/octet-stream",
    byteLength: 512,
  },
  lora: {
    ...core().lora!,
    candidateId: "ltx-creative-hero",
    adapterSha256: digest("hero-adapter-bytes"),
    requiresSeriesBinding: true,
    seriesBindingFingerprint: SERIES_BINDING,
    characterRegistryIdentity: HERO,
  },
}));

// Not `as const`: StudioAssetResolveRequest takes mutable arrays, and a readonly
// tuple does not satisfy it. tsx does not typecheck, so this ran green locally
// and would only have failed in CI.
const baseRequest: StudioAssetResolveRequest = {
  ownerId: OWNER,
  channelId: CHANNEL,
  seriesIdentity: SERIES,
  seriesBindingFingerprint: SERIES_BINDING,
  family: "cinematic",
  contentLane: "cinematic_ai",
  moduleId: "novita_render_video",
  runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
  requiredKinds: ["standard_lora_adapter"],
  acceptedCharacterRegistryIdentities: [HERO],
};

// The exact-cast lookup a shot with a fully resolved cast performs.
const exact = resolveStudioAssetLibrary({
  request: { ...baseRequest, targetCharacterRegistryIdentities: [HERO] },
  entries: [characterAdapter],
});
assert.equal(exact.status, "resolved", "an exact single-character cast resolves its character adapter");

// The GLOBAL lookup the block performs once, with no target characters — this
// is the selection a refused shot falls back to.
const global = resolveStudioAssetLibrary({
  request: { ...baseRequest },
  entries: [characterAdapter],
});
assert.equal(
  global.status,
  "no_approved_match",
  "LAYER 2: a request naming no target characters must NOT match a character adapter — this is what " +
  "keeps the global fallback free of character bindings",
);

// And when a portable style adapter is present, that is what the global lookup
// finds — with an empty character target, which is the property being relied on.
const globalPortable = resolveStudioAssetLibrary({
  request: { ...baseRequest },
  entries: [characterAdapter, portableAdapter],
});
assert.equal(globalPortable.status, "resolved", "the global lookup still finds a portable style adapter");
const portableSelection = studioLtxCreativeAdapterSelection(globalPortable);
assert.ok(portableSelection, "the portable resolution yields a selection");
assert.deepEqual(
  portableSelection.targetCharacterRegistryIdentities,
  [],
  "THE PROPERTY THE FALLBACK DEPENDS ON: a global selection is never character-bound",
);

/* ============ 4. LAYER THREE: the backstop, if 1 or 2 ever break ============ */

// A refused shot is recorded with an empty cast. Attaching the portable global
// selection to it is legal precisely because that selection has no character
// target.
const refusedShot = createStudioLtxShotAdapterSelections({
  narrativeShotControlFingerprint: digest("cast-shot-control"),
  shots: [{
    shotId: "shot-hero-and-unregistered-extra",
    continuityCharacterRegistryIdentities: [],
    selection: portableSelection,
  }],
});
assert.equal(refusedShot.shots.length, 1, "a refused shot still renders — with a style LoRA, not a character one");

// If layers 1 and 2 ever failed and a character-bound selection reached the same
// refused shot, this is the throw that would catch it.
const exactSelection = studioLtxCreativeAdapterSelection(exact);
assert.ok(exactSelection, "the exact resolution yields a character-bound selection");
assert.deepEqual(exactSelection.targetCharacterRegistryIdentities, [HERO], "which names its character");
assert.throws(
  () => createStudioLtxShotAdapterSelections({
    narrativeShotControlFingerprint: digest("cast-shot-control"),
    shots: [{
      shotId: "shot-hero-and-unregistered-extra",
      continuityCharacterRegistryIdentities: [],
      selection: exactSelection,
    }],
  }),
  /complete visible cast/i,
  "LAYER 3: the backstop refuses a character LoRA on a shot whose cast it does not match",
);

console.log(
  "STUDIO LoRA CAST BINDING PASS — a refused cast gets a style LoRA, never a character one, " +
  "and all three layers enforcing that are now pinned",
);
