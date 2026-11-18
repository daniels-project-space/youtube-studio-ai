import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Inputs that can change the meaning or authorization of an automated pipeline proposal. */
export function channelPipelineWriteFence(channel: {
  pipeline?: unknown; moduleConfig?: unknown; disabledBlocks?: unknown; identity?: unknown;
  family?: unknown; contentLane?: unknown; styleDNA?: unknown; modelRouting?: unknown;
  moduleLocks?: unknown; locked?: unknown; budget?: unknown; template?: unknown; language?: unknown;
  qaRubric?: unknown; scriptPlaybook?: unknown; thumbnailPlaybook?: unknown; thumbnailer?: unknown;
}): string {
  return sha256Hex(canonicalJson({
    pipeline: channel.pipeline ?? [], moduleConfig: channel.moduleConfig ?? {}, disabledBlocks: channel.disabledBlocks ?? [],
    identity: channel.identity ?? null, family: channel.family ?? null, contentLane: channel.contentLane ?? null,
    styleDNA: channel.styleDNA ?? null, modelRouting: channel.modelRouting ?? null,
    moduleLocks: channel.moduleLocks ?? {}, locked: channel.locked ?? false,
    budget: channel.budget ?? null, template: channel.template ?? null, language: channel.language ?? null,
    qaRubric: channel.qaRubric ?? null, scriptPlaybook: channel.scriptPlaybook ?? null,
    thumbnailPlaybook: channel.thumbnailPlaybook ?? null, thumbnailer: channel.thumbnailer ?? null,
  }));
}
