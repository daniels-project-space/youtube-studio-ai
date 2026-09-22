import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { laneQualityPolicy } from "@/engine/contentLane";
import { composeMusicLoopDeblur } from "../ffmpeg";
import { validateRender } from "../renderValidate";
import { sha256ShotAnalysisSource } from "../shotAnalysis";
import { verifyMusicLoopVideoRepetition } from "../musicLoopVideoRepetition";
import { MUSIC_LOOP_REVIEW_JOIN_TIMES, MusicLoopReviewCoverageSchema, musicLoopReviewGap } from "../musicLoopReviewCoverage";

const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
const policy = laneQualityPolicy("music_loop");
const channel = { contentLaneKey: "music_loop", maxStaticHoldSec: policy.maxStaticHoldSec, visualPacingPolicy: policy.visualPacing };
const frameTimes = [...Array.from({ length: 18 }, (_, index) => index * 5 + 2.5), ...MUSIC_LOOP_REVIEW_JOIN_TIMES];
async function proof(path: string) {
  const { elapsedMs, ...repetition } = await verifyMusicLoopVideoRepetition(path, 180);
  void elapsedMs;
  return { frameTimes, coverage: MusicLoopReviewCoverageSchema.parse({ version: "music-loop-review-coverage/v1",
    sampledDurationSec: 90, maxGapSec: musicLoopReviewGap(frameTimes), maxAllowedGapSec: 6, repetition }) };
}
function render(args: string[]) {
  childProcess.execFileSync(ffmpeg, ["-hide_banner", "-v", "error", "-y", ...args], { timeout: 60000 });
}

test("EOF exemption preserves a short ending, not a mostly or wholly black programme", async () => {
  const dir = await mkdtemp(join(tmpdir(), "black-eof-"));
  try {
    for (const [name, blackStart, expected] of [["whole", 0, "fail"], ["long", 2, "fail"], ["tail", 11, "pass"]] as const) {
      const path = join(dir, `${name}.mp4`);
      render(["-f", "lavfi", "-i", "color=c=white:s=160x96:r=30:d=14", "-vf",
        `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='gte(t,${blackStart})'`, "-c:v", "libx264", path]);
      const result = await validateRender({ videoPath: path, durationSec: 14, channel: { ...channel, blackSegmentMinSec: 2.5 } });
      assert.equal(result.ran, true); assert.equal(result.verdict, expected);
      if (expected === "fail") assert.ok(result.defects.some(defect => /dead air/.test(defect.issue)));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("proof-bound 90s black scan agrees with full decode and catches wrap-spanning darkness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-black-gate-"));
  try {
    const audio = join(dir, "audio.wav");
    render(["-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "pcm_f32le", audio]);
    for (const bad of [false, true]) {
      const input = join(dir, `${bad}-source.mp4`), master = join(dir, `${bad}-master.mp4`);
      render(["-f", "lavfi", "-i", "color=c=white:s=160x96:r=30:d=30",
        ...(bad ? ["-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,4)+gte(t,26)'"] : []),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", input]);
      await composeMusicLoopDeblur({ loopUnitPath: input, musicPath: audio, outPath: master,
        durationSec: 180, width: 160, height: 96, fps: 30, timeoutMs: 120000 });
      const musicLoopReview = await proof(master);
      const options = { videoPath: master, durationSec: 180, channel };
      const full = await validateRender(options), bounded = await validateRender({ ...options, musicLoopReview });
      assert.equal(full.verdict, bad ? "fail" : "pass"); assert.equal(bounded.verdict, full.verdict);
      assert.equal(bounded.ran, true); assert.equal(bounded.blackFrameEvidence?.decodedDurationSec, 90);
      assert.equal(bounded.blackFrameEvidence?.sourceDurationSec, 180);
      if (bad) assert.ok(bounded.defects.some(defect => (defect.tSec ?? 0) > 50 && /dead air: 8.0s/.test(defect.issue)),
        "a six-second gate must catch two four-second dark edges joined across the body wrap");
      else {
        const badProof = structuredClone(musicLoopReview); badProof.coverage.repetition.masterSha256 = "0".repeat(64);
        const refused = await validateRender({ ...options, musicLoopReview: badProof });
        assert.equal(refused.ran, false); assert.equal(refused.verdict, "fail"); assert.equal(refused.blackFrameEvidence, undefined);
        const changed = join(dir, "changed.mp4"); await copyFile(master, changed); appendFileSync(changed, Buffer.from([0]));
        const mismatch = await validateRender({ ...options, videoPath: changed, musicLoopReview });
        assert.equal(mismatch.ran, false); assert.equal(mismatch.verdict, "fail");
        const originalSpawn = childProcess.spawnSync;
        const spy = mock.method(childProcess, "spawnSync", (...args: Parameters<typeof childProcess.spawnSync>) => {
          const result = originalSpawn(...args);
          if ((args[1] as string[]).some(arg => arg.includes("blackdetect"))) appendFileSync(master, Buffer.from([0]));
          return result;
        });
        try {
          const during = await validateRender({ ...options, musicLoopReview });
          assert.equal(during.ran, false); assert.equal(during.verdict, "fail");
          assert.match(during.defects[0].issue, /source changed/);
        } finally { spy.mock.restore(); }
        await assert.rejects(sha256ShotAnalysisSource(master, { signal: AbortSignal.abort() }), /cannot read final-master/);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
