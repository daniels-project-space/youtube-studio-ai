import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { craftCheckpointedMetadata, inspectMetadataTitleCheckpoint } from "@/lib/metadataTitleCheckpoint";
import { checkpointCostReceiptId, createCheckpointCostScope } from "@/lib/checkpointCostAccounting";
import type { StageContext } from "@/engine/types";
import type { MetaCraftArgs, TitleRuntime } from "@/lib/metacraft";
import type { putObject } from "@/lib/storage";

const objects = new Map<string, Uint8Array>();
const prefix = "fixture/runs/inspection-run/metadata-title/v1/";
const slots = ["selection", "package-1", "package-2", "comment"];
const expectedKeys = [prefix + "manifest.json", ...slots.flatMap((slot) => [prefix + slot + ".claim.json", prefix + slot + ".outcome.json"])].sort();
let reads: string[] = [], writes = 0, calls = 0, spend = 0, perfCalls = 0;
const args: MetaCraftArgs = {
  topic: "Bridge collapse", channelName: "Field Notes", persona: "Plain-language engineering history",
  scriptExcerpt: "The bridge collapse killed 47 engineers. No engineers survived.",
  competitorTitles: [], suggestions: [],
};
const title = "47 Engineers Died in the Bridge Collapse";
const runtime: TitleRuntime = {
  suggest: async () => { throw new Error("must not fetch supplied evidence"); },
  competitors: async () => { throw new Error("must not fetch supplied evidence"); },
  json: async <T>({ prompt }: { prompt: string }) => {
    calls++; spend += 0.01;
    if (prompt.startsWith("Write SEVEN")) return { candidates: [{ frame: "direct_verdict", title }] } as T;
    if (prompt.startsWith("You are")) return { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "Explicit source outcome" }] } as T;
    if (prompt.startsWith("Write the YouTube")) return { description: "A sourced account of the bridge collapse.", tagsCsv: "bridge,engineers,collapse,history,design" } as T;
    return { comment: "Which decision mattered most?" } as T;
  },
};
const ctx: StageContext = {
  ownerId: "inspection-owner", channelId: "inspection-channel", runId: "inspection-run", keyPrefix: "fixture/",
  store: {}, params: {}, budgetUsd: 1, log: () => {},
  modelUsageAccounting: () => ({ calls, costUsd: spend, cacheHits: 0, unpricedCalls: 0 }),
  assertInlinePaidExecutionLease: async () => {},
};
const io = {
  get: async (key: string) => {
    reads.push(key);
    const bytes = objects.get(key);
    if (!bytes) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    return Uint8Array.from(bytes);
  },
  put: async (...[key, bytes, options]: Parameters<typeof putObject>) => {
    writes++;
    assert.equal(options?.ifNoneMatch, "*");
    if (objects.has(key)) throw Object.assign(new Error("conflict"), { $metadata: { httpStatusCode: 412 } });
    assert.ok(typeof bytes === "string" || bytes instanceof Uint8Array, "checkpoint writes must contain serialized bytes");
    objects.set(key, typeof bytes === "string" ? Buffer.from(bytes) : Uint8Array.from(bytes));
    return key;
  },
};
const performanceContext = async () => { perfCalls++; return "Exact frozen performance bytes"; };
// Tests may mutate the private in-memory fixture only; no storage API is allowed to overwrite.
function edit(suffix: string, change: (value: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const key = prefix + suffix;
  const value = JSON.parse(Buffer.from(objects.get(key)!).toString());
  change(value); objects.set(key, Buffer.from(JSON.stringify(value)));
}
const stateHash = () => createHash("sha256").update(JSON.stringify([...objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString("base64")]))).digest("hex");
async function inspect(overrides: Partial<StageContext> = {}, input = args) {
  reads = [];
  const before = { hash: stateHash(), writes, calls, spend, perfCalls };
  const scope = createCheckpointCostScope([], 0);
  const result = await scope.run(() => inspectMetadataTitleCheckpoint({ ...ctx, ...overrides }, input, { get: io.get }));
  const scoped = { ...ctx, ...overrides };
  const scopedPrefix = scoped.keyPrefix.replace(/\/?$/, "/") + "runs/" + scoped.runId + "/metadata-title/v1/";
  assert.deepEqual(reads.slice().sort(), expectedKeys.map((key) => scopedPrefix + key.slice(prefix.length)));
  assert.equal(reads.length, 9, "bounded reads include all fixed slots");
  assert.equal(new Set(reads).size, 9);
  assert.deepEqual({ hash: stateHash(), writes, calls, spend, perfCalls }, before, "inspection must not write, research, execute or charge receipts");
  assert.deepEqual(scope.snapshot().receipts, []);
  return result;
}

