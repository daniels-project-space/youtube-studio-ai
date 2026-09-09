import { createHash, randomUUID } from "node:crypto";
import type { StageContext } from "@/engine/types";
import { ExecutionError } from "@/engine/executionErrors";
import { verifiedInlineCheckpoint, verifiedInlineCostEvidence, type InlineCheckpointContext } from "@/engine/inlineCheckpointAdmission";
import { getObjectBytes, putObject } from "@/lib/storage";
import { openRouterModel } from "@/lib/openRouter";
import { claudeJson } from "@/lib/anthropic";
import { checkpointCostReceiptId, observeCheckpointCostReceipt, type CheckpointCostReceipt } from "@/lib/checkpointCostAccounting";
import {
  assertTitleDecision, craftPinnedComment, hasMetacraft, isTitleResponseRetryable, packageSelectedTitle,
  selectTitle, titleInputFingerprint, youtubeSuggest, fetchCompetitorTitles,
  type CraftedMetadata, type MetaCraftArgs, type TitleDecision, type TitleRuntime,
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
type CheckpointIdentity = Pick<StageContext, "ownerId" | "channelId" | "runId" | "keyPrefix">;
const SLOTS = ["selection", "package-1", "package-2", "comment"] as const;
type OperationSlot = typeof SLOTS[number];
interface Claim { binding: Binding; id: string }
const verifiedCheckpoint = Symbol("verified-metadata-checkpoint");
const verifiedCosts = Symbol("verified-metadata-costs-only");
interface VerifiedMetadataCostEvidence {
  readonly [verifiedCosts]: true;
  readonly binding: Binding;
  readonly ledgerFingerprint: string;
  readonly receipts: readonly CheckpointCostReceipt[];
}
interface VerifiedMetadataCheckpoint {
  readonly [verifiedCheckpoint]: true;
  readonly binding: Binding;
  readonly frozenInputHash: string;
  readonly records: readonly { slot: OperationSlot; claimId: string; outcomeHash: string }[];
  readonly receipts: readonly CheckpointCostReceipt[];
  readonly costUsd: number;
}
export type MetadataCheckpointInspection =
  | { kind: "fresh"; binding: Binding }
  | { kind: "restorable"; proof: VerifiedMetadataCheckpoint }
  | { kind: "continuable"; proof: VerifiedMetadataCheckpoint; remainingSlots: readonly OperationSlot[] }
  | { kind: "held"; code: "METADATA_TITLE_RECONCILIATION_REQUIRED"; reason: string; costEvidence?: VerifiedMetadataCostEvidence };

const defaultIo: CheckpointIo = { get: getObjectBytes, put: putObject };
function held(message: string): ExecutionError {
  return new ExecutionError("METADATA_TITLE_RECONCILIATION_REQUIRED: " + message, {
    code: "METADATA_TITLE_RECONCILIATION_REQUIRED", retryable: false,
  });
}
function isMissing(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  // NoSuchBucket and generic 404s are configuration failures, not absence.
  return (e?.name === "NoSuchKey" || e?.name === "NotFound") &&
    (e.$metadata?.httpStatusCode === undefined || e.$metadata.httpStatusCode === 404);
}
function isPrecondition(error: unknown): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function bindingFor(ctx: CheckpointIdentity, args: MetaCraftArgs): Binding {
  return {
    version: "metadata-title-checkpoint/v1", ownerId: ctx.ownerId, channelId: ctx.channelId,
    runId: ctx.runId, keyPrefix: ctx.keyPrefix, inputHash: titleInputFingerprint(args),
    model: openRouterModel("intelligence"),
  };
}
function prefixFor(ctx: CheckpointIdentity): string {
  return ctx.keyPrefix.replace(/\/?$/, "/") + "runs/" + ctx.runId + "/metadata-title/v1/";
}
async function readCheckpoint<T>(get: CheckpointIo["get"], key: string): Promise<T | null> {
  let bytes: Uint8Array;
  try { bytes = await get(key); }
  catch (error) { if (isMissing(error)) return null; throw error; }
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    // JSON null is a malformed record, never evidence of object absence.
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not a record");
    return value as T;
  } catch { throw held("unreadable checkpoint " + key); }
}
function assertManifest(manifest: Manifest, binding: Binding, args: MetaCraftArgs): void {
  if (!same(manifest.binding, binding) || !manifest.args || typeof manifest.args.topic !== "string") {
    throw held("run, source, channel, schema or model binding changed");
  }
  // Performance is fetched once at creation; every other argument must match.
  if (titleInputFingerprint({ ...manifest.args, perfContext: args.perfContext }) !==
    titleInputFingerprint({ ...args, perfContext: args.perfContext })) throw held("manifest input payload changed");
  if (manifest.args.perfContext !== undefined && typeof manifest.args.perfContext !== "string") {
    throw held("invalid frozen performance context");
  }
}
function assertOutcome<T>(binding: Binding, key: string, claim: Claim | null, outcome: Outcome<T>): void {
  if (!claim || !same(claim.binding, binding) || typeof claim.id !== "string" || !claim.id.trim() ||
    !same(outcome.binding, binding) || claim.id !== outcome.claimId ||
    outcome.cost?.id !== checkpointCostReceiptId(key, claim.id) ||
    !["ok", "held", "rejected"].includes(outcome.status)) throw held("outcome has no matching paid claim");
  if (!Number.isFinite(outcome.cost.costUsd) || outcome.cost.costUsd < 0 ||
    !Number.isSafeInteger(outcome.unpricedCalls) || outcome.unpricedCalls < 0) throw held("invalid cost outcome");
}
function assertSavedPackage(args: MetaCraftArgs, decision: TitleDecision, metadata?: CraftedMetadata): asserts metadata is CraftedMetadata {
  if (!metadata || metadata.title !== decision.title || metadata.titleAlternate !== decision.titleAlternate ||
    typeof metadata.description !== "string" || !metadata.description.trim() || !Array.isArray(metadata.tags) ||
    metadata.tags.length < 5 || metadata.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
    throw held("both package attempts failed or saved package is invalid");
  }
  assertTitleDecision(args, metadata.titleDecision);
  if (metadata.titleDecision.decisionFingerprint !== decision.decisionFingerprint ||
    metadata.frame !== decision.frame || metadata.clickScore !== decision.clickScore || metadata.judged !== true ||
    !same(metadata.suggests, decision.suggests) || !same(metadata.feed, decision.feed)) {
    throw held("saved package does not match the admitted title decision");
  }
}

