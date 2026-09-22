import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { composeMusicLoopDeblur } from "../ffmpeg";
import { reviewRender, type VisualReviewer } from "../visualReview";
import { MUSIC_LOOP_REVIEW_JOIN_TIMES } from "../musicLoopReviewCoverage";
import { createFinalMasterReleaseCertificate, createVisualReviewReleaseReceipt, FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  visualReviewManifestFingerprint, visualReviewReleaseReceiptKey, verifyFinalMasterReleaseEvidenceObjects } from "../finalMasterReleaseCertificate";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
test("real repeated master passes bounded review transport and durable coverage admission; late corruption spends zero reviews", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-visual-review-"));
  const frameDirs = new Set<string>();
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg", ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
  const video = join(dir, "input.mp4"), audio = join(dir, "input.wav"), master = join(dir, "master.mp4");
  try {
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x96:r=30:d=1",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { timeout: 30000 });
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=1",
      "-ac", "2", "-c:a", "pcm_f32le", audio], { timeout: 30000 });
    await composeMusicLoopDeblur({ loopUnitPath: video, musicPath: audio, outPath: master,
      durationSec: 180, width: 160, height: 96, fps: 30, timeoutMs: 120000 });
    const bytes = await readFile(master), sourceSha256 = hash(bytes);
    let calls = 0;
    const reviewer: VisualReviewer = async input => {
      calls++; assert.ok(input.frames.length <= 2);
      assert.match(input.prompt, /REPEATED MUSIC VISUAL/);
      assert.match(input.prompt, /quiet seaside identity/);
      for (const frame of input.frames) {
        assert.ok(frame.tSec <= 90); assert.ok((await readFile(frame.localPath)).length > 500);
        frameDirs.add(dirname(frame.localPath));
      }
      return JSON.stringify({ defects: [], summary: "Hermetic reviewer transport, not perceptual approval", broadQualityScore: 9 });
    };
    const intent = { title: "Loop transport fixture", channelWorld: "quiet seaside identity", expectTitleCard: false, expectOutroCard: false };
    const options = { runId: "loop-review-fixture", required: true, sourceSha256,
      verifyRepeatedMusicVideo: true, persistEvidence: false, maxFrames: 18, maxFocusFrames: 0,
      requireBroadQualityScore: true, reviewer };
    const result = await reviewRender(master, 180, intent, options);
    assert.equal(result.verdict, "pass"); assert.ok(calls > 0 && calls <= 14);
    assert.ok(result.evidence.coverage.maxGapSec > result.evidence.coverage.maxAllowedGapSec,
      "the real full-programme sampling gap must not be disguised");
    assert.ok(result.evidence.coverage.musicLoop!.maxGapSec <= 6.01);
    for (const time of MUSIC_LOOP_REVIEW_JOIN_TIMES) assert.ok(result.evidence.frames.some(frame => Math.abs(frame.tSec - time) < 0.01));

    const prefix = "owners/loop-review-fixture/", runId = "loop-review-fixture", root = `${prefix}runs/${runId}`;
    const objects = new Map<string, Uint8Array>();
    const frames = await Promise.all(result.evidence.frames.map(async (frame, index) => {
      const bytes = await readFile(result.framePaths[index]);
      const r2Key = `${root}/review/${frame.id}.jpg`; objects.set(r2Key, bytes);
      return { ...frame, r2Key, contentSha256: hash(bytes), byteLength: bytes.length };
    }));
    const manifest = { ...result.evidence, manifestKey: `${root}/manifest.json`, frames };
    const frameArtifacts = frames.map(({ id, tSec, r2Key, contentSha256, byteLength }) => ({ id, tSec, r2Key, contentSha256, byteLength }));
    const receipt = createVisualReviewReleaseReceipt({ reviewFingerprint: result.reviewFingerprint,
      reviewReceiptVersion: result.reviewReceiptVersion, reviewReceiptFingerprint: result.reviewReceiptFingerprint,
      verdict: "pass", summary: result.summary, defects: result.defects, focusWindows: result.focusWindows,
      referenceCriteria: result.referenceCriteria, referenceCriteriaComplete: true, broadQualityScore: result.broadQualityScore,
      evidence: { source: { sha256: sourceSha256, durationSec: 180 }, manifestKey: manifest.manifestKey,
        manifestFingerprint: visualReviewManifestFingerprint(manifest), frameKeys: frames.map(frame => frame.r2Key), frameArtifacts } });
    const receiptKey = visualReviewReleaseReceiptKey(prefix, runId, receipt.releaseReceiptFingerprint);
    objects.set(receiptKey, Buffer.from(JSON.stringify(receipt))); objects.set(manifest.manifestKey, Buffer.from(JSON.stringify(manifest)));
    const certificate = createFinalMasterReleaseCertificate({ version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
      finalMaster: { r2Key: `${root}/final.mp4`, sha256: sourceSha256, durationSec: 180, byteLength: bytes.length },
      visualReview: { evidenceManifestKey: manifest.manifestKey, evidenceFrameKeys: frames.map(frame => frame.r2Key), evidenceFrameArtifacts: frameArtifacts,
        receiptKey, reviewFingerprint: result.reviewFingerprint, reviewReceiptVersion: result.reviewReceiptVersion,
        reviewReceiptFingerprint: result.reviewReceiptFingerprint, releaseReceiptFingerprint: receipt.releaseReceiptFingerprint } });
    await verifyFinalMasterReleaseEvidenceObjects({ certificate, getObjectIntegrity: async () => ({ sha256: sourceSha256, byteLength: bytes.length }),
      getObjectBytes: async key => { assert.ok(objects.has(key)); return objects.get(key)!; } });
    const { version: _receiptVersion, releaseReceiptFingerprint: _receiptHash, ...receiptInput } = receipt;
    const { certificateFingerprint: _certificateHash, ...certificateInput } = certificate;
    void _receiptVersion; void _receiptHash; void _certificateHash;
    for (const bad of [
      { ...manifest.coverage.musicLoop!, maxGapSec: 0 },
      { ...manifest.coverage.musicLoop!, repetition: { ...manifest.coverage.musicLoop!.repetition, packetCount: 1 } },
    ]) {
      const replaced = { ...manifest, coverage: { ...manifest.coverage, musicLoop: bad } };
      const resealed = createVisualReviewReleaseReceipt({ ...receiptInput,
        evidence: { ...receiptInput.evidence, manifestFingerprint: visualReviewManifestFingerprint(replaced) } });
      const key = visualReviewReleaseReceiptKey(prefix, runId, resealed.releaseReceiptFingerprint);
      objects.set(key, Buffer.from(JSON.stringify(resealed)));
      objects.set(manifest.manifestKey, Buffer.from(JSON.stringify(replaced)));
      const resealedCertificate = createFinalMasterReleaseCertificate({ ...certificateInput,
        visualReview: { ...certificateInput.visualReview, receiptKey: key, releaseReceiptFingerprint: resealed.releaseReceiptFingerprint } });
      await assert.rejects(verifyFinalMasterReleaseEvidenceObjects({ certificate: resealedCertificate,
        getObjectIntegrity: async () => ({ sha256: sourceSha256, byteLength: bytes.length }),
        getObjectBytes: async key => objects.get(key)! }), /music-loop review/);
    }

    calls = 0;
    for (const altered of [{ ...intent, expectOutroCard: true }, { ...intent, transcriptCues: [{ text: "speech", startSec: 0, endSec: 1 }] },
      { ...intent, overlays: [{ id: "late", startSec: 100, endSec: 110 }] }]) {
      await assert.rejects(reviewRender("/not-opened.mp4", 180, altered, options), /non-changing visual plan/);
    }
    await assert.rejects(reviewRender(master, 180, intent, { ...options, sourceSha256: "0".repeat(64) }), /different master/);
    const corrupt = join(dir, "corrupt.mp4"); await copyFile(master, corrupt);
    const inspected = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-read_intervals", "120%+#3",
      "-show_packets", "-show_entries", "packet=pos,size", "-of", "json", corrupt], { encoding: "utf8", timeout: 30000 }));
    const target = inspected.packets[1], handle = await open(corrupt, "r+");
    try {
      const packetStart = Number(target.pos), packetSize = Number(target.size);
      assert.ok(Number.isSafeInteger(packetStart) && packetStart >= 0, "packet offset must be a nonnegative safe integer");
      assert.ok(Number.isSafeInteger(packetSize) && packetSize >= 2, "packet must contain a valid corruption target");
      const packetEnd = packetStart + packetSize;
      assert.ok(Number.isSafeInteger(packetEnd) && packetEnd <= (await handle.stat()).size,
        "the whole target packet must be inside the fixture");
      const position = packetStart + Math.floor(packetSize / 2), byte = Buffer.alloc(1);
      assert.equal((await handle.read(byte, 0, 1, position)).bytesRead, 1);
      byte[0] ^= 1;
      assert.equal((await handle.write(byte, 0, 1, position)).bytesWritten, 1);
    } finally { await handle.close(); }
    await assert.rejects(reviewRender(corrupt, 180, intent, options), /payload or presentation mismatch/);
    assert.equal(calls, 0, "unreviewed late corruption and incompatible plans must not purchase vision calls");
  } finally {
    for (const path of frameDirs) await rm(path, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
