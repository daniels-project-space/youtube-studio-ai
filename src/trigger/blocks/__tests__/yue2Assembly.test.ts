import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { getFunctionName } from "convex/server";
import { createYuE2SourceApproval } from "@/engine/yue2SourceApproval";
import { YUE2_AUDITION_CHECKS } from "@/engine/yue2Audition";
import { canonicalJson } from "@/lib/canonicalJson";
import type { StageContext } from "@/engine/types";

const retained = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
const arrangement = retained.request.acceptedArrangement;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const frames = 12 * 48000;
const wav = Buffer.alloc(44 + frames * 8);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(384000, 28); wav.writeUInt16LE(8, 32);
wav.writeUInt16LE(32, 34); wav.write("data", 36); wav.writeUInt32LE(frames * 8, 40);
for (let i = 0; i < frames; i++) {
  const sample = 0.0612345 * Math.sin(2 * Math.PI * 233 * i / 48000);
  wav.writeFloatLE(sample, 44 + i * 8); wav.writeFloatLE(sample, 48 + i * 8);
}
const root = `owner/${arrangement.ownerId}/runs/${arrangement.runId}/music/yue2-evaluation/`;
const candidate = { version: "shared-yue2-music-candidate/v1", ownerId: arrangement.ownerId,
  channelId: arrangement.channelId, runId: arrangement.runId, arrangementFingerprint: arrangement.fingerprint,
  jobId: retained.candidate.jobId, candidateSha256: "a".repeat(64), candidateKey: `${root}candidate.json`,
  listeningAudioKey: `${root}audio-headroom-${hash(wav)}.wav`, listeningAudioSha256: hash(wav), nativeFrames: frames,
  sampleRateHz: 48000, channels: 2, technicalStatus: "needs_audition", allocatedCostUsdMicros: 4208,
  costBasis: "supervised_dispatch_wall_time", providerBilledCostUsdMicros: null, productionApproved: false };
const basis = { ownerId: candidate.ownerId, channelId: candidate.channelId, runId: candidate.runId,
  invocationSha256: "b".repeat(64), candidateSha256: candidate.candidateSha256,
  arrangementFingerprint: arrangement.fingerprint, jobId: candidate.jobId, listeningAudioKey: candidate.listeningAudioKey,
  listeningAudioSha256: candidate.listeningAudioSha256, nativeFrames: frames, sampleRateHz: 48000, channels: 2,
  sectionIds: arrangement.arrangement.sections.map((section: { id: string }) => section.id), technicalStatus: "needs_audition", contextRetained: true };
const submission = { candidateSha256: candidate.candidateSha256, verdict: "approved_for_assembly", listenedEntireSource: true,
  checks: Object.fromEntries(YUE2_AUDITION_CHECKS.map(key => [key, "pass"])),
  sections: basis.sectionIds.map((id: string) => ({ id, judgment: "pass", notes: "Synthetic decision, never approval of retained music." })),
  notes: "Synthetic all-pass fixture for the source-consumption boundary only." };
const approved = createYuE2SourceApproval({ basis, submission, reviewedAt: 12345, revision: 1 });
const material = { ...retained, candidateSha256: candidate.candidateSha256, listeningAudioKey: candidate.listeningAudioKey,
  candidate: { ...retained.candidate, headroom: { ...retained.candidate.headroom, audioSha256: hash(wav) },
    nativeOutput: { ...retained.candidate.nativeOutput, frames } } };