type CheckpointRecords = Map<string, unknown | null>;
async function readLedgerSnapshot(ctx: CheckpointIdentity, get: CheckpointIo["get"]) {
  const prefix = prefixFor(ctx);
  const keys = [prefix + "manifest.json", ...SLOTS.flatMap((slot) => [prefix + slot + ".claim.json", prefix + slot + ".outcome.json"])];
  // Fixed keys only, including when the manifest is missing. No bucket listing.
  const responses = await Promise.all(keys.map(async (key) => {
    try { return { key, value: await readCheckpoint(get, key) }; }
    catch (error) { return { key, error }; }
  }));
  const records: CheckpointRecords = new Map(), readFailures: unknown[] = [];
  for (const response of responses) {
    // Failed reads are not absent records. Retain successful reads for cost-only
    // evidence; the entire operation graph remains unadmittable on ANY failure.
    if ("error" in response) readFailures.push(response.error);
    else records.set(response.key, response.value);
  }
  return { records, readFailures };
}
async function readLedger(ctx: CheckpointIdentity, get: CheckpointIo["get"]): Promise<CheckpointRecords> {
  const snapshot = await readLedgerSnapshot(ctx, get);
  if (snapshot.readFailures.length) throw snapshot.readFailures[0];
  return snapshot.records;
}

