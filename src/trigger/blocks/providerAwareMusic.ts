import { z } from "zod";
import { ExecutionError } from "@/engine/executionErrors";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import {
  MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION,
  MUSIC_PROVIDER_OUTPUTS_VERSION,
} from "@/engine/musicModuleVersions";

export {
  MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION,
  MUSIC_PROVIDER_OUTPUTS_VERSION,
} from "@/engine/musicModuleVersions";

const receiptKeys = ["musicRuntimeReceiptKey", "musicNativeWavKey"] as const;
const auditionKeys = ["musicAuditionSourceKey", "musicAuditionWavKey"] as const;
const nonblank = z.string().refine((value) => value.trim().length > 0, "nonblank output required");

export function isMusicReviewStatusCompatible(provider: unknown, status: unknown): boolean {
  if (provider === "minimax_music3") {
    return status === "awaiting-human-audition" || status === "passed-prepared-weekly-audition";
  }
  if (provider === "mureka" || provider === "suno") return status === "awaiting-human-audition";
  if (provider === "reuse") return status === "not-required-reused-master";
  return false;
}

const output = z.object({
  musicKey: nonblank,
  musicProvider: z.enum(["mureka", "suno", "minimax_music3"]),
  musicUrl: nonblank,
  channelMusicProgramKey: nonblank,
  channelMusicProgramFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  musicRuntimeReceiptKey: nonblank.optional(),
  musicNativeWavKey: nonblank.optional(),
  musicAuditionSourceKey: nonblank.optional(),
  musicAuditionWavKey: nonblank.optional(),
  musicQualityReviewStatus: z.enum([
    "not-required-provider-route", "awaiting-human-audition", "passed-prepared-weekly-audition",
  ]),
  [COST_PATCH_KEY]: z.number().finite().nonnegative(),
}).passthrough().superRefine((value, ctx) => {
  if (!isMusicReviewStatusCompatible(value.musicProvider, value.musicQualityReviewStatus)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "music review state is incompatible with its provider route" });
  }
  if (value.musicProvider === "minimax_music3") {
    if (receiptKeys.some((key) => value[key] === undefined) ||
        value.musicAuditionSourceKey !== undefined || value.musicAuditionWavKey !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MiniMax requires native/runtime receipts and its audition state" });
    }
  } else if (receiptKeys.some((key) => value[key] !== undefined) ||
      value.musicAuditionSourceKey === undefined || value.musicAuditionWavKey === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "provider output requires its own durable audition source and cannot claim MiniMax receipts" });
  }
});

/** Correct the selected provider's ABI without changing the legacy generator. */
export function createProviderAwareMusicManifest(
  legacy: ModuleManifest,
  options: { requireMusicProgram?: boolean } = {},
): ModuleManifest {
  if (legacy.id !== "music") throw new Error("provider-aware music requires the shared music module");
  const produces = { ...legacy.produces };
  const optionalProduces = { ...legacy.optionalProduces };
  const consumes = { ...legacy.consumes };
  const optionalConsumes = { ...legacy.optionalConsumes };
  const requiredCapabilities = [...legacy.requiredCapabilities];
  for (const key of [...receiptKeys, ...auditionKeys]) {
    if (!produces[key]) throw new Error(`shared music has no declared ${key} contract`);
    optionalProduces[key] = produces[key];
    delete produces[key];
  }
  if (options.requireMusicProgram) {
    const programPlan = consumes.musicProgramPlan ?? optionalConsumes.musicProgramPlan;
    if (!programPlan) throw new Error("provider-aware music requires a declared musicProgramPlan input");
    consumes.musicProgramPlan = programPlan;
    delete optionalConsumes.musicProgramPlan;
    if (!requiredCapabilities.includes("music.program.sealed")) {
      requiredCapabilities.push("music.program.sealed");
    }
  }
  const run = async (ctx: StageContext) => {
    // The raw legacy shortcut erases provider/review identity. Verified weekly
    // preparation is separate and remains validated by the original generator.
    if (ctx.store["reuseMusicKey"] !== undefined) {
      throw new Error("provider-aware music refuses raw reuseMusicKey without verified provider/review provenance");
    }
    const patch = await legacy.block.run(ctx);
    try {
      output.parse(patch);
    } catch {
      const charge = patch?.[COST_PATCH_KEY];
      throw Object.assign(new ExecutionError(
        "PAID_STAGE_RECONCILIATION_REQUIRED: shared music returned invalid provider output evidence or charge",
        { code: "PAID_STAGE_RECONCILIATION_REQUIRED", retryable: false },
      ), typeof charge === "number" && Number.isFinite(charge) && charge >= 0
        ? { additionalObservedCostUsd: charge } : {});
    }
    // Absent receipts stay absent, rather than becoming empty success evidence.
    return Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
      ![...receiptKeys, ...auditionKeys].some((optionalKey) => optionalKey === key) || value !== undefined));
  };
  const block = {
    ...legacy.block,
    ...(options.requireMusicProgram && !legacy.block.consumes.includes("musicProgramPlan")
      ? { consumes: [...legacy.block.consumes, "musicProgramPlan"] }
      : {}),
    run,
  };
  return {
    ...legacy,
    version: options.requireMusicProgram
      ? MUSIC_PROGRAM_BOUND_PROVIDER_OUTPUTS_VERSION
      : MUSIC_PROVIDER_OUTPUTS_VERSION,
    requiredCapabilities,
    consumes,
    optionalConsumes,
    produces,
    optionalProduces,
    certification: {
      status: "contract",
      evidence: "Opt-in provider-specific output admission; generation and existing review requirements are unchanged.",
    },
    block, execute: run,
  };
}
