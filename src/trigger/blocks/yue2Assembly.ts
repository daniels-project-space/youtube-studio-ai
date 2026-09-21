import { z } from "zod";
import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { prepareApprovedYuE2AssemblySource } from "@/lib/approvedYuE2AssemblySource";
import { createLoopAssemblyBlock } from "./lofiBlocks";
import { createTimelineAssemblyBlock } from "./narratedBlocks";
import { createComposerAwareAssemblyManifest } from "./composerAwareAssembly";

export const YUE2_REVIEWED_ASSEMBLY_VERSION = "3.0.0-yue2-reviewed-loop";
const config = z.object({
  sourceCrossfadeSec: z.number().finite().min(0.5).max(4).default(2),
  useAssemblyEdl: z.literal(false).optional(),
}).passthrough();

/** Both renderers consume private audio locally; no fake music URL or public-key handoff. */
export function createYuE2AssemblyManifest(legacy: ModuleManifest): ModuleManifest {
  if (!["assemble", "timeline_assemble"].includes(legacy.id)) throw new Error("Unsupported YuE2 assembly consumer");
  const { musicUrl: _musicUrl, ...consumes } = legacy.consumes;
  const { musicKey: _musicKey, ...optionalConsumes } = legacy.optionalConsumes;
  void _musicUrl; void _musicKey;
  const block = {
    ...legacy.block,
    consumes: [...Object.keys(consumes), "yue2MusicCandidate", "acceptedMusicArrangement"],
    produces: [...legacy.block.produces, "yue2AssemblySource"],
    run: async (ctx: Parameters<ModuleManifest["execute"]>[0]) => {
      const params = config.parse(ctx.params);
      if (legacy.id === "timeline_assemble" && (ctx.store["healHints"] !== undefined || ctx.store["healClasses"] !== undefined)) {
        throw new Error("YuE2 assembly requires a fresh full composition; prior mixed-audio heal reuse is not qualified");
      }
      const source = await prepareApprovedYuE2AssemblySource(ctx, params.sourceCrossfadeSec);
      try {
      const delegate = legacy.id === "assemble"
        ? createLoopAssemblyBlock(async () => source.path, 48000, source.assertCurrent)
        : createTimelineAssemblyBlock(async () => source.path, 48000, source.assertCurrent);
      const result = await delegate.run(ctx);
      // Storage writes are not atomic with the owner decision. Recheck before
      // returning artifacts so a mid-upload revocation cannot advance the run.
      await source.assertCurrent();
      return { ...result, yue2AssemblySource: source.evidence };
      } finally { await source.cleanup(); }
    },
  };
  let manifest: ModuleManifest = {
    ...legacy, version: YUE2_REVIEWED_ASSEMBLY_VERSION,
    consumes: { ...consumes, yue2MusicCandidate: artifactContract("yue2MusicCandidate"), acceptedMusicArrangement: artifactContract("acceptedMusicArrangement") },
    optionalConsumes,
    requiredCapabilities: [...new Set([...legacy.requiredCapabilities, "audio.music_candidate", "music.arrangement.accepted"])],
    produces: { ...legacy.produces, yue2AssemblySource: artifactContract("yue2AssemblySource") },
    configSchema: legacy.configSchema.and(config), block, execute: block.run,
    certification: { status: "contract", evidence: "Explicit private owner-reviewed YuE2 loop-source consumption; not final-media or publishing qualification." },
  };
  if (legacy.id === "timeline_assemble") manifest = createComposerAwareAssemblyManifest(manifest);
  return { ...manifest, version: YUE2_REVIEWED_ASSEMBLY_VERSION };
}