function inspectLedger(
  ctx: CheckpointIdentity, args: MetaCraftArgs, records: CheckpointRecords,
  observeReceipt: (receipt: CheckpointCostReceipt) => void = () => {},
): MetadataCheckpointInspection {
  const binding = bindingFor(ctx, args), prefix = prefixFor(ctx);
  const manifest = records.get(prefix + "manifest.json") as Manifest | null;
  if (!manifest) {
    if ([...records.values()].some((record) => record !== null)) throw held("operation records exist without a manifest");
    return { kind: "fresh", binding };
  }
  assertManifest(manifest, binding, args);
  const outcomes = new Map<OperationSlot, Outcome<unknown>>();
  const evidence: { slot: OperationSlot; claimId: string; outcomeHash: string }[] = [];
  const receipts: CheckpointCostReceipt[] = [];
  const claimIds = new Set<string>();
  for (const slot of SLOTS) {
    const key = prefix + slot;
    const claim = records.get(key + ".claim.json") as Claim | null;
    const outcome = records.get(key + ".outcome.json") as Outcome<unknown> | null;
    if (outcome) {
      assertOutcome(binding, key, claim, outcome);
      if (claimIds.has(outcome.claimId)) throw held("paid claim identity reused across operations");
      claimIds.add(outcome.claimId);
      observeReceipt(outcome.cost);
      receipts.push(outcome.cost);
      if (outcome.unpricedCalls) throw held("checkpoint contains unpriced provider usage; reconcile before more spend");
      if (outcome.status === "held") throw held(outcome.error ?? slot + " outcome unknown");
      outcomes.set(slot, outcome);
      evidence.push({ slot, claimId: outcome.claimId, outcomeHash: createHash("sha256").update(JSON.stringify(outcome)).digest("hex") });
    } else if (claim) throw held(slot + " has an in-flight/unknown paid outcome; no automatic replay");
  }
  const selected = outcomes.get("selection") as Outcome<TitleDecision> | undefined;
  const p1 = outcomes.get("package-1") as Outcome<CraftedMetadata> | undefined;
  const p2 = outcomes.get("package-2") as Outcome<CraftedMetadata> | undefined;
  const comment = outcomes.get("comment");
  if (!selected && (p1 || p2 || comment)) throw held("package/comment precedes selection");
  if (selected && selected.status !== "ok") throw held(selected.error ?? "title selection rejected");
  if (selected) assertTitleDecision(manifest.args, selected.value!);
  if (p2 && (!p1 || p1.status !== "rejected")) throw held("second package requires a rejected first package");
  if (p1?.status === "ok") assertSavedPackage(manifest.args, selected!.value!, p1.value);
  if (p2?.status === "ok") assertSavedPackage(manifest.args, selected!.value!, p2.value);
  if (p2?.status === "rejected") throw held("both package attempts failed");
  const packaged = p1?.status === "ok" || p2?.status === "ok";
  if (comment && !packaged) throw held("comment precedes a valid package");
  if (comment?.status === "ok" && (typeof comment.value !== "string" || !comment.value.trim())) {
    throw held("saved optional comment is invalid");
  }
  const costUsd = receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0);
  if (!Number.isFinite(costUsd)) throw held("invalid cumulative checkpoint cost");
  const proof: VerifiedMetadataCheckpoint = {
    [verifiedCheckpoint]: true, binding, frozenInputHash: titleInputFingerprint(manifest.args),
    records: evidence, receipts, costUsd,
  };
  if (comment) return { kind: "restorable", proof };
  return { kind: "continuable", proof, remainingSlots: !selected ? SLOTS : packaged ? ["comment"] :
    p1?.status === "rejected" ? ["package-2", "comment"] : ["package-1", "package-2", "comment"] };
}

/** Charge validation does not require a successful creative result or a legal
 * continuation graph. Scan ALL readable slots, not only the prefix before the
 * first hold. Duplicate claim identities are ambiguous: count neither copy. */
