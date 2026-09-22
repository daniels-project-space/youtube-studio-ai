import { z } from "zod";
import { dirname, join } from "node:path";
import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { prepareApprovedYuE2AssemblySource } from "@/lib/approvedYuE2AssemblySource";
import { normalizeMusicLoopSource } from "@/lib/ffmpeg";
import { createLoopAssemblyBlock } from "./lofiBlocks";
import { createTimelineAssemblyBlock } from "./narratedBlocks";
import { createComposerAwareAssemblyManifest } from "./composerAwareAssembly";

export const YUE2_REVIEWED_ASSEMBLY_VERSION = "3.0.0-yue2-reviewed-loop";
export const YUE2_ONCE_ASSEMBLY_VERSION = "3.1.0-yue2-reviewed-once";
const config = z.object({
  sourceCrossfadeSec: z.number().finite().min(0.5).max(4).default(2),
  useAssemblyEdl: z.literal(false).optional(),
}).passthrough();

/** Both renderers consume private audio locally; no fake music URL or public-key handoff. */
export function createYuE2AssemblyManifest(legacy: ModuleManifest, playback: "repeat" | "once" = "repeat"): ModuleManifest {
  if (!["assemble", "timeline_assemble"].includes(legacy.id)) throw new Error("Unsupported YuE2 assembly consumer");
  if (playback === "once" && legacy.id !== "timeline_assemble") throw new Error("Play-once YuE2 requires a narrated timeline consumer");
  const version = playback === "once" ? YUE2_ONCE_ASSEMBLY_VERSION : YUE2_REVIEWED_ASSEMBLY_VERSION;
  const routeConfig = playback === "once" ? z.object({ sourceCrossfadeSec: z.literal(0).default(0),
    useAssemblyEdl: z.literal(false).optional() }).passthrough() : config;
  const { musicUrl: _musicUrl, ...consumes } = legacy.consumes;
  const { musicKey: _musicKey, ...optionalConsumes } = legacy.optionalConsumes;
  void _musicUrl; void _musicKey;
  const block = {
    ...legacy.block,
    consumes: [...Object.keys(consumes), "yue2MusicCandidate", "acceptedMusicArrangement"],
    produces: [...legacy.block.produces, "yue2AssemblySource"],
    run: async (ctx: Parameters<ModuleManifest["execute"]>[0]) => {
      const params = routeConfig.parse(ctx.params);
      if (legacy.id === "timeline_assemble" && (ctx.store["healHints"] !== undefined || ctx.store["healClasses"] !== undefined)) {
        throw new Error("YuE2 assembly requires a fresh full composition; prior mixed-audio heal reuse is not qualified");
      }
      const source = await prepareApprovedYuE2AssemblySource(ctx, params.sourceCrossfadeSec, playback);
      try {
      let musicPath = source.path;
      if (legacy.id === "assemble") {
        try {
          musicPath = await normalizeMusicLoopSource(source.path, join(dirname(source.path), "assembly-mix.wav"),
            Number(ctx.params.targetLufs), source.evidence.preparedFrames);
        } catch (cause) {
          throw Object.assign(new Error("required loop audio normalization failed", { cause }),
            { code: "FINAL_AUDIO_NORMALIZATION_FAILED", retryable: false });
        }
        await source.assertCurrent();
      }
      const delegate = legacy.id === "assemble"
        ? createLoopAssemblyBlock(async () => musicPath, { mixSampleRateHz: 48000,
          assertOutputAuthority: source.assertCurrent, exactFinalDuration: true })
        : createTimelineAssemblyBlock(async () => source.path, 48000, source.assertCurrent,
          { retainRepairCheckpoint: false, musicPlayback: playback, requireAudioNormalization: true,
            ...(playback === "once" ? { musicSourceDurationSec: source.evidence.nativeFrames / 48000 } : {}) });
      const result = await delegate.run(ctx);
      // Storage writes are not atomic with the owner decision. Recheck before
      // returning artifacts so a mid-upload revocation cannot advance the run.
      await source.assertCurrent();
      return { ...result, yue2AssemblySource: source.evidence };
      } finally { await source.cleanup(); }
    },
  };
  let manifest: ModuleManifest = {
    ...legacy, version,
    consumes: { ...consumes, yue2MusicCandidate: artifactContract("yue2MusicCandidate"), acceptedMusicArrangement: artifactContract("acceptedMusicArrangement") },
    optionalConsumes,
    requiredCapabilities: [...new Set([...legacy.requiredCapabilities, "audio.music_candidate", "music.arrangement.accepted"])],
    produces: { ...legacy.produces, yue2AssemblySource: artifactContract("yue2AssemblySource") },
    configSchema: legacy.configSchema.and(routeConfig), block, execute: block.run,
    certification: { status: "contract", evidence: `Explicit private owner-reviewed YuE2 ${playback} source consumption; not final-media or publishing qualification.` },
  };
  manifest = createComposerAwareAssemblyManifest(manifest);
  return { ...manifest, version };
}
