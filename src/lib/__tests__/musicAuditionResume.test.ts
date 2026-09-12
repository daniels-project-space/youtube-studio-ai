import assert from "node:assert/strict";

import {
  MUSIC_AUDITION_RESUME_SCHEDULE_VERSION,
  musicAuditionResumeSchedule,
} from "@/lib/musicAuditionResume";

const sha = (char: string) => char.repeat(64);
const payload = {
  channelId: "channel_approved_music",
  runId: "run_approved_music",
  invocationSha256: sha("a"),
  musicAuditionResume: {
    checkpointId: "checkpoint_approved_music",
    checkpointFingerprint: sha("b"),
    qualityReceiptFingerprint: sha("c"),
    approvalFingerprint: sha("d"),
    invocationSha256: sha("a"),
  },
};

const first = musicAuditionResumeSchedule(payload);
assert.equal(first.concurrencyKey, payload.channelId);
assert.equal(first.payload, payload);
assert.match(first.idempotencySeed, new RegExp(`^${MUSIC_AUDITION_RESUME_SCHEDULE_VERSION}:`));
assert.equal(first.idempotencySeed, musicAuditionResumeSchedule(payload).idempotencySeed);

const recovered = musicAuditionResumeSchedule(payload, { deliveryAttempt: 2 });
assert.equal(recovered.idempotencySeed, `${first.idempotencySeed}:delivery:2`);

assert.throws(() => musicAuditionResumeSchedule({
  ...payload,
  musicAuditionResume: { ...payload.musicAuditionResume, invocationSha256: sha("e") },
}), /fingerprints do not match/u);
assert.throws(() => musicAuditionResumeSchedule({
  ...payload,
  musicAuditionResume: { ...payload.musicAuditionResume, approvalFingerprint: "not-a-hash" },
}), /must be sha256/u);
assert.throws(() => musicAuditionResumeSchedule(payload, { deliveryAttempt: 0 }), /delivery attempt is invalid/u);

console.log("MUSIC AUDITION RESUME SCHEDULE PASS — exact approval replay remains globally idempotent and bounded");