function inspectKnownCosts(ctx: CheckpointIdentity, args: MetaCraftArgs, records: CheckpointRecords): VerifiedMetadataCostEvidence | undefined {
  const binding = bindingFor(ctx, args), prefix = prefixFor(ctx);
  const manifest = records.get(prefix + "manifest.json") as Manifest | null;
  if (!manifest) return;
  try { assertManifest(manifest, binding, args); } catch { return; }
  const claimCounts = new Map<string, number>();
  for (const slot of SLOTS) {
    const claim = records.get(prefix + slot + ".claim.json") as Claim | null;
    if (claim && same(claim.binding, binding) && typeof claim.id === "string" && claim.id.trim()) {
      claimCounts.set(claim.id, (claimCounts.get(claim.id) ?? 0) + 1);
    }
  }
  const receipts: CheckpointCostReceipt[] = [];
  for (const slot of SLOTS) {
    const key = prefix + slot;
    const claim = records.get(key + ".claim.json") as Claim | null;
    const outcome = records.get(key + ".outcome.json") as Outcome<unknown> | null;
    if (!outcome || !claim || claimCounts.get(claim.id) !== 1) continue;
    try { assertOutcome(binding, key, claim, outcome); } catch { continue; }
    // A positive unpricedCalls count means this is only the KNOWN component,
    // not a claim that unknown usage was free. The encompassing hold remains.
    receipts.push(Object.freeze({ ...outcome.cost }));
  }
  if (!receipts.length || !Number.isFinite(receipts.reduce((sum, row) => sum + row.costUsd, 0))) return;
  return Object.freeze({ [verifiedCosts]: true as const, binding: Object.freeze(binding),
    ledgerFingerprint: createHash("sha256").update(JSON.stringify([...records])).digest("hex"),
    receipts: Object.freeze(receipts) });
}

/** Read-only state evidence, not spending authority or an atomic multi-object snapshot. */
export async function inspectMetadataTitleCheckpoint(
  ctx: CheckpointIdentity, args: MetaCraftArgs,
  options: { get?: CheckpointIo["get"]; priorStage?: { status: string; costUsd: number } } = {},
): Promise<MetadataCheckpointInspection> {
  let records: CheckpointRecords | undefined;
  try {
    const snapshot = await readLedgerSnapshot(ctx, options.get ?? getObjectBytes);
    records = snapshot.records;
    if (snapshot.readFailures.length) throw snapshot.readFailures[0];
    const result = inspectLedger(ctx, args, records);
    const prior = options.priorStage;
    if (prior && (!Number.isFinite(prior.costUsd) || prior.costUsd < 0)) throw held("invalid prior stage cost");
    if (result.kind === "fresh" && prior && (prior.costUsd > 0 || ["running", "failed", "ok"].includes(prior.status))) {
      throw held("prior execution history has no matching checkpoint evidence");
    }
    return result;
  } catch (error) {
    const costEvidence = records ? inspectKnownCosts(ctx, args, records) : undefined;
    return { kind: "held", code: "METADATA_TITLE_RECONCILIATION_REQUIRED", reason: error instanceof Error ? error.message : String(error),
      ...(costEvidence ? { costEvidence } : {}) };
  }
}

/** Registered metadata adapter: only the real nine-key validator can mint the
 * engine evidence. Budget, attribution and stage persistence belong to runner. */
