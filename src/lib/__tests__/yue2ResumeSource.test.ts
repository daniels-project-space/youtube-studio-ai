import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyYuE2ResumeSource } from "@/lib/yue2ResumeSource";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { createHash } from "node:crypto";

function fixture() {
  const bytes = Buffer.alloc(44 + 480 * 8, 1);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const scope = { ownerId: "owner-test", channelId: "channel-test", runId: "run-test", invocationSha256: "a".repeat(64) };
  const basis = { ...scope, candidateSha256: "b".repeat(64), arrangementFingerprint: "c".repeat(64),
    jobId: `yue2-eval-${"d".repeat(64)}`, listeningAudioSha256: digest,
    listeningAudioKey: `owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/audio-headroom-${digest}.wav`,
    nativeFrames: 480, sampleRateHz: 48000, channels: 2, sectionIds: ["loop"], technicalStatus: "needs_audition", contextRetained: true };
  const approved = { state: "consumed", basis, fingerprint: sha256Hex(canonicalJson(basis)), approvalFingerprint: "e".repeat(64) };
  const calls: string[] = [];
  let current: unknown = approved;
  let afterRead = () => {};
  const input = { ...scope, readApproved: async () => { calls.push("approval"); return current; },
    assertLease: async () => { calls.push("lease"); } };
  const read: Parameters<typeof verifyYuE2ResumeSource>[1] = async (key, bucket, options) => {
    calls.push("bytes"); assert.equal(key, basis.listeningAudioKey); assert.equal(bucket, "youtube-studio-ai-private");
    assert.deepEqual(options, { timeoutMs: 120000, maxBytes: 480 * 8 + 65536 });
    afterRead(); return bytes;
  };
  return { input, approved, bytes, read, calls,
    setCurrent: (value: unknown) => { current = value; }, afterRead: (fn: () => void) => { afterRead = fn; } };
}

test("resume verifies only the approved private listening bytes and fences both sides of the read", async () => {
  const f = fixture();
  assert.deepEqual(await verifyYuE2ResumeSource(f.input, f.read), {
    listeningAudioSha256: f.approved.basis.listeningAudioSha256, byteLength: f.bytes.length,
  });
  assert.deepEqual(f.calls, ["lease", "approval", "bytes", "approval", "lease"]);
});

test("bad checkpoint, source scope, invocation and excessive sizes fail before storage", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.setCurrent(null),
    (f: ReturnType<typeof fixture>) => { f.approved.state = "queued"; },
    (f: ReturnType<typeof fixture>) => { f.input.ownerId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.input.channelId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.input.runId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.input.invocationSha256 = "f".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.approved.fingerprint = "f".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.approved.basis.listeningAudioKey = "public/foreign.wav"; },
    (f: ReturnType<typeof fixture>) => {
      f.approved.basis.nativeFrames = Number.MAX_SAFE_INTEGER;
      f.approved.fingerprint = sha256Hex(canonicalJson(f.approved.basis));
    },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(verifyYuE2ResumeSource(f.input, f.read));
    assert.ok(!f.calls.includes("bytes"));
  }
});

test("missing, unavailable, truncated, oversized and altered storage bytes never pass admission", async () => {
  for (const data of [Buffer.alloc(0), Buffer.alloc(44), Buffer.alloc(480 * 8 + 65537), Buffer.alloc(44 + 480 * 8, 2)]) {
    const f = fixture();
    await assert.rejects(verifyYuE2ResumeSource(f.input, async () => data), /approved listening bytes/);
    assert.deepEqual(f.calls, ["lease", "approval"]);
  }
  for (const reason of ["NoSuchKey", "AccessDenied", "storage timeout"]) {
    const f = fixture();
    await assert.rejects(verifyYuE2ResumeSource(f.input, async () => { throw new Error(reason); }), new RegExp(reason));
  }
});

test("approval replacement, revocation and lost lease during the download fail closed", async () => {
  for (const replacement of [null, "replacement", "basis"]) {
    const f = fixture(); f.afterRead(() => f.setCurrent(replacement === null ? null : {
      ...f.approved, ...(replacement === "replacement" ? { approvalFingerprint: "f".repeat(64) }
        : { basis: { ...f.approved.basis, sectionIds: ["different"] } }),
    }));
    await assert.rejects(verifyYuE2ResumeSource(f.input, f.read));
    assert.deepEqual(f.calls, ["lease", "approval", "bytes", "approval"]);
  }
  const f = fixture(); f.afterRead(() => { f.input.assertLease = async () => { throw new Error("lost lease"); }; });
  await assert.rejects(verifyYuE2ResumeSource(f.input, f.read), /lost lease/);
  const initial = fixture(); initial.input.assertLease = async () => { throw new Error("lost initial lease"); };
  await assert.rejects(verifyYuE2ResumeSource(initial.input, initial.read), /lost initial lease/);
  assert.deepEqual(initial.calls, []);
});

test("worker applies preflight to ordinary recovered runs as well as explicit audition resumes, before engine admission", () => {
  const source = readFileSync("src/trigger/runPipeline.ts", "utf8");
  assert.match(source, /resumingYuE2 = Boolean\(payload\.yue2AuditionResume \|\| durableRun\.yue2ContinuationId\)/u);
  const guard = source.indexOf("if (resumingYuE2) {"), preflight = source.indexOf("await verifyYuE2ResumeSource", guard);
  assert.ok(guard > 0 && preflight > guard && preflight < source.indexOf("const engineOpts ="));
  assert.match(source.slice(preflight, preflight + 700), /readApproved: \(\) => convex\.query\(yue2ContinuationsApi\.getApproved/u);
  assert.match(source.slice(preflight, preflight + 700), /assertLease: assertInlinePaidExecutionLease/u);
});
