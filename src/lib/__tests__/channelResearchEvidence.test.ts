import assert from "node:assert/strict";
import {
  channelResearchEvidenceFingerprint,
  validateChannelResearchEvidence,
} from "../channelResearchEvidence";

const now = 1_800_000_000_000;
const base = {
  ownerId: "owner_daniel",
  niche: "stoicism",
  nicheIntel: { ownerId: "owner_daniel", niche: "stoicism", refreshedAt: now - 1_000 },
  competitors: [{
    ownerId: "owner_daniel",
    niche: "stoicism",
    channelName: "The Daily Stoic",
    refreshedAt: now - 2_000,
    topVideos: [
      { youtubeVideoId: "video-1", title: "Control what you can", views: 100_000 },
      { youtubeVideoId: "video-2", title: "The obstacle", views: 80_000 },
      { youtubeVideoId: "video-3", title: "Morning discipline", views: 60_000 },
    ],
  }],
  now,
};

const valid = validateChannelResearchEvidence(base);
assert.ok(valid, "fresh owner- and niche-bound evidence should qualify");
assert.equal(valid.competitorCount, 1);
assert.equal(valid.videoCount, 3);
assert.match(valid.sampleFingerprint, /^[a-f0-9]{64}$/);
assert.match(channelResearchEvidenceFingerprint(valid), /^[a-f0-9]{64}$/);

assert.equal(validateChannelResearchEvidence({
  ...base,
  nicheIntel: { ...base.nicheIntel, refreshedAt: now - 8 * 24 * 60 * 60 * 1_000 },
}), undefined, "stale research must not be adopted");
assert.equal(validateChannelResearchEvidence({ ...base, ownerId: "other-owner" }), undefined);
assert.equal(validateChannelResearchEvidence({ ...base, niche: "finance" }), undefined);
assert.equal(validateChannelResearchEvidence({
  ...base,
  competitors: [{ ...base.competitors[0], topVideos: base.competitors[0].topVideos.slice(0, 2) }],
}), undefined, "two videos are not enough real evidence");

console.log("channel research evidence tests passed");