let approval: unknown = approved, source: Uint8Array = wav, currentMaterial = material;
let queries = 0, approvalReads = 0, privateReads = 0, durableReads = 0, leases = 0, revoked = false, revokeDuringPreparation = false;
let uploads = 0, afterEncode = () => {}, afterUpload = () => {};
let deliveredDurationOffset = 0;
const renders: Record<string, unknown>[] = [], temporary = new Set<string>();
let nativeEncode = false;
const proofDirectory = process.env.YUE2_ASSEMBLY_PROOF_DIR;
let runOwner = candidate.ownerId;
const originalEnv = { convex: process.env.CONVEX_URL, public: process.env.NEXT_PUBLIC_CONVEX_URL };
process.env.CONVEX_URL = "https://fixture.convex.cloud"; delete process.env.NEXT_PUBLIC_CONVEX_URL;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("No network or provider dispatch permitted"); };
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
async function encoded(path: string) { temporary.add(dirname(path)); await writeFile(path, "synthetic encoded boundary"); return path; }
loader._load = function (id, ...args) {
  if (id.endsWith("/studioConvexHttpClient")) return { StudioConvexHttpClient: class {
    async query(ref: Parameters<typeof getFunctionName>[0], input: Record<string, unknown>) {
      queries++;
      if (getFunctionName(ref) === "runs:getRun") return { _id: candidate.runId, ownerId: runOwner, channelId: candidate.channelId, pipelineInvocationSha256: basis.invocationSha256 };
      assert.equal(getFunctionName(ref), "yue2Auditions:getSourceApproval");
      assert.deepEqual(input, { ownerId: candidate.ownerId, channelId: candidate.channelId, runId: candidate.runId,
        candidateSha256: candidate.candidateSha256, invocationSha256: basis.invocationSha256 });
      approvalReads++;
      return revokeDuringPreparation && approvalReads > 1 ? null : approval;
    }
    async mutation(ref: Parameters<typeof getFunctionName>[0]) { assert.equal(getFunctionName(ref), "assets:recordAsset"); }
  } };
  if (id.endsWith("/yue2DurableEvaluation")) return {
    readDurableYuE2Candidate: async () => { durableReads++; return structuredClone(currentMaterial); },
    executeDurableYuE2Evaluation: async () => { throw new Error("Adoption must never generate"); },
  };
  if (id.endsWith("/storage")) return {
    getObjectBytes: async (key: string, bucket?: string) => {
      assert.equal(key, candidate.listeningAudioKey, "no legacy/default music key fallback");
      assert.equal(bucket, "youtube-studio-ai-private"); privateReads++; return source;
    },
    putObjectFromFile: async (_key: string, path: string) => { assert.ok((await readFile(path)).length); uploads++; afterUpload(); },
    putObject: async () => { uploads++; },
    publicUrl: (key: string) => `https://fixture.invalid/${key}`,
  };
  const actual = originalLoad.call(this, id, ...args);
  if (id.endsWith("/ffmpeg")) {
    const real = actual as typeof import("@/lib/ffmpeg");
    return { ...real,
    probe: async (path: string) => {
      if (nativeEncode) return real.probe(path);
      const rendered = renders.find(input => input.outPath === path);
      const durationSec = rendered ? Number(rendered.durationSec ?? (Number(rendered.introSec) + Number(rendered.bodySec) + Number(rendered.tailSec))) + deliveredDurationOffset : 10;
      return { durationSec, width: 320, height: 176, hasAudio: true };
    },
    measureLoopSeamDiff: async () => 0,
    assembleBeatBody: async (input: Parameters<typeof real.assembleBeatBody>[0]) => nativeEncode ? real.assembleBeatBody(input) : encoded(String(input.outPath)),
    normalizeAudioOnly: async (...input: Parameters<typeof real.normalizeAudioOnly>) => nativeEncode ? real.normalizeAudioOnly(...input) : encoded(input[1]),
    composeWithIntro: async (input: Parameters<typeof real.composeWithIntro>[0]) => {
      renders.push(input); temporary.add(dirname(input.outPath));
      const result = await (nativeEncode ? real.composeWithIntro(input) : encoded(input.outPath));
      afterEncode(); return result;
    },
    composeMusicLoopDeblur: async (input: Record<string, unknown>) => {
      const audio = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", String(input.musicPath)], { encoding: "utf8" })).streams[0];
      assert.equal(audio.codec_name, "pcm_f32le"); assert.equal(audio.sample_rate, "48000"); assert.equal(audio.duration_ts, frames - 96000);
      renders.push(input); const result = await encoded(String(input.outPath)); afterEncode(); return result;
    },
  }; }
  return actual;
};
const load = createRequire(__filename);
function reset() { approval = approved; source = wav; currentMaterial = material; runOwner = candidate.ownerId;
  uploads = 0; afterEncode = () => {}; afterUpload = () => {};
  deliveredDurationOffset = 0;
  queries = 0; approvalReads = 0; privateReads = 0; durableReads = 0; leases = 0; revoked = false; revokeDuringPreparation = false; renders.length = 0; }
