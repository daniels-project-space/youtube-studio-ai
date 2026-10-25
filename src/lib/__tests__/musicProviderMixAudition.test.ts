import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { createMusicProviderAuditionSource, createMusicAuditionCheckpointV2,
  createMusicAuditionCheckpoint, assertMusicAuditionNativeBytes } from "@/engine/musicAuditionCheckpoint";
import { createMusicAuditionReviewReceipt, assertMusicAuditionReviewReceiptForCheckpoint } from "@/engine/musicAuditionReview";
import { MUSIC_PROVIDER_MIX_MAX_SECONDS } from "@/engine/musicAuditionLimits";
import { decodeMusicAuditionPcmWav } from "@/lib/ffmpeg";
import { measureNativeMusicQuality } from "@/lib/nativeMusicQuality";
import { sha256BytesHex } from "@/lib/sha256";

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "music-mix-audition-"));
  try {
    const durationSec = 420;
    const input = join(directory, "mix.mp3"), wav = join(directory, "review.wav");
    const rendered = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      `aevalsrc=0.22*sin(2*PI*440*t)+0.13*sin(2*PI*8000*t):s=32000:d=${durationSec}`,
      "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", input], { encoding: "utf8", timeout: 30_000 });
    assert.equal(rendered.status, 0, rendered.stderr);
    const decoded = await decodeMusicAuditionPcmWav(input, wav, durationSec);
    assert.ok(decoded.byteLength > 50_000_000, "exercise both the old five-minute and 50 MB ceilings");
    assert.ok(Math.abs(decoded.durationSec - durationSec) < 0.1, "retain the entire mix, not a preview");
    const audio = await readFile(wav), sourceBytes = await readFile(input);
    const program = createChannelMusicProgram({ channelId: "mix-channel", channelIdentityFingerprint: "a".repeat(64),
      family: "music_loop", contentLaneKey: "music_loop", topic: "Rain behind the window", providerPreference: "suno" });
    const sourceInput = { ownerId: "mix-owner", channelId: "mix-channel", runId: "mix-run", provider: "suno" as const,
      program, sourceMusicKey: "owner/mix-owner/runs/mix-run/audio/music.mp3", sourceBytes, durationSec,
      auditionWavKey: `owner/mix-owner/runs/mix-run/audio/music-audition-${sha256BytesHex(audio)}.wav`, auditionWavBytes: audio };
    const source = createMusicProviderAuditionSource(sourceInput);
    assertMusicAuditionNativeBytes({ expected: source.auditionOutput, bytes: audio });
    const checkpoint = createMusicAuditionCheckpointV2({ ownerId: "mix-owner", channelId: "mix-channel", runId: "mix-run",
      invocationSha256: "b".repeat(64), program, source, expectedMusicKey: source.sourceMusicKey,
      channelMusicProgramKey: "owner/mix-owner/runs/mix-run/audio/program.json",
      musicProviderAuditionSourceKey: `owner/mix-owner/runs/mix-run/audio/music-provider-audition-${source.fingerprint}.json` });
    assert.equal(checkpoint.auditionOutput.durationSec, durationSec);
    const review = createMusicAuditionReviewReceipt({ checkpoint, program, reviewerId: "mix-owner", reviewedAt: 1,
      sectionReviews: program.generation.sections.map(section => ({ sectionId: section.id, score: 0.3, evidence: "The development repeats." })),
      audition: { emotionalDepthScore: 0.3, arrangementDepthScore: 0.3, hollowOrGeneric: true, verdict: "fail", notes: "Needs more development." } });
    assert.equal(assertMusicAuditionReviewReceiptForCheckpoint(review, checkpoint, "mix-owner").output.durationSec, durationSec);
    const technical = await measureNativeMusicQuality({ audio, durationSec, sourceKind: "provider_mix" });
    assert.ok(Number.isFinite(technical.measurements.integratedLufs));
    assert.ok(technical.measurements.silenceFraction < 0.01);
    await assert.rejects(measureNativeMusicQuality({ audio, durationSec }), /6 to 300 seconds/,
      "native Music3 does not inherit the provider-mix allowance");
    await assert.rejects(decodeMusicAuditionPcmWav(input, wav, MUSIC_PROVIDER_MIX_MAX_SECONDS + 1), /requires a measured/);
    assert.throws(() => createMusicProviderAuditionSource({ ...sourceInput, durationSec: MUSIC_PROVIDER_MIX_MAX_SECONDS + 1 }), /bounds/);
    const changed = Uint8Array.from(audio); changed[44] ^= 1;
    assert.throws(() => assertMusicAuditionNativeBytes({ expected: source.auditionOutput, bytes: changed }), /does not match/);
    assert.throws(() => createMusicAuditionCheckpoint({ ownerId: "mix-owner", channelId: "mix-channel", runId: "mix-run",
      invocationSha256: "b".repeat(64), channelMusicProgramKey: "owner/mix-owner/runs/mix-run/audio/program.json",
      musicRuntimeReceiptKey: "owner/mix-owner/runs/mix-run/audio/runtime.json", musicNativeWavKey: source.auditionWavKey,
      program, runtimeReceipt: { programFingerprint: program.fingerprint, durationSec, output: source.auditionOutput } }));
    console.log("MUSIC MIX AUDITION PASS - real seven-minute stereo decode, immutable checkpoint, review and full-file QA; native limits retained");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