export async function inspectMetadataPaidInlineResume(ctx: InlineCheckpointContext, args: MetaCraftArgs) {
  const inspected = await inspectMetadataTitleCheckpoint(ctx, args, { priorStage: ctx.priorStage });
  if (inspected.kind === "held") {
    const costs = inspected.costEvidence;
    if (!costs) throw held(inspected.reason);
    if (costs[verifiedCosts] !== true || !same(costs.binding, bindingFor(ctx, args))) throw held("cost evidence binding changed");
    return verifiedInlineCostEvidence(ctx.binding, { receipts: costs.receipts,
      ledgerFingerprint: costs.ledgerFingerprint, reason: inspected.reason });
  }
  if (inspected.kind === "fresh") return verifiedInlineCheckpoint(ctx.binding, {
    kind: "fresh", ledgerFingerprint: null, receipts: [],
  });
  const proof = inspected.proof;
  if (proof[verifiedCheckpoint] !== true || !same(proof.binding, bindingFor(ctx, args))) {
    throw held("metadata inspection proof binding changed");
  }
  return verifiedInlineCheckpoint(ctx.binding, {
    kind: inspected.kind, receipts: proof.receipts,
    ledgerFingerprint: createHash("sha256").update(JSON.stringify({ binding: proof.binding,
      frozenInputHash: proof.frozenInputHash, records: proof.records })).digest("hex"),
  });
}

/** Immutable create-only claims prevent a retry/process replacement buying an ambiguous operation twice. */
export async function craftCheckpointedMetadata(
  ctx: StageContext,
  args: MetaCraftArgs,
  options: { runtime?: TitleRuntime; io?: CheckpointIo; performanceContext?: () => Promise<string> } = {},
): Promise<{ metadata: CraftedMetadata; costUsd: number }> {
  const io = options.io ?? defaultIo;
  const binding = bindingFor(ctx, args);
  const prefix = prefixFor(ctx);
  const records = await readLedger(ctx, io.get);
  // Validate the complete saved operation graph before writes, research or paid work.
  // Valid known receipts remain accounted even when a later record requires a hold.
  inspectLedger(ctx, args, records, (receipt) => observeCheckpointCostReceipt(receipt, true));
  const assertNewWorkLease = async () => {
    if (!ctx.assertInlinePaidExecutionLease) {
      throw new ExecutionError("INLINE_PAID_EXECUTION_LEASE_REQUIRED: no local execution authority was supplied", {
        code: "INLINE_PAID_EXECUTION_LEASE_REQUIRED", retryable: false,
      });
    }
    await ctx.assertInlinePaidExecutionLease();
    await ctx.assertRemoteChildExecutionLease?.({ reason: "paid_wave" });
  };
  const runtime: TitleRuntime = {
    suggest: options.runtime?.suggest ?? youtubeSuggest,
    competitors: options.runtime?.competitors ?? fetchCompetitorTitles,
    json: async <T>(request: Parameters<typeof claudeJson>[0]) => {
      await assertNewWorkLease();
      const usage = snapshot();
      if (usage.unpricedCalls) throw held("unpriced usage blocks the next provider dispatch");
      return (options.runtime?.json ?? claudeJson)<T>(request);
    },
  };
  const read = async <T>(key: string): Promise<T | null> => {
    if (!records.has(key)) throw held("unexpected checkpoint key");
    return records.get(key) as T | null;
  };
  const create = async (key: string, data: unknown, completedOutcome = false): Promise<void> => {
    if (!completedOutcome) await assertNewWorkLease();
    else await ctx.assertRemoteChildExecutionLease?.({ reason: "paid_wave" });
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
      manifest = await readCheckpoint<Manifest>(io.get, manifestKey);
    }
  }
  if (!manifest) throw held("manifest creation outcome unknown");
  assertManifest(manifest, binding, args);
  const frozenArgs: MetaCraftArgs = { ...manifest.args, log: ctx.log };
  // Performance is intentionally frozen once, not reread as a competing title input on recovery.
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
      assertOutcome(binding, key, claim, existing);
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
    // A received response belongs to this already admitted immutable claim.
    // Preserve it if the local generation changed while the provider worked;
    // the next claim/request and the engine's durable writes remain fenced.
    await create(key + ".outcome.json", outcome, true);
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
  assertSavedPackage(frozenArgs, selected.value, metadata);
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
