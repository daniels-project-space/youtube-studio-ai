import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createAcceptedMusicArrangement } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import { RENDER_ENGINE_STUDIO_PROJECT_NAME } from "@/lib/renderEngineStudioProject";
import { RenderEngineYuE2RequestSchema } from "@/lib/renderEngineYuE2StageClient";

const execFileP = promisify(execFile);
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const files = ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "result.json"] as const;
const objects = new Map<string, Uint8Array>();
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "@/lib/storage" || /\/lib\/storage(?:\.ts)?$/u.test(id)) {
    return { getObjectBytes: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(new Error("missing fixture object"), { name: "NoSuchKey" });
      return bytes;
    } };
  }
  return originalLoad.call(this, id, ...args);
};
const candidateReader = import("@/lib/renderEngineYuE2Candidate");

const scope = { ownerId: "owner", channelId: "channel", runId: "run" };
const score = "X:1\nT:Quiet Rain\nM:4/4\nL:1/8\nK:C\nCDEF GABc|";
function createArrangement(playback: "repeat" | "once") {
  return createAcceptedMusicArrangement({
    ...scope,
    topic: "Quiet rain",
    sourceBrief: { direction: "A restrained rain-inspired instrumental with warm piano.", symbolicScore: score },
    arrangement: { role: "meditation_bed", requestedDurationSec: 60, form: "continuous", ending: "seamless_wrap",
    playback, direction: "Warm piano with soft rain-like percussion", sections: ["opening", "settle", "return", "ending"].map((id, index) => ({
      id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.2,
      instruction: "Keep the sound calm and connected",
    })) },
  });
}

