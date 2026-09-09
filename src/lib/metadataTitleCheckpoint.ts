import { randomUUID } from "node:crypto";
import type { StageContext } from "@/engine/types";
import { ExecutionError } from "@/engine/executionErrors";
import { getObjectBytes, putObject } from "@/lib/storage";
import { openRouterModel } from "@/lib/openRouter";
import { claudeJson } from "@/lib/anthropic";
import { checkpointCostReceiptId, observeCheckpointCostReceipt, type CheckpointCostReceipt } from "@/lib/checkpointCostAccounting";
import {
  assertTitleDecision, craftPinnedComment, hasMetacraft, isTitleResponseRetryable, packageSelectedTitle,
  selectTitle, titleInputFingerprint, youtubeSuggest, fetchCompetitorTitles,
  type CraftedMetadata, type MetaCraftArgs, type TitleRuntime,
} from "@/lib/metacraft";

interface Binding {
  version: "metadata-title-checkpoint/v1";
  ownerId: string;
  channelId: string;
  runId: string;
  keyPrefix: string;
  inputHash: string;
  model: string;
}
interface Manifest { binding: Binding; args: Omit<MetaCraftArgs, "log"> }
interface Outcome<T> {
  binding: Binding;
  claimId: string;
  status: "ok" | "rejected" | "held";
  value?: T;
  error?: string;
  cost: CheckpointCostReceipt;
  unpricedCalls: number;
}
interface CheckpointIo { get: typeof getObjectBytes; put: typeof putObject }
const defaultIo: CheckpointIo = { get: getObjectBytes, put: putObject };
function held(message: string): ExecutionError {
  return new ExecutionError("METADATA_TITLE_RECONCILIATION_REQUIRED: " + message, {
    code: "METADATA_TITLE_RECONCILIATION_REQUIRED", retryable: false,
  });
}
function isMissing(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  // NoSuchBucket and generic 404s are configuration failures, not absence.
  return e?.name === "NoSuchKey" || e?.name === "NotFound";
}
function isPrecondition(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Immutable create-only claims prevent a retry/process replacement buying an ambiguous operation twice. */
export async function craftCheckpointedMetadata(
  ctx: StageContext,
  args: MetaCraftArgs,
  options: { runtime?: TitleRuntime; io?: CheckpointIo; performanceContext?: () => Promise<string> } = {},
): Promise<{ metadata: CraftedMetadata; costUsd: number }> {
  const io = options.io ?? defaultIo;
  const runtime: TitleRuntime = {
    suggest: options.runtime?.suggest ?? youtubeSuggest,
    competitors: options.runtime?.competitors ?? fetchCompetitorTitles,
    json: async <T>(request: Parameters<typeof claudeJson>[0]) => {
      await ctx.assertRemoteChildExecutionLease?.({ reason: "paid_wave" });
      const usage = snapshot();
      if (usage.unpricedCalls) throw held("unpriced usage blocks the next provider dispatch");
      return (options.runtime?.json ?? claudeJson)<T>(request);
    },
  };
  const binding: Binding = {
    version: "metadata-title-checkpoint/v1", ownerId: ctx.ownerId, channelId: ctx.channelId,
    runId: ctx.runId, keyPrefix: ctx.keyPrefix, inputHash: titleInputFingerprint(args),
    model: openRouterModel("intelligence"),
  };
  const prefix = ctx.keyPrefix.replace(/\/?$/, "/") + "runs/" + ctx.runId + "/metadata-title/v1/";
  const read = async <T>(key: string): Promise<T | null> => {
    let bytes: Uint8Array;
    try { bytes = await io.get(key); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as T; }
    catch { throw held("unreadable checkpoint " + key); }
  };
  const create = async (key: string, data: unknown): Promise<void> => {
    await ctx.assertRemoteChildExecutionLease?.({ reason: "paid_wave" });
    await io.put(key, Buffer.from(JSON.stringify(data)), { contentType: "application/json", ifNoneMatch: "*" });
  };
  const manifestKey = prefix + "manifest.json";
  let manifest = await read<Manifest>(manifestKey);
  if (!manifest) {
    const { log: _log, ...frozen } = args;
    void _log;
    const perf = options.performanceContext ? await options.performanceContext() : args.perfContext;
    const candidate: Manifest = { binding, args: { ...frozen, ...(perf ? { perfContext: perf } : {}) } };
    try { await create(manifestKey, candidate); manifest = candidate; }
    catch (error) {
      if (!isPrecondition(error)) throw error;
      manifest = await read<Manifest>(manifestKey);
    }
  }
  if (!manifest || !same(manifest.binding, binding)) throw held("run, source, channel, schema or model binding changed");
  const frozenArgs: MetaCraftArgs = { ...manifest.args, log: ctx.log };
  // Performance is intentionally frozen once, not reread as a competing title input on recovery.
  if (titleInputFingerprint({ ...manifest.args, perfContext: args.perfContext }) !==
    titleInputFingerprint({ ...args, perfContext: args.perfContext })) throw held("manifest input payload changed");
  const receipts = new Map<string, CheckpointCostReceipt>();
  let previousUsage: { costUsd: number; unpricedCalls: number } | undefined;
  const observe = (outcome: Outcome<unknown>, restored: boolean) => {
    if (!same(outcome.binding, binding) || !outcome.claimId || !outcome.cost ||
      !Number.isFinite(outcome.cost.costUsd) || outcome.cost.costUsd < 0 ||
      !Number.isSafeInteger(outcome.unpricedCalls) || outcome.unpricedCalls < 0) throw held("invalid cost outcome");
    observeCheckpointCostReceipt(outcome.cost, restored);
    receipts.set(outcome.cost.id, outcome.cost);
    if (outcome.unpricedCalls) throw held("checkpoint contains unpriced provider usage; reconcile before more spend");
  };
  const snapshot = () => {
    if (!ctx.modelUsageAccounting) throw held("provider cost accounting is unavailable");
    const value = ctx.modelUsageAccounting(["text"]);
    if (!Number.isFinite(value.costUsd) || value.costUsd < 0 || !Number.isSafeInteger(value.unpricedCalls) || value.unpricedCalls < 0) {
      throw held("invalid provider usage accounting");
    }
    if (previousUsage && (value.costUsd < previousUsage.costUsd || value.unpricedCalls < previousUsage.unpricedCalls)) {
      throw held("provider usage counters decreased");
    }
    previousUsage = { costUsd: value.costUsd, unpricedCalls: value.unpricedCalls };
    return value;
  };
  const step = async <T>(name: string, action: () => Promise<T>): Promise<Outcome<T>> => {
    const key = prefix + name;
    const claim = await read<{ binding: Binding; id: string }>(key + ".claim.json");
    const existing = await read<Outcome<T>>(key + ".outcome.json");
    if (existing) {
      if (!claim || !same(claim.binding, binding) || claim.id !== existing.claimId ||
        existing.cost?.id !== checkpointCostReceiptId(key, claim.id) ||
        !["ok", "held", "rejected"].includes(existing.status)) throw held("outcome has no matching paid claim");
      observe(existing, true);
      return existing;
    }
    if (claim) throw held(name + " has an in-flight/unknown paid outcome; no automatic replay");
    if (!options.runtime && !hasMetacraft()) throw new Error("metadata: OPENROUTER_API_KEY missing");
    const before = snapshot();
    if (before.unpricedCalls) throw held("preexisting unpriced usage blocks paid work");
    const claimId = randomUUID();
    try { await create(key + ".claim.json", { binding, id: claimId }); }
    catch (error) { if (isPrecondition(error)) throw held(name + " already claimed by another execution"); throw error; }
    let value: T | undefined;
    let failure: unknown;
    try { value = await action(); } catch (error) { failure = error; }
    const after = snapshot();
    if (after.costUsd < before.costUsd || after.unpricedCalls < before.unpricedCalls) throw held("provider usage counters decreased");
    const outcome: Outcome<T> = {
      binding, claimId, status: failure ? (isTitleResponseRetryable(failure) ? "rejected" : "held") : "ok",
      ...(failure ? { error: failure instanceof Error ? failure.message : String(failure) } : { value }),
      cost: { id: checkpointCostReceiptId(key, claimId), costUsd: after.costUsd - before.costUsd },
      unpricedCalls: after.unpricedCalls - before.unpricedCalls,
    };
    // Observe before persisting: a failed write must still account the known charge.
    observeCheckpointCostReceipt(outcome.cost, false);
    receipts.set(outcome.cost.id, outcome.cost);
    await create(key + ".outcome.json", outcome);
    observe(outcome, false);
    if (failure && outcome.status === "held") throw failure;
    return outcome;
  };
  const selected = await step("selection", () => selectTitle(frozenArgs, runtime));
  if (selected.status !== "ok" || !selected.value) throw held(selected.error ?? "title selection rejected");
  assertTitleDecision(frozenArgs, selected.value);
  let metadata: CraftedMetadata | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const packaged = await step("package-" + attempt, () => packageSelectedTitle(frozenArgs, selected.value!, runtime));
    if (packaged.status === "held") throw held(packaged.error ?? "package outcome unknown");
    if (packaged.status === "ok") { metadata = packaged.value; break; }
  }
  if (!metadata || metadata.title !== selected.value.title || metadata.titleAlternate !== selected.value.titleAlternate ||
    !metadata.description || !Array.isArray(metadata.tags) || metadata.tags.length < 5) throw held("both package attempts failed or saved package is invalid");
  assertTitleDecision(frozenArgs, metadata.titleDecision);
  if (metadata.titleDecision.decisionFingerprint !== selected.value.decisionFingerprint ||
    metadata.frame !== selected.value.frame || metadata.clickScore !== selected.value.clickScore || metadata.judged !== true) {
    throw held("saved package does not match the admitted title decision");
  }
  try {
    const comment = await step("comment", () => craftPinnedComment(frozenArgs, selected.value!, runtime));
    if (comment.status === "held") throw held(comment.error ?? "optional comment outcome unknown");
    metadata.pinnedComment = comment.status === "ok" && typeof comment.value === "string" ? comment.value : "";
  } catch (error) {
    // Only a known complete rejected response can degrade. Unknown/unpriced
    // outcomes must still stop later paid pipeline work, even for optional text.
    if (!isTitleResponseRetryable(error)) throw error;
    ctx.log("metadata: optional comment unavailable: " + String(error));
    metadata.pinnedComment = "";
  }
  return { metadata, costUsd: [...receipts.values()].reduce((sum, receipt) => sum + receipt.costUsd, 0) };
}
