import assert from "node:assert/strict";
import Module from "node:module";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { MusicProviderAuditionSourceSchema, createMusicAuditionCheckpointV2 } from "@/engine/musicAuditionCheckpoint";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { MusicError } from "@/lib/music";

type Provider = "suno" | "mureka";
type Scenario = "success" | "unknown" | "accepted" | "partial" | "seal_failure";

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "music-failover-binding-"));
  const fixture = join(directory, "source.mp3");
  const rendered = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "aevalsrc=0.18*sin(2*PI*220*t)+0.07*sin(2*PI*440*t):s=44100:d=12", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", fixture],
  { encoding: "utf8", timeout: 30_000 });
  assert.equal(rendered.status, 0, rendered.stderr);
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load, originalFetch = globalThis.fetch;
  const oldKeys = { suno: process.env.SUNO_API_KEY, mureka: process.env.MUREKA_API_KEY };
  process.env.SUNO_API_KEY = "fixture-only"; process.env.MUREKA_API_KEY = "fixture-only";
  const objects = new Map<string, Uint8Array>();
  const attempts: Provider[] = [];
  const assets: { key: string; metadata: Record<string, unknown> }[] = [];
  let primary: Provider = "mureka", scenario: Scenario = "success";
  const generate = async (provider: Provider, request: { prompt: string }) => {
    attempts.push(provider);
    if (provider === primary) {
      if (scenario === "partial" && attempts.length === 1) {
        return { jobId: "completed-primary", tracks: [{ url: "https://fixture.invalid/primary.mp3" }] };
      }
      throw new MusicError("fixture admission rejection", {
        safeToFallback: scenario !== "unknown", acceptedUnits: scenario === "accepted" ? 1 : 0,
      });
    }
    const programs = [...objects.entries()].filter(([key]) => key.includes("channel-music-program-"));
    assert.equal(programs.length, 2, "persist the alternate's program before buying its work");
    const sealed = ChannelMusicProgramSchema.parse(JSON.parse(Buffer.from(programs[1][1]).toString()));
    assert.equal(sealed.generation.providerPreference, provider);
    assert.match(request.prompt, /felt piano/);
    return { jobId: "alternate-job", tracks: [{ url: "https://fixture.invalid/alternate.mp3" }] };
  };
  loader._load = function (id, ...args) {
    if (id === "@/lib/music") return {
      ...originalLoad.call(this, id, ...args) as object,
      generateMureka: (request: { prompt: string }) => generate("mureka", request),
      generateSuno: (request: { prompt: string }) => generate("suno", request),
    };
    if (id === "@/lib/storage") return {
      putObject: async (key: string, bytes: Uint8Array) => {
        if (scenario === "seal_failure" && key.includes("channel-music-program-") && objects.size) throw new Error("replacement program persistence failed");
        objects.set(key, bytes);
      },
      publicUrl: (key: string) => `https://fixture.invalid/${key}`,
    };
    if (id === "@/lib/files") return {
      ...originalLoad.call(this, id, ...args) as object,
      makeRunTempDir: async () => directory,
      downloadTo: async (_url: string, target: string) => { await copyFile(fixture, target); return target; },
    };
    if (id === "./blockContext") return {
      ...originalLoad.call(this, id, ...args) as object,
      recordAsset: async (_ctx: unknown, kind: string, key: string, metadata: Record<string, unknown>) => {
        if (kind === "channel_music_program") assets.push({ key, metadata });
      },
    };
    return originalLoad.call(this, id, ...args);
  };
  globalThis.fetch = async () => { throw new Error("network forbidden in music failover regression"); };
  try {
    // Only provider and R2 I/O are synthetic; mastering, loop proof, probing,
    // WAV decoding, program sealing and audition-source validation are real.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { music } = require("../musicBlocks") as typeof import("../musicBlocks");
    for (const selected of ["mureka", "suno"] as const) {
      primary = selected; scenario = "success"; objects.clear(); attempts.length = 0; assets.length = 0;
      const ctx: StageContext = { ownerId: "failover-owner", channelId: "failover-channel", runId: `failover-${primary}`,
        keyPrefix: "owner/failover-owner/", budgetUsd: 1, params: { provider: primary, trackCount: 1 }, log: () => {},
        store: { topic: "An unhurried evening", niche: "quiet essays", styleDNA: { audio: {
          role: "narration_bed", genre: "intimate chamber score", instrumentation: ["felt piano", "bowed bass"],
          textures: ["natural room tone"], moodArc: "A restrained question resolves into warmer harmony.",
          bpmRange: [58, 66], loudnessLufs: -18, bodyMusicVol: 0.25, loopable: true,
        } } } };
      const patch = await music.run(ctx);
      const alternate = primary === "mureka" ? "suno" : "mureka";
      assert.deepEqual(attempts, [primary, alternate]);
      assert.equal(patch.musicProvider, alternate);
      assert.equal(patch[COST_PATCH_KEY], PRICE.musicTrackUsd, "charge only the accepted alternate generation");
      assert.equal(patch.musicQualityReviewStatus, "awaiting-human-audition", "failover never manufactures aesthetic approval");
      const parse = (key: unknown) => JSON.parse(Buffer.from(objects.get(String(key))!).toString());
      const current = ChannelMusicProgramSchema.parse(parse(patch.channelMusicProgramKey));
      const original = ChannelMusicProgramSchema.parse(parse(assets[0].key));
      const { fingerprint: oldFingerprint, generation: oldGeneration, ...oldDirection } = original;
      const { fingerprint: newFingerprint, generation: newGeneration, ...newDirection } = current;
      assert.notEqual(newFingerprint, oldFingerprint);
      assert.deepEqual(newDirection, oldDirection, "channel role, sound, mix and quality remain unchanged");
      assert.deepEqual({ ...newGeneration, providerPreference: primary }, oldGeneration);
      assert.equal(assets[1].metadata.replacesProgramFingerprint, oldFingerprint);
      assert.equal(patch.channelMusicProgramFingerprint, newFingerprint);
      const source = MusicProviderAuditionSourceSchema.parse(parse(patch.musicAuditionSourceKey));
      const checkpoint = createMusicAuditionCheckpointV2({ ownerId: ctx.ownerId, channelId: String(ctx.channelId), runId: ctx.runId,
        invocationSha256: "b".repeat(64), program: current, source, expectedMusicKey: String(patch.musicKey),
        channelMusicProgramKey: String(patch.channelMusicProgramKey), musicProviderAuditionSourceKey: String(patch.musicAuditionSourceKey) });
      assert.equal(checkpoint.provider, alternate);
      assert.equal(checkpoint.programFingerprint, newFingerprint);
      assert.throws(() => createMusicAuditionCheckpointV2({ ownerId: ctx.ownerId, channelId: String(ctx.channelId), runId: ctx.runId,
        invocationSha256: "b".repeat(64), program: original, source, expectedMusicKey: String(patch.musicKey),
        channelMusicProgramKey: assets[0].key, musicProviderAuditionSourceKey: String(patch.musicAuditionSourceKey) }), /program/);

      for (const failureMode of ["unknown", "accepted", "partial", "seal_failure"] as const) {
        scenario = failureMode; objects.clear(); attempts.length = 0; assets.length = 0;
        let failure: unknown;
        try { await music.run({ ...ctx, params: { ...ctx.params, trackCount: failureMode === "partial" ? 2 : 1 } }); }
        catch (error) { failure = error; }
        assert.ok(failure instanceof Error);
        assert.deepEqual(attempts, failureMode === "partial" ? [primary, primary] : [primary], "never buy alternate work after accepted/uncertain work or a failed reseal");
        assert.equal((failure as Error & { retryable: boolean }).retryable, false);
        const expectedCharge = failureMode === "accepted" || failureMode === "partial" ? PRICE.musicTrackUsd : 0;
        assert.equal((failure as Error & { additionalObservedCostUsd: number }).additionalObservedCostUsd, expectedCharge);
      }
    }
    console.log("MUSIC FAILOVER BINDING PASS - both providers reach real DSP and audition checkpoints; sound preserved, uncertain/accepted work never repurchased");
  } finally {
    loader._load = originalLoad; globalThis.fetch = originalFetch;
    if (oldKeys.suno === undefined) delete process.env.SUNO_API_KEY; else process.env.SUNO_API_KEY = oldKeys.suno;
    if (oldKeys.mureka === undefined) delete process.env.MUREKA_API_KEY; else process.env.MUREKA_API_KEY = oldKeys.mureka;
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
