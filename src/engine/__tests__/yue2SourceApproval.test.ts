import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createYuE2SourceApproval, YuE2SourceApprovalSchema } from "../yue2SourceApproval";
import { YUE2_AUDITION_CHECKS } from "../yue2Audition";
import { canonicalJson } from "../../lib/canonicalJson";

const basis = {
  ownerId: "owner-a", channelId: "channel-a", runId: "run-a", invocationSha256: "b".repeat(64),
  candidateSha256: "a".repeat(64), arrangementFingerprint: "c".repeat(64), jobId: `yue2-eval-${"d".repeat(64)}`,
  listeningAudioKey: `owner/owner-a/runs/run-a/music/yue2-evaluation/audio-headroom-${"e".repeat(64)}.wav`,
  listeningAudioSha256: "e".repeat(64), nativeFrames: 6837056, sampleRateHz: 48000, channels: 2,
  sectionIds: ["opening", "ending"], technicalStatus: "needs_audition", contextRetained: true,
};
const submission = { candidateSha256: basis.candidateSha256, verdict: "approved_for_assembly", listenedEntireSource: true,
  checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "pass"])),
  sections: basis.sectionIds.map(id => ({ id, judgment: "pass", notes: "Restrained texture matches this section." })),
  notes: "Full-source listening confirms the intended channel personality." };
const input = { basis, submission, reviewedAt: 123456789, revision: 1 };

test("approval seals the exact source and decision without granting publishing authority", () => {
  const approval = createYuE2SourceApproval(input);
  const { fingerprint, ...body } = approval;
  assert.equal(fingerprint, createHash("sha256").update(canonicalJson(body)).digest("hex"));
  assert.equal(approval.auditionSha256, createHash("sha256").update(canonicalJson(submission)).digest("hex"));
  assert.equal(approval.assemblyApproved, true);
  assert.equal(approval.publishingApproved, false);
  assert.deepEqual(createYuE2SourceApproval(input), approval);
  assert.notEqual(createYuE2SourceApproval({ ...input, submission: { ...submission, notes: "A revised owner assessment of the complete source." } }).fingerprint, fingerprint);
  for (const patch of [{ reviewerId: "foreign" }, { publishingApproved: true }, { revision: 2 }, { reviewedAt: 1 }]) {
    assert.equal(YuE2SourceApprovalSchema.safeParse({ ...approval, ...patch }).success, false);
  }
  for (const patch of [{ candidateSha256: "f".repeat(64) }, { invocationSha256: "f".repeat(64) },
    { arrangementFingerprint: "f".repeat(64) }, { nativeFrames: 6837057 }, { channelId: "foreign" }]) {
    assert.equal(YuE2SourceApprovalSchema.safeParse({ ...approval, basis: { ...basis, ...patch } }).success, false);
  }
});
test("historical praise, incomplete reviews and foreign audio cannot become source approval", () => {
  for (const verdict of ["promising", "needs_work", "rejected"]) {
    assert.throws(() => createYuE2SourceApproval({ ...input, submission: { ...submission, verdict } }));
  }
  for (const patch of [{ listenedEntireSource: false }, { sections: submission.sections.slice(1) },
    { candidateSha256: "f".repeat(64) }, { sourceApprovalFingerprint: "f".repeat(64) }]) {
    assert.throws(() => createYuE2SourceApproval({ ...input, submission: { ...submission, ...patch } }));
  }
  for (const patch of [{ technicalStatus: "blocked" }, { contextRetained: false }, { invocationSha256: undefined },
    { listeningAudioSha256: "f".repeat(64) }, { ownerId: "foreign" }, { runId: "foreign" },
    { sectionIds: ["opening", "opening"] }, { listeningAudioKey: "https://example.invalid/music.wav" }]) {
    assert.throws(() => createYuE2SourceApproval({ ...input, basis: { ...basis, ...patch } }));
  }
});
