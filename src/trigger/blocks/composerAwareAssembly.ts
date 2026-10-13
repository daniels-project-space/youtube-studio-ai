import { z } from "zod";
import { artifactContract } from "@/engine/artifactSchemas";
import { ChannelMusicProgramSchema } from "@/engine/channelMusicProgram";
import { COMPOSER_MIX_ASSEMBLY_VERSION } from "@/engine/composerMixPipelineSelection";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { ASSEMBLE_DEFAULTS } from "@/lib/assembly/planTimeline";
import { getObjectBytes } from "@/lib/storage";

export { COMPOSER_MIX_ASSEMBLY_VERSION } from "@/engine/composerMixPipelineSelection";

const bodyGain = z.number().finite().min(0).max(2);
const masterLufs = z.number().finite().min(-23).max(-12);
const mixDirectives = z.object({
  bodyMusicVol: bodyGain.optional(),
  targetLufs: masterLufs.optional(),
}).passthrough();
const musicBriefContract = artifactContract("musicBrief");
const composerMixBrief = musicBriefContract.schema.and(z.object({
  directives: mixDirectives.optional(),
}).passthrough());

// Match Assembly's existing DUCK_PROFILES, not Composer's duckDepth mapping.
const profileGain = { none: 0.5, gentle: 0.25, standard: 0.1026, aggressive: 0.05 } as const;
const profileName = z.enum(["none", "gentle", "standard", "aggressive"]);

async function channelProgramBodyGain(ctx: Parameters<ModuleManifest["execute"]>[0]): Promise<number | undefined> {
  const key = ctx.store["channelMusicProgramKey"];
  const fingerprint = ctx.store["channelMusicProgramFingerprint"];
  if (key === undefined && fingerprint === undefined) return undefined;
  if (typeof key !== "string" || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new Error("assembly requires the complete channel music program key and fingerprint handoff");
  }
  const expectedKey = `${ctx.keyPrefix}runs/${ctx.runId}/audio/channel-music-program-${fingerprint}.json`;
  if (key !== expectedKey) throw new Error("assembly channel music program is outside the current run scope");
  const bytes = await getObjectBytes(key, undefined, { timeoutMs: 10_000, maxBytes: 128_000 });
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch {
    throw new Error("assembly channel music program is malformed");
  }
  const program = ChannelMusicProgramSchema.parse(value);
  if (program.fingerprint !== fingerprint || program.channelId !== ctx.channelId ||
      program.topic !== ctx.store["topic"]) {
    throw new Error("assembly channel music program does not match the current channel, topic, and fingerprint");
  }
  return program.mix.bodyMusicVol;
}

/** Exact opt-in executable; default discovery and the legacy block stay intact. */
export function createComposerAwareAssemblyManifest(legacy: ModuleManifest): ModuleManifest {
  if (!["timeline_assemble", "assemble"].includes(legacy.id)) throw new Error("composer mix requires an assembly consumer");
  const block = {
    ...legacy.block,
    run: async (ctx: Parameters<ModuleManifest["execute"]>[0]) => {
      // Validate even overridden directives before the delegate can encode.
      const brief = ctx.store["musicBrief"];
      const directives = brief === undefined ? undefined : composerMixBrief.parse(brief).directives;
      const params = ctx.params;
      const explicitGain = params.bodyMusicVol === undefined ? undefined : bodyGain.parse(params.bodyMusicVol);
      const explicitLufs = params.targetLufs === undefined ? undefined : masterLufs.parse(params.targetLufs);
      const selectedProfile = params.musicDuckProfile === undefined ? undefined : profileName.parse(params.musicDuckProfile);
      const programGain = await channelProgramBodyGain(ctx);
      const bodyMusicVol = explicitGain ?? (selectedProfile === undefined ? undefined : profileGain[selectedProfile]) ??
        directives?.bodyMusicVol ?? programGain ?? ASSEMBLE_DEFAULTS.bodyMusicVol;
      const targetLufs = explicitLufs ?? directives?.targetLufs ?? ASSEMBLE_DEFAULTS.targetLufs;
      return legacy.block.run({ ...ctx, params: { ...params, targetLufs,
        ...(legacy.id === "timeline_assemble" ? { bodyMusicVol } : {}) } });
    },
  };
  return {
    ...legacy,
    version: COMPOSER_MIX_ASSEMBLY_VERSION,
    optionalConsumes: {
      ...legacy.optionalConsumes,
      musicBrief: { ...musicBriefContract, schema: composerMixBrief },
      channelMusicProgramKey: artifactContract("channelMusicProgramKey"),
      channelMusicProgramFingerprint: artifactContract("channelMusicProgramFingerprint"),
    },
    certification: {
      status: "contract",
      evidence: "Opt-in composer mix handoff; mocked assembly-boundary evaluation, not Golden render qualification.",
    },
    block,
    execute: block.run,
  };
}
