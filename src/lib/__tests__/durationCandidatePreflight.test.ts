import assert from "node:assert/strict";
import { canonicalJson } from "@/lib/canonicalJson";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { durationCandidatePreflight, historicalWorkerEvidence } from "@/lib/durationCandidatePreflight";
import { sha256Hex } from "@/lib/sha256";

const hash = (value: unknown) => sha256Hex(canonicalJson(value));
const pipeline = [
  ...["competitor_research", "topic_select", "critic_spec", "composer_brief", "editor_brief", "dp_brief", "director_brief", "script_gen", "qa_script", "originality_gate", "compliance_check"].map(block => ({ block })),
  { block: "narration_tts", params: { ttsProvider: "fish" } },
  ...["story_spine", "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays", "timeline_assemble", "length_check", "captions", "metadata", "package_to_opening_plan", "thumbnail_gen", "qa_visual", "upload_draft", "emit_bundle", "notify"].map(block => ({ block })),
];
const channel = { pipeline, budget: 10, family: "narrated_stock" };
const proposed = pipeline.map(entry => entry.block === "script_gen" ? { ...entry, params: { maxSeconds: 180 } } : entry);
const candidate = { fingerprint: "candidate", baselineFingerprint: channelPipelineWriteFence(channel), requestedSeconds: 180, pipeline: proposed, moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } } };
const before = structuredClone({ channel, candidate });
const result = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel, candidate, maximumCostUsd: 1, worker: null });
assert.ok(result.blockers.some(value => /above this request.s.*ceiling/.test(value)), "real narration reservation must use proposed configuration and request ceiling");
assert.ok(result.blockers.some(value => /worker release/.test(value)));
assert.ok(result.blockers.some(value => /no preflight receipt was issued/.test(value)));
assert.equal(result.binding.pipelineFingerprint, hash(proposed));
assert.equal(result.binding.moduleConfigFingerprint, hash(candidate.moduleConfig));
assert.ok(result.preparedEvidence);
assert.equal(result.preparedEvidence.evidenceFingerprint, hash(result.preparedEvidence.body));
assert.equal(result.binding.preparedEvidenceFingerprint, result.preparedEvidence.evidenceFingerprint);
assert.equal(result.preparedEvidence.body.entries.find(entry => entry.block === "narration_tts")?.params?.ttsProvider, "qwen3");
assert.ok(!result.preparedEvidence.body.entries.some(entry => entry.block === "upload_draft"));
assert.ok(result.preparedEvidence.body.removedDeliveryBlocks.includes("upload_draft"));
assert.equal(result.binding.maximumCostUsd, 1);
assert.equal(result.binding.channelBudgetUsd, 10);
assert.equal(result.bindingFingerprint, hash(result.binding));
assert.equal(result.ready, false);
assert.equal(result.dispatchAuthorized, false);
assert.deepEqual({ channel, candidate }, before);
assert.notEqual(result.bindingFingerprint, durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel, candidate, maximumCostUsd: 2, worker: null }).bindingFingerprint);
const stale = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel: { ...channel, budget: 11 }, candidate, maximumCostUsd: 1, worker: null });
assert.ok(stale.blockers.some(value => /baseline has changed/.test(value)));
assert.equal(stale.preparedEvidence, null);
const changedConfig = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel, candidate: { ...candidate, moduleConfig: {} }, maximumCostUsd: 1, worker: null });
assert.notEqual(changedConfig.binding.preparedEvidenceFingerprint, result.binding.preparedEvidenceFingerprint);
const repeatedChannel = { ...channel, pipeline: [...channel.pipeline, { block: "music", params: { trackCount: 2 } }] };
const repeated = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel: repeatedChannel, candidate: { ...candidate, baselineFingerprint: channelPipelineWriteFence(repeatedChannel), pipeline: [...proposed, { block: "music", params: { trackCount: 2 } }] }, maximumCostUsd: 1, worker: null });
assert.ok(repeated.preparedEvidence?.body.repeatedBlocks.includes("music"));
assert.ok(repeated.blockers.some(value => /shared parameter map/.test(value)));
const versionedPipeline = pipeline.map(entry => entry.block === "metadata" ? { ...entry, version: "1.0.0" } : entry);
const versionedChannel = { ...channel, pipeline: versionedPipeline };
const versioned = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel: versionedChannel, candidate: { ...candidate, baselineFingerprint: channelPipelineWriteFence(versionedChannel), pipeline: versionedPipeline }, maximumCostUsd: 1, worker: null });
assert.equal(versioned.preparedEvidence, null);
assert.ok(versioned.blockers.some(value => /explicit executable version.*runtime manifest validation/.test(value)));

const h = "a".repeat(64), entries = [{ block: "assemble", params: { durationSec: 7200 } }];
const binding = { bindingFingerprint: h, family: "music_loop", contentLaneKey: "lane", programBriefFingerprint: h, showProfileFingerprint: h, routeKey: "route", routeAdmission: "automatic", routeFingerprint: h, compositionFingerprint: h, pipelineFingerprint: hash(entries) };
const preflight = { plannerEvidenceFingerprint: h, plannerPlanFingerprint: h, inceptionEvidenceFingerprint: h, inceptionPlanFingerprint: h, runtimeEvidenceFingerprint: h, runtimeTargetFingerprint: h, videoReadinessFingerprint: h, visualMatterEvidenceFingerprint: h, visualMatterStatus: "not_required" };
const body = { version: "production-route-qualification-receipt/v1", level: "route_release_qualified", ownerId: "owner-a", channelId: "channel-a", binding, preflightReceiptFingerprint: h, qualificationFingerprint: h, preflight, quality: { qualityEvidenceFingerprint: h, editorialAcceptanceFingerprint: h, hardGateReady: true, calibrationComplete: true }, provenance: { provenanceEvidenceFingerprint: h, releaseCertificateFingerprint: h, finalMasterSha256: h, qualityEvidenceFingerprint: h, contentLaneKey: "lane", renderer: "renderer", evidenceStatus: "complete", routeBound: true } };
const receipt = { ...body, receiptFingerprint: hash(body) };
const retained = { version: "retained-pipeline-candidate/v1", ownerId: "owner-a", channelId: "channel-a", sourceRunId: "run-a", entries, workerDeployment: { version: "v1", projectId: "project", environmentId: "environment" }, qualification: { receipt } };
const row = { ownerId: "owner-a", channelId: "channel-a", fingerprint: hash(retained), createdAt: 1, candidate: retained };
const worker = historicalWorkerEvidence(row, "owner-a", "channel-a");
assert.equal(worker?.receiptFingerprint, receipt.receiptFingerprint);
assert.equal(worker?.deployment.version, "v1");
assert.equal(historicalWorkerEvidence(row, "owner-b", "channel-a"), null);
assert.equal(historicalWorkerEvidence({ ...row, candidate: { ...retained, workerDeployment: { ...retained.workerDeployment, version: "tampered" } } }, "owner-a", "channel-a"), null);
const withWorker = durationCandidatePreflight({ ownerId: "owner-a", channelId: "channel-a", channel, candidate, maximumCostUsd: 1, worker });
assert.equal(withWorker.binding.historicalWorker?.evidenceFingerprint, row.fingerprint);
assert.notEqual(withWorker.bindingFingerprint, result.bindingFingerprint);
assert.ok(withWorker.blockers.some(value => /historical.*current release/.test(value)));
console.log("Candidate preflight binds proposed settings, budget and historical worker evidence without admission or mutation");