async function main() {
  const { registerAllBlocks, _resetBlocks } = load("@/engine/blocks") as typeof import("@/engine/blocks");
  const { getManifest, allManifests, registerManifest } = load("@/engine/registry") as typeof import("@/engine/registry");
  const { manifestFromBlock } = load("@/engine/moduleManifest") as typeof import("@/engine/moduleManifest");
  const { validatePipeline } = load("@/engine/validate") as typeof import("@/engine/validate");
  const { validateArtifact } = load("@/engine/artifactSchemas") as typeof import("@/engine/artifactSchemas");
  const { prepareApprovedYuE2AssemblySource } = load("@/lib/approvedYuE2AssemblySource") as typeof import("@/lib/approvedYuE2AssemblySource");
  _resetBlocks(); registerAllBlocks();
  registerManifest(manifestFromBlock({ id: "approved_source_fixture", consumes: [],
    produces: ["yue2MusicCandidate", "acceptedMusicArrangement"], run: async () => ({ yue2MusicCandidate: candidate, acceptedMusicArrangement: arrangement }) },
  { capabilities: ["audio.music_candidate", "music.arrangement.accepted"] }));
  for (const [id, inputs] of [["assemble", ["loopUnitKey"]],
    ["timeline_assemble", ["footageClips", "narrationLocalPath", "narrationDurationSec"]]] as const) {
    const entry = { block: id, version: "3.0.0-yue2-reviewed-loop" };
    assert.doesNotThrow(() => validatePipeline([{ block: "approved_source_fixture" }, entry], [...inputs]));
    assert.throws(() => validatePipeline([entry], [...inputs]));
    assert.throws(() => validatePipeline([entry, { block: "approved_source_fixture" }], [...inputs]));
    assert.throws(() => validatePipeline([{ block: "approved_source_fixture" }, { block: id }], [...inputs]), /musicUrl/);
  }
  const directory = await mkdtemp(join(tmpdir(), "yue2-assembly-fixture-")); temporary.add(directory);
  const picture = join(directory, "picture.mp4"), narration = join(directory, "narration.mp3");
  await writeFile(picture, "synthetic picture boundary"); await writeFile(narration, "synthetic narration boundary");
  if (proofDirectory) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x176:r=30:d=10",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", picture]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=523:sample_rate=48000:duration=10", "-c:a", "libmp3lame", narration]);
  }
  const ctx: StageContext = { ownerId: candidate.ownerId, channelId: candidate.channelId, runId: candidate.runId,
    keyPrefix: `owner/${candidate.ownerId}/`, budgetUsd: 1, params: {}, log: () => {},
    assertInlinePaidExecutionLease: async () => { leases++; if (revoked) throw new Error("revoked execution"); },
    store: { yue2MusicCandidate: candidate, acceptedMusicArrangement: arrangement, loopUnitKey: "unused-loop-key", loopUnitUrl: picture,
      loopSourceDurationSec: 30, loopSourceSegmentCount: 2, loopSourceInternalSeamDiff: 0, loopSourceWrapSeamDiff: 0,
      footageClips: [picture], entityClips: [], narrationLocalPath: narration, narrationDurationSec: 10,
      musicBrief: { directives: { bodyMusicVol: 0.04, targetLufs: -16 } },
    } };
  for (const id of ["assemble", "timeline_assemble"]) {
    reset();
    nativeEncode = Boolean(proofDirectory) && id === "timeline_assemble";
    const manifest = getManifest(id, "3.0.0-yue2-reviewed-loop")!;
    assert.ok(manifest); assert.ok(!allManifests().includes(manifest));
    assert.equal(manifest.consumes.musicUrl, undefined); assert.equal(manifest.optionalConsumes.musicKey, undefined);
    assert.ok(getManifest(id)!.consumes.musicUrl, "legacy contract unchanged");
    // Fail on undeclared and legacy music reads, just like the engine store boundary.
    const store = new Proxy(ctx.store, { get: (target, key: string) => {
      assert.ok(key in manifest.consumes || key in manifest.optionalConsumes, `undeclared input ${key}`); return target[key];
    } });
    const result = await manifest.execute({ ...ctx, store, params: { durationSec: 3600, tailSec: 0, burnCaptions: false, transitions: "hardcut" } });
    const evidence = validateArtifact(manifest.produces.yue2AssemblySource, result.yue2AssemblySource) as Record<string, unknown>;
    assert.equal(evidence.approvalFingerprint, approved.fingerprint); assert.equal(evidence.publishingApproved, false);
    assert.equal(evidence.preparedFrames, frames - 96000); assert.equal(renders.length, 1);
    assert.equal(privateReads, 1); assert.equal(approvalReads, 4); assert.equal(durableReads, 1); assert.equal(leases, 4);
    assert.ok(!("musicUrl" in result) && !("musicKey" in result));
    await assert.rejects(readFile(String(renders[0].musicPath)), /ENOENT/, "private local source cleaned after render");
    if (id === "timeline_assemble") assert.equal(renders[0].bodyMusicVol, 0.04, "composer intent reaches real narrated compositor");
    if (nativeEncode && proofDirectory) {
      const inspection = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", String(result.videoLocalPath)], { encoding: "utf8" }));
      const video = inspection.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      const audio = inspection.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
      await mkdir(proofDirectory, { recursive: true });
      await copyFile(String(result.videoLocalPath), join(proofDirectory, "native-master.mp4"));
      await writeFile(join(proofDirectory, "inspection.json"), JSON.stringify(inspection, null, 2) + "\n");
      assert.equal(video.width, 1920); assert.equal(video.height, 1080);
      assert.equal(Number(video.duration), 10); assert.equal(Number(video.nb_frames), 300);
      assert.equal(Number(audio.duration), 10); assert.equal(Number(inspection.format.duration), 10);
      assert.equal(Number(audio.sample_rate), 48000);
      const pcm = execFileSync("ffmpeg", ["-v", "error", "-ss", "3", "-t", "4", "-i", String(result.videoLocalPath),
        "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 2_000_000 });
      const amplitude = (frequency: number) => {
        const count = pcm.length / 4; let cosine = 0, sine = 0;
        for (let i = 0; i < count; i++) {
          const sample = pcm.readFloatLE(i * 4), angle = 2 * Math.PI * frequency * i / 48000;
          cosine += sample * Math.cos(angle); sine += sample * Math.sin(angle);
        }
        return 2 * Math.hypot(cosine, sine) / count;
      };
      const sourceToneAmplitude = amplitude(233), narrationToneAmplitude = amplitude(523);
      const assertMusicPresent = (frequency: number) => assert.ok(amplitude(frequency) > narrationToneAmplitude * 0.01,
        "decoded final mix must contain the independently identifiable source tone");
      assert.ok(narrationToneAmplitude > 0.01); assertMusicPresent(233);
      assert.throws(() => assertMusicPresent(317), "an unrelated source tone must fail the same oracle");
      await writeFile(join(proofDirectory, "evidence.json"), JSON.stringify({
        version: "reviewed-yue2-assembly-native-proof/v1", sourceEvidence: evidence,
        videoFrames: Number(video.nb_frames), width: video.width, height: video.height, durationSec: 10,
        audioSampleRateHz: Number(audio.sample_rate), masterSha256: hash(await readFile(String(result.videoLocalPath))),
        sourceToneAmplitude, narrationToneAmplitude, wrongSourceToneRejected: true,
        sourceAndApproval: "synthetic_fixture", providerAndDatabase: "mocked_transport", encoder: "actual_production_ffmpeg",
        productionApproved: false,
      }, null, 2) + "\n");
      console.log(`Native 1080p reviewed-source assembly proof: ${proofDirectory}`);
    }
  }
  nativeEncode = false;
  const loopManifest = getManifest("assemble", "3.0.0-yue2-reviewed-loop")!;
  for (const durationSec of [3600, 7200, 28800]) {
    reset();
    const result = await loopManifest.execute({ ...ctx,
      params: { durationSec, deblurIntro: false }, store: { ...ctx.store, introCardPath: picture, introSec: 5 },
    });
    assert.equal(result.videoDurationSec, durationSec, "the authored final clock includes the intro");
    assert.equal(renders[0].introSec, 5); assert.equal(renders[0].bodySec, durationSec - 5);
    assert.equal(renders[0].audioSampleRateHz, 48000);
  }
  reset();
  await loopManifest.execute({ ...ctx, params: { durationSec: 3600, deblurIntro: false } });
  assert.equal(renders[0].introSec, 0); assert.equal(renders[0].bodySec, 3600);
  for (const offset of [-1, 0.008, 5, NaN]) {
    reset(); deliveredDurationOffset = offset;
    await assert.rejects(loopManifest.execute({ ...ctx, params: { durationSec: 3600 } }), /rendered final duration/);
    assert.equal(uploads, 0, "a wrong physical output clock must be rejected before upload");
  }
  for (const introSec of [NaN, Infinity, -1, 0, 3600, 7200]) {
    reset();
    await assert.rejects(loopManifest.execute({ ...ctx, params: { durationSec: 3600, deblurIntro: false },
      store: { ...ctx.store, introCardPath: picture, introSec } }), /intro must fit/);
    assert.equal(renders.length, 0); assert.equal(uploads, 0);
  }
  reset();
  const { createLoopAssemblyBlock } = load("../lofiBlocks") as typeof import("../lofiBlocks");
  const legacy = await createLoopAssemblyBlock(async () => narration).run({ ...ctx,
    params: { durationSec: 3600, deblurIntro: false }, store: { ...ctx.store, introCardPath: picture, introSec: 5 } });
  assert.equal(legacy.videoDurationSec, 3605, "legacy timing remains unchanged for before/after comparisons");
  assert.equal(renders[0].bodySec, 3600);
  for (const id of ["assemble", "timeline_assemble"]) {
    const manifest = getManifest(id, "3.0.0-yue2-reviewed-loop")!;
    for (const phase of ["encode", "upload"] as const) {
      for (const change of [
        () => { approval = null; },
        () => { approval = createYuE2SourceApproval({ basis, submission, reviewedAt: 23456, revision: 2 }); },
        () => { revoked = true; },
        () => { approval = { ...approved, basis: { ...basis, invocationSha256: "c".repeat(64) } }; },
      ]) {
        reset();
        if (phase === "encode") afterEncode = change; else afterUpload = change;
        await assert.rejects(manifest.execute({ ...ctx,
          params: { durationSec: 3600, tailSec: 0, burnCaptions: false, transitions: "hardcut" },
        }), `${id} must not return successful artifacts after authority changes during ${phase}`);
        assert.equal(renders.length, 1, "failure must exercise the post-encode boundary");
        if (phase === "encode") assert.equal(uploads, 0, "revoked source must not enter output storage");
        else assert.ok(uploads > 0, "mid-upload revocation must reject the completed stage");
        assert.equal(privateReads, 1); assert.equal(durableReads, 1, "no repeated large storage downloads or regeneration");
        await assert.rejects(readFile(String(renders[0].musicPath)), /ENOENT/, "private source cleaned on authority failure");
      }
    }
  }
  for (const change of [() => { approval = null; }, () => { runOwner = "foreign"; },
    () => { approval = { ...approved, fingerprint: "f".repeat(64) }; }, () => { revoked = true; }]) {
    reset(); change(); await assert.rejects(prepareApprovedYuE2AssemblySource(ctx, 2));
    assert.equal(privateReads + durableReads + renders.length, 0, "approval/authority fails before audio or encode");
  }
  reset(); source = Buffer.from(wav); source[100] ^= 1;
  await assert.rejects(prepareApprovedYuE2AssemblySource(ctx, 2), /bytes changed/);
  reset(); revokeDuringPreparation = true;
  await assert.rejects(prepareApprovedYuE2AssemblySource(ctx, 2)); assert.equal(renders.length, 0);
  reset();
  for (const patch of [{ nativeFrames: frames + 1 }, { channelId: "foreign" }, { technicalStatus: "blocked" }]) {
    await assert.rejects(prepareApprovedYuE2AssemblySource({ ...ctx, store: { ...ctx.store, yue2MusicCandidate: { ...candidate, ...patch } } }, 2));
  }
  const once = structuredClone(arrangement); once.arrangement.playback = "once";
  const { fingerprint: _fingerprint, ...body } = once; void _fingerprint; once.fingerprint = hash(canonicalJson(body));
  reset(); await assert.rejects(prepareApprovedYuE2AssemblySource({ ...ctx, store: { ...ctx.store, acceptedMusicArrangement: once } }, 2));
  assert.equal(queries, 0);
  for (const params of [{ useAssemblyEdl: true }, { sourceCrossfadeSec: 4.5 }]) {
    await assert.rejects(getManifest("timeline_assemble", "3.0.0-yue2-reviewed-loop")!.execute({ ...ctx, params }));
  }
  await assert.rejects(getManifest("timeline_assemble", "3.0.0-yue2-reviewed-loop")!.execute({ ...ctx,
    store: { ...ctx.store, healClasses: { timeline_assemble: ["overlay_finish"] } } }), /fresh full composition/);
  assert.equal(queries, 0);
  console.log(`YUE2 ASSEMBLY PASS: real private-source preparation and FLOAT fold; both actual renderer blocks consume approved audio and reject fallback/revocation/corruption; ${proofDirectory ? "narrated encode real, loop encode mocked" : "encode mocked"}; provider/database transports mocked`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
  if (originalEnv.convex === undefined) delete process.env.CONVEX_URL; else process.env.CONVEX_URL = originalEnv.convex;
  if (originalEnv.public === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL; else process.env.NEXT_PUBLIC_CONVEX_URL = originalEnv.public;
  for (const path of temporary) await rm(path, { recursive: true, force: true });
});
