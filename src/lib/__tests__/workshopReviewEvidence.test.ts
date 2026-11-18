import assert from "node:assert/strict";
import { list } from "../../../convex/workshopReviewEvidence";
import { canonicalJson } from "../canonicalJson";
import { sha256Hex } from "../sha256";
import { channelPipelineWriteFence } from "../channelPipelineWriteFence";
import { materializeWorkerPipelineParams, prepareWorkerModuleConfig } from "../../engine/workerPipelineMaterialization";

const hash = (value: unknown) => sha256Hex(canonicalJson(value));
const h = "a".repeat(64);
const entries = [{ block: "script_gen", version: "1", params: { seconds: 300 } }];
const designContent = { version: "workshop-design-snapshot/v2", name: "Draft", family: "narrated_stock", entries, channelDesign: { revision: 1, name: "Design", niche: "History", persona: "Curious", palette: ["#123456"] } };
const design = { ...designContent, fingerprint: hash(designContent) };
const baseline = { pipeline: entries, moduleConfig: {}, disabledBlocks: [], identity: null, family: "narrated_stock", contentLane: null, styleDNA: null, modelRouting: null, moduleLocks: {}, locked: false, budget: null, template: null, language: null, qaRubric: null, scriptPlaybook: null, thumbnailPlaybook: null, thumbnailer: null };
const review = { version: "workshop-review-candidate/v1", status: "unqualified", ownerId: "owner", channelId: "channel", design, baseline, baselineFingerprint: channelPipelineWriteFence(baseline) };
const receiptBody = { version: "production-route-qualification-receipt/v1", level: "route_release_qualified", ownerId: "owner", channelId: "channel", binding: { bindingFingerprint: h, family: "family", contentLaneKey: "lane", programBriefFingerprint: h, showProfileFingerprint: h, routeKey: "route", routeAdmission: "automatic", routeFingerprint: h, compositionFingerprint: h, pipelineFingerprint: hash(entries) }, preflightReceiptFingerprint: h, qualificationFingerprint: h, preflight: { plannerEvidenceFingerprint: h, plannerPlanFingerprint: h, inceptionEvidenceFingerprint: h, inceptionPlanFingerprint: h, runtimeEvidenceFingerprint: h, runtimeTargetFingerprint: h, videoReadinessFingerprint: h, visualMatterEvidenceFingerprint: h, visualMatterStatus: "not_required" }, quality: { qualityEvidenceFingerprint: h, editorialAcceptanceFingerprint: h, hardGateReady: true, calibrationComplete: true }, provenance: { provenanceEvidenceFingerprint: h, releaseCertificateFingerprint: h, finalMasterSha256: h, qualityEvidenceFingerprint: h, contentLaneKey: "lane", renderer: "renderer", evidenceStatus: "complete", routeBound: true } };
const receipt = { ...receiptBody, receiptFingerprint: hash(receiptBody) };
const benchmark = { version: "retained-pipeline-candidate/v1", ownerId: "owner", channelId: "channel", entries, sourceRunId: "run", workerDeployment: { version: "worker-1" }, qualification: { receipt } };
const reviewRows: any[] = [{ ownerId: "owner", channelId: "channel", fingerprint: hash(review), designFingerprint: design.fingerprint, baselineFingerprint: review.baselineFingerprint, candidate: review, createdAt: 1 }];
const benchmarkRows: any[] = [{ ownerId: "owner", channelId: "channel", fingerprint: hash(benchmark), candidate: benchmark, createdAt: 2 }];
let identity: any = { role: "owner", owner_id: "owner", subject: "owner" };
const ctx = { auth: { getUserIdentity: async () => identity }, db: {
  normalizeId: (_table: string, id: string) => id,
  get: async (id: string) => id === "channel" ? { ownerId: "owner" } : null,
  query: (table: string) => ({ withIndex: (_index: string, callback: (q: any) => void) => {
    const filters: Record<string, unknown> = {}; const q = { eq: (k: string, value: unknown) => { filters[k] = value; return q; } }; callback(q);
    const rows = (table === "workshopReviewCandidates" ? reviewRows : benchmarkRows).filter(row => Object.entries(filters).every(([k, value]) => row[k] === value));
    return { take: async (limit: number) => rows.slice(0, limit), order: () => ({ take: async (limit: number) => rows.slice(0, limit) }) };
  } }),
} };
const run = (designFingerprint = design.fingerprint) => (list as any)._handler(ctx, { ownerId: "owner", channelId: "channel", designFingerprint });
async function main() {
  const before = structuredClone({ reviewRows, benchmarkRows });
  const result = await run();
  assert.equal(result.comparisons.length, 1);
  assert.deepEqual(result.comparisons[0].differences, []);
  assert.equal(result.benchmarks[0].receiptFingerprint, receipt.receiptFingerprint);
  assert.deepEqual({ reviewRows, benchmarkRows }, before);
  assert.equal((await run("c".repeat(64))).reviews.length, 0);
  await assert.rejects(run("invalid"), /fingerprint/);
  identity = { role: "owner", owner_id: "other", subject: "other" };
  await assert.rejects(run(), /[Oo]wner.*(denied|verification)/);
  identity = { role: "service", owner_id: "owner", subject: "owner" };
  await assert.rejects(run(), /[Oo]wner.*(denied|verification)/);
  identity = { role: "owner", owner_id: "owner", subject: "owner" };
  benchmarkRows[0].candidate = { ...benchmark, entries: [{ ...entries[0], params: { seconds: 400 } }] };
  await assert.rejects(run(), /integrity/);
  benchmarkRows[0].candidate = benchmark;
  const changedCandidate = { ...benchmark, entries: [{ ...entries[0], params: { seconds: 400 } }] };
  benchmarkRows[0].candidate = changedCandidate;
  benchmarkRows[0].fingerprint = hash(changedCandidate);
  await assert.rejects(run(), /receipt binding/);
  benchmarkRows[0].candidate = benchmark;
  benchmarkRows[0].fingerprint = hash(benchmark);
  const production = [...entries, { block: "qa_visual", version: "1", params: {} }, { block: "upload_draft", version: "1", params: {} }];
  const privateEntries = production.slice(0, -1);
  const v2ReceiptBody = { ...receiptBody, binding: { ...receiptBody.binding, pipelineFingerprint: hash(production) } };
  const v2Receipt = { ...v2ReceiptBody, receiptFingerprint: hash(v2ReceiptBody) };
  const v2 = { ...benchmark, version: "retained-pipeline-candidate/v2", entries: production, benchmarkEntries: privateEntries, sourceCandidate: { candidateId: "candidate", fingerprint: h, baselineFingerprint: h, invocationInputFingerprint: h, executionFingerprint: h }, qualification: { receipt: v2Receipt } };
  benchmarkRows[0].candidate = v2; benchmarkRows[0].fingerprint = hash(v2);
  assert.equal((await run()).benchmarks.length, 1);
  const invalidV2 = { ...v2, benchmarkEntries: production };
  benchmarkRows[0].candidate = invalidV2; benchmarkRows[0].fingerprint = hash(invalidV2);
  await assert.rejects(run(), /derivation/);
  const privateV3 = [{ block: "editor_brief", version: "1", params: {} }, { block: "qa_visual", version: "1", params: {} }];
  const productionV3 = [...privateV3, { block: "upload_draft", version: "1", params: {} }];
  const configV3 = { editor_brief: { preset: "hype" } };
  const materialized = materializeWorkerPipelineParams(privateV3, prepareWorkerModuleConfig(privateV3, configV3).paramsByBlock, false);
  const receiptV3Body = { ...receiptBody, binding: { ...receiptBody.binding, pipelineFingerprint: hash(productionV3) } };
  const v3 = { ...v2, version: "retained-pipeline-candidate/v3", entries: productionV3, benchmarkEntries: materialized, moduleConfigOverride: configV3, qualification: { receipt: { ...receiptV3Body, receiptFingerprint: hash(receiptV3Body) } } };
  benchmarkRows[0].candidate = v3; benchmarkRows[0].fingerprint = hash(v3);
  assert.equal((await run()).benchmarks.length, 1);
  const invalidV3 = { ...v3, benchmarkEntries: privateV3 };
  benchmarkRows[0].candidate = invalidV3; benchmarkRows[0].fingerprint = hash(invalidV3);
  await assert.rejects(run(), /materialization/);
  benchmarkRows[0].candidate = benchmark; benchmarkRows[0].fingerprint = hash(benchmark);
  reviewRows[0].fingerprint = "b".repeat(64);
  await assert.rejects(run(), /integrity/);
  console.log("Owner-scoped review evidence comparison passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
