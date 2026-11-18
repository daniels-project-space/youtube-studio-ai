import assert from "node:assert/strict";
import { createReviewCandidate, listReviewCandidates } from "../../../convex/workshopDesignImports";
import { canonicalJson } from "../canonicalJson";
import { channelPipelineWriteFence } from "../channelPipelineWriteFence";
import { sha256Hex } from "../sha256";

type Handler = (ctx: unknown, args: unknown) => Promise<any>;
const call = (fn: unknown) => (fn as { _handler: Handler })._handler;
const content = { version: "workshop-design-snapshot/v2", name: "Draft", family: "narrated_stock", entries: [{ block: "script_gen", params: { seconds: 300 } }], channelDesign: { revision: 1, name: "Design", niche: "History", persona: "Curious", palette: ["#123456"] } };
const design = { ...content, fingerprint: sha256Hex(canonicalJson(content)) };
const channel: any = { _id: "channel-a", ownerId: "owner-a", family: "narrated_stock", pipeline: [{ block: "script_gen", params: { seconds: 200 } }], moduleConfig: { script_gen: { maxSeconds: 200 } }, identity: { niche: "History" }, locked: false };
const imported: any = { _id: "design-a", ownerId: "owner-a", fingerprint: design.fingerprint, design };
const rows: any[] = [];
let identity = { role: "owner", owner_id: "owner-a", subject: "owner-a" };
const ctx = { auth: { getUserIdentity: async () => identity }, db: {
  normalizeId: (_table: string, id: string) => id,
  get: async (id: string) => id === channel._id ? channel : id === imported._id ? imported : null,
  query: (table: string) => {
    assert.equal(table, "workshopReviewCandidates");
    return { withIndex: (_index: string, build: (q: any) => unknown) => {
      const filters: Record<string, unknown> = {}; const q = { eq: (key: string, value: unknown) => { filters[key] = value; return q; } }; build(q);
      const matched = () => rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      return { unique: async () => matched()[0] ?? null, order: () => ({ take: async (limit: number) => matched().slice(0, limit) }) };
    } };
  },
  insert: async (table: string, value: unknown) => { assert.equal(table, "workshopReviewCandidates"); const id = `review-${rows.length + 1}`; rows.push({ _id: id, ...structuredClone(value as object) }); return id; },
} };
async function main() {
  const before = structuredClone(channel);
  const args = { ownerId: "owner-a", channelId: "channel-a", designId: "design-a", expectedBaselineFingerprint: channelPipelineWriteFence(channel), expectedDesignFingerprint: design.fingerprint };
  await assert.rejects(call(createReviewCandidate)(ctx, { ...args, expectedBaselineFingerprint: "0".repeat(64) }), /changed/);
  await assert.rejects(call(createReviewCandidate)(ctx, { ...args, expectedDesignFingerprint: "0".repeat(64) }), /changed/);
  assert.equal(rows.length, 0);
  const first = await call(createReviewCandidate)(ctx, args);
  assert.equal(first.reused, false);
  assert.deepEqual(await call(createReviewCandidate)(ctx, args), { ...first, reused: true });
  assert.equal(rows.length, 1); assert.deepEqual(channel, before);
  assert.equal(rows[0].candidate.status, "unqualified");
  assert.equal(channelPipelineWriteFence(rows[0].candidate.baseline), args.expectedBaselineFingerprint);
  channel.pipeline[0].params.seconds = 400; imported.design = { ...design, name: "Changed" };
  assert.equal(rows[0].candidate.baseline.pipeline[0].params.seconds, 200);
  assert.deepEqual(rows[0].candidate.design, design);
  assert.equal((await call(listReviewCandidates)(ctx, { ownerId: "owner-a", channelId: "channel-a", designFingerprint: design.fingerprint })).length, 1);
  rows[0].candidate.baseline.pipeline[0].params.seconds = 999;
  await assert.rejects(call(listReviewCandidates)(ctx, { ownerId: "owner-a", channelId: "channel-a", designFingerprint: design.fingerprint }), /integrity/);
  rows[0].candidate.baseline.pipeline[0].params.seconds = 200;
  await assert.rejects(call(createReviewCandidate)(ctx, args));
  identity = { role: "owner", owner_id: "owner-b", subject: "owner-b" };
  await assert.rejects(call(listReviewCandidates)(ctx, { ownerId: "owner-b", channelId: "channel-a", designFingerprint: design.fingerprint }), /denied|not found/);
  assert.equal(rows.length, 1);
  console.log("Workshop review candidates freeze design and baseline, reject stale or foreign requests, and leave channels unchanged");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
