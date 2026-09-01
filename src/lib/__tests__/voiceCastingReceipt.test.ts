import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeVoiceCastingAuditionReceipt,
  makeVoiceColdOpenReceipt,
  makeVoiceLocalColdOpenReceipt,
  makeVoiceProviderSelectionReceipt,
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

const providerSelectionReceipt = makeVoiceProviderSelectionReceipt({
  ownerId,
  channelId,
  voiceId: cast.voiceId,
  score: 7.4,
  selectedAt: judgedAt,
  shortlisted: [{ name: "Declared documentary voice", score: 7.4, reasons: ["use_case:narrative_story"] }],
  selection: { provider: "elevenlabs", voiceId: cast.voiceId, method: "metadata-only" },
});
const localColdOpenReceipt = makeVoiceLocalColdOpenReceipt({
  ownerId,
  channelId,
  voiceId: cast.voiceId,
  measuredAt: judgedAt,
  text: "A quiet fact changes the whole story.",
  physics: { speed: 0.96, archetype: "narrator-teacher" },
  audioFingerprint: "a".repeat(64),
  durationSec: 4.2,
  wordsPerSec: 2.1,
  integratedLufs: -18.4,
});
const providerReady = {
  voiceId: cast.voiceId,
  score: 7.4,
  at: judgedAt,
  providerSelectionReceipt,
  localColdOpenReceipt,
};
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: providerReady,
  ownerId,
  channelId,
  now: judgedAt + 1_000,
}), true, "a metadata pre-cast needs a real local cold-open health receipt before it is usable");
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: { ...providerReady, localColdOpenReceipt: { ...localColdOpenReceipt, audioFingerprint: "bad" } },
  ownerId,
  channelId,
}), false, "provider metadata may not substitute for a fingerprinted real take");

const qwenProviderSelectionReceipt = makeVoiceProviderSelectionReceipt({
  ownerId,
  channelId,
  provider: "qwen3",
  voiceId: "Aiden",
  score: 7.8,
  selectedAt: judgedAt,
  shortlisted: [{ name: "Aiden", score: 7.8, reasons: ["native_language:english"] }],
  selection: { provider: "qwen3", voiceId: "Aiden", method: "metadata-only" },
});
const qwenLocalColdOpenReceipt = makeVoiceLocalColdOpenReceipt({
  ownerId,
  channelId,
  provider: "qwen3",
  voiceId: "Aiden",
  measuredAt: judgedAt,
  text: "A measured open changes the whole story.",
  physics: { speed: 0.96, archetype: "narrator-teacher" },
  audioFingerprint: "b".repeat(64),
  durationSec: 3.8,
  wordsPerSec: 1.9,
  integratedLufs: -17.8,
});
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: {
    voiceId: "Aiden",
    score: 7.8,
    at: judgedAt,
    providerSelectionReceipt: qwenProviderSelectionReceipt,
    localColdOpenReceipt: qwenLocalColdOpenReceipt,
  },
  ownerId,
  channelId,
}), true, "Qwen casting is ready only when metadata and measured cold-open receipts name the same provider");
assert.equal(validateVoiceCastingReadinessReceipt({
  cast: {
    voiceId: "Aiden",
    score: 7.8,
    at: judgedAt,
    providerSelectionReceipt: qwenProviderSelectionReceipt,
    localColdOpenReceipt: { ...qwenLocalColdOpenReceipt, provider: "elevenlabs" },
  },
  ownerId,
  channelId,
}), false, "cross-provider casting receipts must fail closed");

for (const relativePath of ["convex/schema.ts", "convex/channels.ts"]) {
  const source = readFileSync(join(process.cwd(), relativePath), "utf8");
  assert.match(source, /auditionReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /shortlistFingerprint:\s*v\.string\(\)/);
  assert.match(source, /verdictFingerprint:\s*v\.string\(\)/);
  assert.match(source, /coldOpenReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /version:\s*v\.literal\("voice-cold-open\/v1"\)/);
  assert.match(source, /providerSelectionReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /version:\s*v\.literal\("voice-provider-selection\/v1"\)/);
  assert.match(source, /localColdOpenReceipt:\s*v\.optional\(v\.object\(\{/);
  assert.match(source, /version:\s*v\.literal\("voice-local-cold-open\/v1"\)/);
  assert.match(source, /providerRenderReceipt:\s*v\.optional\(qwenTtsReceiptValidator\)/);
}

console.log("voice casting receipt tests passed");
