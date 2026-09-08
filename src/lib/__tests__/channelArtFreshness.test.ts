import assert from "node:assert/strict";

import {
  CHANNEL_ART_PROMPT_VERSION,
  CHANNEL_ART_PROVENANCE_VERSION,
  assessChannelArtFreshness,
  channelArtApprovalKey,
  channelArtDirectionFingerprint,
  channelArtIdentityFromSource,
  mergeChannelArtProvenance,
  type ChannelArtAssetProvenance,
} from "@/lib/channelArtIdentity";

const identity = channelArtIdentityFromSource({
  name: "Investory",
  identity: {
    niche: "Finance",
    persona: "old imported coffee-desk host",
    styleGrammar: "generic lifestyle photography",
    palette: ["brown", "cream"],
    creativeBrief: { iconicMotif: "coffee cup", vibe: "casual" },
  },
  styleDNA: {
    setting: "midnight coffee desk",
    composition: "laptop and coffee",
    motifs: ["coffee"],
  },
});

const outputKey = "owner/owner_daniel/channel/investory/art/banner/v7/approved.jpg";
const bannerProof: ChannelArtAssetProvenance = {
  version: CHANNEL_ART_PROVENANCE_VERSION,
  promptVersion: CHANNEL_ART_PROMPT_VERSION,
  directionFingerprint: channelArtDirectionFingerprint("banner", identity),
  outputKey,
  outputSha256: "a".repeat(64),
  approvalKey: channelArtApprovalKey(outputKey),
  providerRoute: "fal-nano-banana-channel-banner-edit",
  acceptedAt: 1_788_800_000_000,
};

assert.match(identity.worldSetting ?? "", /archival market archive/i,
  "the fingerprint must be based on the repaired Investory world, not stale imported coffee art");
assert.equal(channelArtDirectionFingerprint("banner", identity).length, 64);
assert.notEqual(
  channelArtDirectionFingerprint("avatar", identity),
  channelArtDirectionFingerprint("banner", identity),
  "avatar and banner approvals must not be interchangeable",
);

assert.deepEqual(
  assessChannelArtFreshness({ kind: "banner", identity, assetKey: outputKey }),
  {
    current: false,
    reason: "legacy-unverified",
    directionFingerprint: bannerProof.directionFingerprint,
  },
  "a key alone must never be mistaken for a current reviewed banner",
);

const provenance = mergeChannelArtProvenance(undefined, "banner", bannerProof);
assert.equal(
  assessChannelArtFreshness({ kind: "banner", identity, assetKey: outputKey, provenance }).current,
  true,
);
assert.equal(
  assessChannelArtFreshness({
    kind: "banner",
    identity,
    assetKey: `${outputKey}.changed`,
    provenance,
  }).reason,
  "asset-mismatch",
);
assert.equal(
  assessChannelArtFreshness({
    kind: "banner",
    identity,
    assetKey: outputKey,
    provenance: {
      ...provenance,
      banner: { ...bannerProof, approvalKey: "unrelated/approval.json" },
    },
  }).reason,
  "proof-invalid",
);
assert.equal(
  assessChannelArtFreshness({
    kind: "banner",
    identity: { ...identity, vibe: `${identity.vibe} with a materially changed direction` },
    assetKey: outputKey,
    provenance,
  }).reason,
  "direction-changed",
);
assert.equal(
  assessChannelArtFreshness({ kind: "avatar", identity, assetKey: null, provenance }).reason,
  "missing-asset",
);
assert.throws(() => channelArtApprovalKey("legacy/banner.png"), /not an approved asset key/i);

console.log("CHANNEL ART FRESHNESS PASS");
