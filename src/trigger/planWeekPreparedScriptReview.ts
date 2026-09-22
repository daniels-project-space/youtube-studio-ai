import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { createModelUsageScope, priceModelUsage } from "@/lib/modelUsage";
import { openRouterModel } from "@/lib/openRouter";
import { getObjectBytes } from "@/lib/storage";
import { claimPreparedGeneration } from "@/lib/preparedGenerationClaim";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { decodePreparedMetadata, PREPARED_METADATA_READ, preparedObjectAbsent } from "@/lib/preparedMediaStorage";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
import { assertPlanWeekPreparedScriptBinding, planWeekPreparedScriptKey, planWeekPreparationManifestSha256,
  type PlanWeekPreparationManifest, type PlanWeekPreparedScript } from "@/lib/planWeekPreparation";
import { createQaScriptBlock } from "./blocks/narratedBlocks";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const receiptSchema = z.object({
  version: z.literal("plan-week-script-review/v1"), manifestSha256: digest, scriptSha256: digest,
  status: z.enum(["approved", "held"]), error: z.string().max(1000).nullable(),
  model: z.string().min(1), costUsd: z.number().finite().nonnegative(),
  unpricedCalls: z.number().int().nonnegative(), calls: z.number().int().nonnegative(),
  fingerprint: digest,
}).strict();

/** An independent review of retained text, never permission to regenerate it. */
export async function prepareWeeklyScriptReview(
  manifest: PlanWeekPreparationManifest, rawScript: PlanWeekPreparedScript, maxCostUsd: number,
): Promise<{ costUsd: number; chargedCostUsd: number; reused: boolean; fingerprint: string; receiptKey: string }> {
  assertWeeklyPreparationVersionsSupported(manifest.execution.pipeline, "weekly script review");
  const script = assertPlanWeekPreparedScriptBinding({ prepared: rawScript, manifest });
  const entries = manifest.execution.pipeline as Array<{ block?: string; params?: Record<string, unknown> }>;
  const reviews = entries.filter(entry => entry.block === "qa_script");
  if (reviews.length !== 1 || entries.findIndex(entry => entry.block === "qa_script") >=
      entries.findIndex(entry => entry.block === "narration_tts")) {
    throw new Error("weekly script review requires one frozen qa_script before narration_tts");
  }
  const identity = { version: "plan-week-script-review/v1" as const,
    manifestSha256: planWeekPreparationManifestSha256(manifest), scriptSha256: script.scriptSha256 };
  const receiptKey = `${planWeekPreparedScriptKey(manifest)}.review.json`;
  let prior: unknown;
  try { prior = decodePreparedMetadata(await getObjectBytes(receiptKey, undefined, PREPARED_METADATA_READ)); }
  catch (error) { if (!preparedObjectAbsent(error)) throw error; }
  if (prior !== undefined) {
    const receipt = receiptSchema.parse(prior);
    const { fingerprint, ...body } = receipt;
    if (fingerprint !== sha256Hex(canonicalJson(body)) || receipt.manifestSha256 !== identity.manifestSha256 ||
        receipt.scriptSha256 !== identity.scriptSha256) throw new Error("weekly script review receipt binding mismatch");
    if (receipt.status !== "approved" || receipt.error !== null || receipt.unpricedCalls !== 0 || receipt.calls !== 1) {
      throw new Error(`weekly script review held: ${receipt.error ?? "unqualified verdict"}`);
    }
    if (!Number.isFinite(maxCostUsd) || receipt.costUsd > maxCostUsd) throw new Error("weekly script review charge exceeds remaining allowance");
    return { costUsd: 0, chargedCostUsd: receipt.costUsd, reused: true, fingerprint, receiptKey };
  }
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("weekly script review has no remaining budget");
  await bootstrapSecrets(() => undefined, { services: ["openrouter"], required: ["OPENROUTER_API_KEY"] });
  const model = openRouterModel("intelligence");
  let claimed = false;
  const block = createQaScriptBlock(undefined, async request => {
    // One token per UTF-8 byte plus framing is a reservation, not observed usage.
    const priced = priceModelUsage({ provider: "openrouter", model, kind: "text",
      inputTokens: Buffer.byteLength(request.prompt, "utf8") + 1024, outputTokens: request.maxTokens });
    if (priced.unpricedReason || priced.costUsd === undefined || !Number.isFinite(priced.costUsd) ||
        priced.costUsd > maxCostUsd) throw new Error("weekly script review exceeds its remaining priced allowance");
    await claimPreparedGeneration("scriptReview", manifest, { ...identity, model, request });
    claimed = true;
  });
  const usage = createModelUsageScope();
  let failure: unknown;
  try {
    await usage.run(async () => {
      const patch = await block.run({ ownerId: manifest.ownerId, channelId: manifest.channelId,
        runId: `weekly:${manifest.batchId}:${manifest.itemId}`, keyPrefix: `owner/${manifest.ownerId}/`,
        budgetUsd: maxCostUsd, params: { ...reviews[0].params, ...manifest.execution.moduleConfig.qa_script },
        store: { ...manifest.execution.seedStore, topic: manifest.plan.topic,
          script: script.script, narrationText: script.script.narrationText }, log: () => {} });
      if (patch.scriptApproved !== true) throw new Error("weekly script critic returned no approval");
    });
  } catch (error) { failure = error; }
  // A failed concurrent claim must not write a verdict for the owning attempt.
  if (!claimed) throw failure ?? new Error("weekly script critic did not obtain exclusive dispatch authority");
  const observed = usage.snapshot();
  if (!failure && (observed.calls !== 1 || observed.unpricedCalls !== 0 || observed.costUsd > maxCostUsd)) {
    failure = new Error("weekly script review usage is unpriced, incomplete, or exceeds its allowance");
  }
  const body = { ...identity, status: failure ? "held" as const : "approved" as const,
    error: failure ? String(failure instanceof Error ? failure.message : failure).slice(0, 1000) : null,
    model, costUsd: observed.costUsd, unpricedCalls: observed.unpricedCalls, calls: observed.calls };
  const receipt = receiptSchema.parse({ ...body, fingerprint: sha256Hex(canonicalJson(body)) });
  await persistPreparedResult(receiptKey, Buffer.from(canonicalJson(receipt)), "application/json", { "plan-week-script-review": "v1" });
  if (failure) throw failure;
  return { costUsd: observed.costUsd, chargedCostUsd: observed.costUsd, reused: false, fingerprint: receipt.fingerprint, receiptKey };
}
