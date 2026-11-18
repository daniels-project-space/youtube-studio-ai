import assert from "node:assert/strict";
import { contentLaneForFamily } from "@/engine/contentLane";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { durationCandidateProposal } from "@/lib/durationCandidateProposal";

const lane = contentLaneForFamily("music_loop")!;
const channel = { family: null, contentLane: lane, pipeline: [{ block: "assemble", params: { durationSec: 7200, exactFinalDuration: true } }] };
const before = structuredClone(channel);
assert.equal(durationCandidateFamily(channel), "music_loop");
assert.equal(durationCandidateProposal(channel, 10800).pipeline[0].params?.durationSec, 10800);
assert.deepEqual(channel, before);
assert.notEqual(channelPipelineWriteFence(channel), channelPipelineWriteFence({ ...channel, contentLane: contentLaneForFamily("narrated_stock") }));
assert.equal(durationCandidateFamily({ family: "music_loop" }), "music_loop");
assert.throws(() => durationCandidateFamily({ family: "narrated_stock", contentLane: lane }), /conflicts/);
assert.throws(() => durationCandidateFamily({ family: null, contentLane: { ...lane, primaryRenderer: "invented" } }), /Invalid content lane/);
assert.throws(() => durationCandidateFamily({ family: null }), /no saved format/);
assert.throws(() => durationCandidateFamily({ family: "invented", contentLane: lane }), /invalid/);
console.log("Duration family resolves only canonical stored identities and fingerprints their raw baseline");
