import { z } from "zod";
import { ExecutionError } from "@/engine/executionErrors";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";

export const MUSIC_PROVIDER_OUTPUTS_VERSION = "2.0.0-provider-outputs";
const receiptKeys = ["musicRuntimeReceiptKey", "musicNativeWavKey"] as const;
const nonblank = z.string().refine((value) => value.trim().length > 0, "nonblank output required");
const output = z.object({
  musicKey: nonblank,
  musicProvider: z.enum(["mureka", "suno", "minimax_music3"]),
  musicUrl: nonblank,
  channelMusicProgramKey: nonblank,
  channelMusicProgramFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  musicRuntimeReceiptKey: nonblank.optional(),
  musicNativeWavKey: nonblank.optional(),
  musicQualityReviewStatus: z.enum([
    "not-required-provider-route", "awaiting-human-audition", "passed-prepared-weekly-audition",
  ]),
  [COST_PATCH_KEY]: z.number().finite().nonnegative(),
}).passthrough().superRefine((value, ctx) => {
  if (value.musicProvider === "minimax_music3") {
    if (receiptKeys.some((key) => value[key] === undefined) || value.musicQualityReviewStatus === "not-required-provider-route") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "MiniMax requires native/runtime receipts and its audition state" });
    }
  } else if (receiptKeys.some((key) => value[key] !== undefined) || value.musicQualityReviewStatus !== "not-required-provider-route") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "provider output cannot claim another provider's receipts or approval" });
  }
});

/** Correct the selected provider's ABI without changing the legacy generator. */
export function createProviderAwareMusicManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "music") throw new Error("provider-aware music requires the shared music module");
  const produces = { ...legacy.produces };
  const optionalProduces = { ...legacy.optionalProduces };
  for (const key of receiptKeys) {
    if (!produces[key]) throw new Error(`shared music has no declared ${key} contract`);
    optionalProduces[key] = produces[key];
    delete produces[key];
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
      !receiptKeys.some((receiptKey) => receiptKey === key) || value !== undefined));
  };
  const block = { ...legacy.block, run };
  return {
    ...legacy, version: MUSIC_PROVIDER_OUTPUTS_VERSION, produces, optionalProduces,
    certification: {
      status: "contract",
      evidence: "Opt-in provider-specific output admission; generation and existing review requirements are unchanged.",
    },
    block, execute: run,
  };
}