async function fixture(playback: "repeat" | "once" = "repeat") {
  objects.clear();
  const arrangement = createArrangement(playback);
  const directory = await mkdtemp(join(tmpdir(), "studio-yue2-candidate-test-"));
  try {
    const wavPath = join(directory, "audio.wav");
    await execFileP(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-nostdin", "-y", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=10", "-ac", "2", "-c:a", "pcm_f32le", wavPath],
    { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const audio = new Uint8Array(await readFile(wavPath));
    const audioSha256 = hash(audio);
    const root = `owner/${scope.ownerId}/runs/${scope.runId}/music/yue2-evaluation/`;
    const executionJobId = "a".repeat(32);
    const studioJobId = `yue2-eval-${"b".repeat(64)}`;
    const profileRevisionSha256 = "c".repeat(64);
    const request = RenderEngineYuE2RequestSchema.parse({
      version: 2, idempotencyKey: studioJobId, sourceId: `${scope.channelId}:${scope.runId}:music`,
      profileRevisionSha256, lyrics: "", style: arrangement.arrangement.direction, seed: 42,
      maxAudioSeconds: 120, maxCostUsd: 0.9, abc: score, abcSha256: hash(score),
      sourceConstraints: { provider: "openrelay", gpuModel: "RTX 3090", maxCostUsd: 0.9, maxExecutionSeconds: 1200 },
      output: { contentType: "audio/wav", sampleRateHz: 48_000, channels: 2, sampleFormat: "float32" },
    });
    const requestBytes = new TextEncoder().encode(JSON.stringify(request));
    const nativeHashes: Record<string, string> = { "audio.wav": audioSha256 };
    const sidecarBytes = new Map<string, Uint8Array>();
    for (const name of files.slice(0, 5)) {
      const value = name === "score.abc" ? score : name === "request.json" ? requestBytes :
        name === "config.json" ? JSON.stringify({ profileId: "yue2" }) : new Uint8Array([1, 2, 3, 4]);
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      sidecarBytes.set(name, bytes);
      nativeHashes[name] = hash(bytes);
    }
    const result = {
      version: 1, state: "uploaded", profileId: "yue2", manifestSha256: profileRevisionSha256,
      format: "wav", sampleRate: 48_000, channels: 2, bitsPerSample: 32, frames: 480_000,
      durationSeconds: 10, sha256: audioSha256, bytes: audio.byteLength, clippedSamples: 0, nativeArtifactHashes: nativeHashes,
    };
    sidecarBytes.set("result.json", new TextEncoder().encode(JSON.stringify(result)));
    const nativeArtifacts = files.map(name => {
      const bytes = sidecarBytes.get(name)!;
      objects.set(`${root}engine-native/${name}`, bytes);
      return { name, key: `${root}engine-native/${name}`, contentType: name.endsWith(".abc") ? "text/vnd.abc" : "application/json",
        bytes: bytes.byteLength, sha256: hash(bytes) };
    });
    objects.set(`${root}audio-native-${audioSha256}.wav`, audio);
    const candidate = {
      version: "studio-yue2-render-engine-candidate/v2", ...scope,
      programFingerprint: arrangement.fingerprint, studioJobId, request, acceptedArrangement: arrangement,
      requestManifestSha256: hash(requestBytes), engineJobId: executionJobId, executionJobId,
      profileRevisionSha256, output: { bucket: "studio-output", key: `projects/${RENDER_ENGINE_STUDIO_PROJECT_NAME}/jobs/${executionJobId}/audio.wav`,
        bytes: audio.byteLength, sha256: audioSha256, contentType: "audio/wav", verifiedAt: 1 },
      audioKey: `${root}audio-native-${audioSha256}.wav`, audioSha256, audioBytes: audio.byteLength,
      nativeArtifacts, nativeFrames: 480_000,
      allocation: { costUsd: 0.2, gpuSeconds: 10, costBasis: "engine-reservation-debit", providerInvoiceVerified: false },
    };
    objects.set(`${root}candidate.json`, new TextEncoder().encode(canonicalJson(candidate)));
    return { root, candidate, audio, sidecarBytes };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("revalidates a natural-length Engine source without approving it", async () => {
  const { candidate } = await fixture();
  const { readRenderEngineYuE2Candidate } = await candidateReader;
  const material = await readRenderEngineYuE2Candidate(scope);
  assert.ok(material);
  assert.equal(material.quality.actualDurationSec, 10);
  assert.equal(material.quality.requestedDurationSec, 60);
  assert.equal(material.quality.sourceDurationPolicy, "natural_loop");
  assert.equal(material.quality.naturalLoopDurationAccepted, true);
  assert.equal(material.quality.productionApproved, false);
  assert.equal(material.candidate.audioSha256, candidate.output.sha256);
});

test("refuses substituted score and out-of-scope retained candidates", async () => {
  const { root, sidecarBytes } = await fixture();
  const { readRenderEngineYuE2Candidate } = await candidateReader;
  const scoreKey = `${root}engine-native/score.abc`;
  objects.set(scoreKey, new TextEncoder().encode(`${new TextDecoder().decode(sidecarBytes.get("score.abc"))}X`));
  await assert.rejects(readRenderEngineYuE2Candidate(scope), /sidecar changed|score differs/);
  objects.set(scoreKey, sidecarBytes.get("score.abc")!);
  await assert.rejects(readRenderEngineYuE2Candidate({ ...scope, channelId: "other-channel" }), /scope, score, output or budget binding mismatch/);
});

test("reports an absent Engine candidate without falling back or inventing one", async () => {
  objects.clear();
  const { readRenderEngineYuE2Candidate } = await candidateReader;
  assert.equal(await readRenderEngineYuE2Candidate(scope), null);
});

test("does not accept natural source duration for a one-shot arrangement", async () => {
  await fixture("once");
  const { readRenderEngineYuE2Candidate } = await candidateReader;
  const material = await readRenderEngineYuE2Candidate(scope);
  assert.ok(material);
  assert.equal(material.quality.naturalLoopDurationAccepted, false);
  assert.equal(material.quality.status, "blocked");
});

test.after(() => { loader._load = originalLoad; });
