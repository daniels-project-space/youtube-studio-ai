import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeVoiceCastingAuditionReceipt,
  makeVoiceColdOpenReceipt,
  validateVoiceCastingAuditionReceipt,
  validateVoiceCastingReadinessReceipt,
  voiceCastingOutputFingerprint,
} from "../voiceCastingReceipt";

const ownerId = "owner_daniel";
const channelId = "channel-quiet-stoic";
const judgedAt = Date.now() - 1_000;
const cast = {
  voiceId: "eleven-voice-1",
  score: 8.7,
  at: judgedAt,
};
const auditionReceipt = makeVoiceCastingAuditionReceipt({
  ownerId,
  channelId,
  voiceId: cast.voiceId,
  score: cast.score,
  judgedAt: cast.at,
  auditioned: [
    { name: "eleven-voice-1", score: 8.7, note: "best match" },
    { name: "eleven-voice-2", score: 8.1, note: "strong alternate" },
  ],
  verdict: { winner: "eleven-voice-1", reason: "meets channel DNA" },
});
const persisted = { ...cast, auditionReceipt };
const coldOpenReceipt = makeVoiceColdOpenReceipt({
  ownerId,
  channelId,
  voiceId: cast.voiceId,
  judgedAt,
  seed: 4242,
  text: "A quiet fact changes the whole story.",
  physics: { speed: 0.86, archetype: "stoic" },
  verdict: {
    pass: true,
    register: 8.8,
    pace: 8.4,
    performance: 8.6,
    clean: 9.1,
    why: "measured and clear",
  },
});
const ready = { ...persisted, coldOpenReceipt };

assert.equal(validateVoiceCastingAuditionReceipt({
  cast: persisted,
  ownerId,
  channelId,
  now: cast.at + 1_000,
}), true);
assert.match(voiceCastingOutputFingerprint(persisted), /^[a-f0-9]{64}$/);
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: ready,
  ownerId,
  channelId,
  now: judgedAt + 1_000,
}), true);
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: persisted,
  ownerId,
  channelId,
}), false, "an audition alone is not cold-open readiness");
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: {
    ...ready,
    coldOpenReceipt: { ...coldOpenReceipt, voiceId: "other-voice" },
  },
  ownerId,
  channelId,
}), false, "cold-open proof must be bound to the selected voice");
assert.equal(validateVoiceCastingAuditionReceipt({ cast, ownerId, channelId }), false,
  "a score without an audition receipt is not evidence");
assert.equal(validateVoiceCastingAuditionReceipt({
  cast: { ...persisted, score: 9.1 },
  ownerId,
  channelId,
  now: cast.at + 1_000,
}), false, "receipt/cast tampering must fail closed");
assert.equal(validateVoiceCastingAuditionReceipt({
  cast: persisted,
  ownerId,
  channelId: "other-channel",
  now: cast.at + 1_000,
}), false);

for (const relativePath of ["convex/schema.ts", "convex/channels.ts"]) {
  const source = readFileSync(join(process.cwd(), relativePath), "utf8");
  assert.match(source, /auditionReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /shortlistFingerprint:\s*v\.string\(\)/);
  assert.match(source, /verdictFingerprint:\s*v\.string\(\)/);
  assert.match(source, /coldOpenReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /version:\s*v\.literal\("voice-cold-open\/v1"\)/);
}

console.log("voice casting receipt tests passed");