async function main() {
  globalThis.fetch = async () => { throw new Error("unexpected network"); };
  assert.equal((await inspect()).kind, "fresh");
  for (const priorStage of [{ status: "running", costUsd: 0 }, { status: "failed", costUsd: 0.03 }, { status: "ok", costUsd: 0 }, { status: "pending", costUsd: NaN }]) {
    assert.equal((await inspectMetadataTitleCheckpoint(ctx, args, { get: io.get, priorStage })).kind, "held");
  }
  reads = [];
  const completed = await craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext });
  assert.equal(completed.metadata.title, title);
  assert.equal(calls, 4);
  assert.equal(perfCalls, 1);
  assert.deepEqual(reads.slice().sort(), expectedKeys, "execution reuses the same nine reads");
  const golden = new Map([...objects].map(([key, bytes]) => [key, Uint8Array.from(bytes)]));
  const restore = () => { objects.clear(); for (const [key, bytes] of golden) objects.set(key, Uint8Array.from(bytes)); };
  const full = await inspect();
  assert.equal(full.kind, "restorable");
  if (full.kind !== "restorable") throw new Error("unreachable");
  assert.equal(full.proof.costUsd, 0.04);
  assert.equal(full.proof.receipts.length, 3);
  assert.equal(full.proof.records.length, 3);
  for (const row of full.proof.records) {
    assert.equal(row.outcomeHash, createHash("sha256").update(Buffer.from(objects.get(prefix + row.slot + ".outcome.json")!).toString()).digest("hex"));
  }
  // The actual replay also performs no new provider work and does not refetch performance.
  const oldCalls = calls; reads = []; spend = 0;
  const replay = await craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext });
  assert.equal(replay.metadata.title, title);
  assert.equal(calls, oldCalls); assert.equal(perfCalls, 1);
  assert.deepEqual(reads.slice().sort(), expectedKeys);

  objects.delete(prefix + "comment.claim.json"); objects.delete(prefix + "comment.outcome.json");
  const commentRemaining = await inspect();
  assert.equal(commentRemaining.kind, "continuable");
  if (commentRemaining.kind === "continuable") assert.deepEqual(commentRemaining.remainingSlots, ["comment"]);
  edit("package-1.outcome.json", (record) => { record.status = "rejected"; delete record.value; record.error = "known invalid response"; });
  const retryRemaining = await inspect();
  assert.equal(retryRemaining.kind, "continuable");
  if (retryRemaining.kind === "continuable") assert.deepEqual(retryRemaining.remainingSlots, ["package-2", "comment"]);
  const partialCalls = calls; spend = 0;
  await craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext });
  assert.equal(calls - partialCalls, 2, "only remaining package and comment execute");
  assert.equal((await inspect()).kind, "restorable");
  const secondPackage = new Map([...objects].map(([key, bytes]) => [key, Uint8Array.from(bytes)]));
  for (const mutation of ["missing-first", "successful-first", "exhausted", "duplicate-claim"]) {
    objects.clear(); for (const [key, bytes] of secondPackage) objects.set(key, Uint8Array.from(bytes));
    if (mutation === "missing-first") { objects.delete(prefix + "package-1.claim.json"); objects.delete(prefix + "package-1.outcome.json"); }
    if (mutation === "successful-first") {
      objects.set(prefix + "package-1.claim.json", golden.get(prefix + "package-1.claim.json")!);
      objects.set(prefix + "package-1.outcome.json", golden.get(prefix + "package-1.outcome.json")!);
    }
    if (mutation === "exhausted") edit("package-2.outcome.json", (r) => { r.status = "rejected"; delete r.value; r.error = "known invalid response"; });
    if (mutation === "duplicate-claim") {
      const claim = JSON.parse(Buffer.from(objects.get(prefix + "selection.claim.json")!).toString());
      edit("package-2.claim.json", (r) => { r.id = claim.id; });
      edit("package-2.outcome.json", (r) => { r.claimId = claim.id; r.cost.id = checkpointCostReceiptId(prefix + "package-2", claim.id); });
    }
    assert.equal((await inspect()).kind, "held", mutation);
    const before: number = calls;
    await assert.rejects(() => craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext }));
    assert.equal(calls, before);
  }

  const mutations: [string, () => void][] = [
    ["orphan records", () => objects.delete(prefix + "manifest.json")],
    ["null manifest", () => objects.set(prefix + "manifest.json", Buffer.from("null"))],
    ["malformed JSON", () => objects.set(prefix + "comment.outcome.json", Buffer.from("{"))],
    ["orphan outcome", () => objects.delete(prefix + "selection.claim.json")],
    ["pending claim", () => objects.delete(prefix + "selection.outcome.json")],
    ["foreign claim", () => edit("selection.claim.json", (r) => { r.binding.ownerId = "foreign"; })],
    ["wrong receipt", () => edit("selection.outcome.json", (r) => { r.cost.id = "wrong"; })],
    ["negative charge", () => edit("selection.outcome.json", (r) => { r.cost.costUsd = -1; })],
    ["unpriced usage", () => edit("selection.outcome.json", (r) => { r.unpricedCalls = 1; })],
    ["fractional usage", () => edit("selection.outcome.json", (r) => { r.unpricedCalls = 0.5; })],
    ["unknown status", () => edit("selection.outcome.json", (r) => { r.status = "complete"; })],
    ["held comment", () => edit("comment.outcome.json", (r) => { r.status = "held"; })],
    ["rejected selection", () => edit("selection.outcome.json", (r) => { r.status = "rejected"; })],
    ["package before selection", () => { objects.delete(prefix + "selection.claim.json"); objects.delete(prefix + "selection.outcome.json"); }],
    ["comment before package", () => { objects.delete(prefix + "package-1.claim.json"); objects.delete(prefix + "package-1.outcome.json"); }],
    ["changed source payload", () => edit("manifest.json", (r) => { r.args.scriptExcerpt += "changed"; })],
    ["changed frozen performance", () => edit("manifest.json", (r) => { r.args.perfContext = "new performance"; })],
    ["changed winner", () => edit("selection.outcome.json", (r) => { r.value.title = "A Different Promised Outcome"; })],
    ["package overwrites winner", () => edit("package-1.outcome.json", (r) => { r.value.title = "A Different Promised Outcome"; })],
    ["invalid package tags", () => edit("package-1.outcome.json", (r) => { r.value.tags = [1, 2, 3, 4, 5]; })],
    ["changed package evidence", () => edit("package-1.outcome.json", (r) => { r.value.feed = [{ title: "invented", views: 1 }]; })],
    ["blank successful comment", () => edit("comment.outcome.json", (r) => { r.value = " "; })],
  ];
  for (const [label, mutate] of mutations) {
    restore(); mutate();
    const before: { calls: number; writes: number; perfCalls: number } = { calls, writes, perfCalls };
    assert.equal((await inspect()).kind, "held", label);
    await assert.rejects(() => craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext }), (error) => error instanceof Error, label);
    assert.deepEqual({ calls, writes, perfCalls }, before, label + " blocks actual execution before new work");
  }
  restore();
  assert.equal((await inspect({ runId: "different-run" })).kind, "fresh", "a different namespace cannot see the original ledger; this alone is not purchase authority");
  for (const overrides of [{ ownerId: "foreign" }, { channelId: "foreign" }]) assert.equal((await inspect(overrides)).kind, "held");
  for (const input of [{ ...args, language: "de" }, { ...args, competitorTitles: undefined }, { ...args, persona: "other" }]) {
    assert.equal((await inspect({}, input)).kind, "held");
  }
  restore(); edit("comment.outcome.json", (r) => { r.status = "rejected"; delete r.value; r.error = "known invalid optional text"; });
  assert.equal((await inspect()).kind, "restorable");
  assert.equal((await craftCheckpointedMetadata(ctx, args, { io, runtime, performanceContext })).metadata.pinnedComment, "");
  for (const name of ["ServiceUnavailable", "NoSuchBucket", "AccessDenied", "Unknown404"]) {
    const result = await inspectMetadataTitleCheckpoint(ctx, args, { get: async () => { throw Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } }); } });
    assert.equal(result.kind, "held", name);
  }
  const contradictoryMissing = await inspectMetadataTitleCheckpoint(ctx, args, { get: async () => {
    throw Object.assign(new Error("server failed"), { name: "NotFound", $metadata: { httpStatusCode: 503 } });
  } });
  assert.equal(contradictoryMissing.kind, "held", "an inconsistent status must not erase evidence of a storage outage");
  console.log("Metadata checkpoint inspection: real execution/replay, nine-key read bound, cost evidence and 26 corruption cases passed; no live calls");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
