import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import ts from "typescript";
import type { Block, BlockPatch, RunStageSink } from "@/engine/types";
import { register, getManifest, _clear } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline, PAID_STAGE_RECONCILIATION_MARKER } from "@/engine/runner";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import { rehydrateOutputsWithStorage } from "@/lib/rehydrate";
import { measureVisualPacing } from "@/lib/visualPacing";
import { canonicalJson } from "@/lib/canonicalJson";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { contentLaneForFamily } from "@/engine/contentLane";
import * as transcript from "@/lib/narrationTranscriptProof";
import { classifyExecutionError } from "@/engine/executionErrors";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

// A guarded real qaVisual caller. Orthogonal media/reviewer process transports are
// fixtures; existing transcript validation, hashes, cue gate and audit are real.
// The post-audio sentinel is not a full visual-quality or production approval.
const repo = process.cwd(), requireLocal = createRequire(join(repo, "src/trigger/blocks/narratedBlocks.ts"));
const root = mkdtempSync(join(tmpdir(), "ysa-ordinary-source-preflight-caller-"));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const PRODUCTION_98CA_SOURCE_SHA256 = "24cafc28694165e98e9c4a58f676faf879eb43fa09cd38623c61ed7457de0678";
// Captured from the actual 98ca good caller before extraction, with the repaired
// Python timestamp-entry count. This compact oracle is portable without Git or
// historical files; optional baseline replay additionally compares every byte.
const GOOD_AUDIT_SHA256 = "cf851fa1436dfe7451f0e4123d4f080da572f5be06f76513dd41929eb9b295c3";
const expected = "A small coastal town keeps careful records of the changing weather. Each morning the observer checks the same sheltered station and writes down the time. The archive contains 2,259 well-preserved entries, but one unusual reading is not enough to establish a trend. Chapter one: Comparing records. We compare observations made with consistent equipment and note any gaps before drawing a conclusion. Reliable explanations depend on both the evidence and its limitations.";
const duration = expected.split(/\s+/).length * 0.3 + 2;
const sourcePath = join(root, "synthetic-source-not-speech.mp3"), masterPath = join(root, "synthetic-master-not-video.mp4");
writeFileSync(sourcePath, "guarded source identity; no speech claim"); writeFileSync(masterPath, "guarded final-master identity; no visual claim");
const scope = { ownerId: "owner-a", channelId: "channel-a", runId: "run-a", keyPrefix: "owners/owner-a/" };
const params = { qaProfile: "production", audioQa: false, contentLane: contentLaneForFamily("narrated_stock") };
const store: Record<string, unknown> = { narrationText: expected,
  narrationKey: `${scope.keyPrefix}runs/${scope.runId}/narration.mp3`, narrationLocalPath: sourcePath,
  narrationDurationSec: duration, narrationTranscriptText: expected, sentenceTimings: [{ text: expected, start: 0, end: duration }],
  chapterPlan: [], narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg", durationSec: duration, wordCount: expected.split(/\s+/).length, wordsPerSec: expected.split(/\s+/).length / duration, integratedLufs: -18, windowMeanDb: -20 },
  videoLocalPath: masterPath, videoKey: `${scope.keyPrefix}runs/${scope.runId}/video.mp4`, videoDurationSec: duration,
  thumbnailKey: "guarded-thumbnail", title: "Reading the weather archive", qualityBar: { referenceQuality: referenceQualityContractFor("narrated_stock") },
};
let sourceObserved = expected, masterObserved = expected, audits: ReturnType<typeof transcript.prepareFinalMasterNarrationTranscriptAudit>[] = [];
let transcriptCalls = 0, reviewerCalls = 0, sentinelCalls = 0, writes = 0;
let probeDuration = duration, sourceDownloads = 0;
let downloadSource: Uint8Array | Error | undefined;
let sourceReadOutcomes: Array<Uint8Array | Error> | undefined;
let proofProcessFailure: ReturnType<transcript.NarrationTranscriptProofRunner> | undefined;
let onReview: (() => void) | undefined, afterProof: ((options: transcript.NarrationTranscriptProofOptions) => void) | undefined;
let onFinalAudioMeter: (() => void) | undefined;
const callOrder: string[] = [];
let timestampText: string | undefined;
const timestampScope = "source";
let stopAtQuality = true;
const cueEvents: Array<{ passed: boolean; error?: string }> = [];
const logs: string[] = [];
const sentinel = new Error("GUARDED_POST_AUDIO_QUALITY_BOUNDARY");
function proofFor(options: transcript.NarrationTranscriptProofOptions) {
  transcriptCalls++;
  callOrder.push(options.audioPath === masterPath ? "master-proof" : "source-proof");
  if (proofProcessFailure) return transcript.proveNarrationTranscript({ ...options, runner: () => proofProcessFailure! });
  const observed = options.audioPath === masterPath ? masterObserved : sourceObserved;
  const metrics = spawnSync("python3", ["-c", `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('proof','scripts/narration_transcript_proof.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=json.load(sys.stdin);r=m.tokens(d['expected']);h=m.tokens(d['observed']);w=m.levenshtein(r,h)/len(r);l=m.lexical_recall(r,h)
print(json.dumps({'reference':r,'words':h,'wer':w,'recall':l,'missing':sorted({x for x in r if any(c.isdigit() for c in x) and x not in h})}))`], { cwd: repo, input: JSON.stringify({ expected: options.expectedText, observed }), encoding: "utf8" });
  assert.equal(metrics.status, 0, metrics.stderr); const m = JSON.parse(metrics.stdout);
  const overrideWords = timestampText && (options.audioPath === masterPath ? "final-master" : "source") === timestampScope ? timestampText.split(/\s+/) : undefined;
  const observedWords: string[] = overrideWords ?? observed.split(/\s+/);
  const result: transcript.NarrationTranscriptProof = { schemaVersion: "narration-transcript-proof/v1", provider: "faster-whisper",
    model: { id: transcript.NARRATION_TRANSCRIPT_MODEL_ID, revision: transcript.NARRATION_TRANSCRIPT_MODEL_REVISION, packageVersion: "1.2.1", computeType: "int8-cpu" },
    source: { sha256: options.sourceSha256, byteLength: readFileSync(options.audioPath).length }, expected: { textSha256: hash(options.expectedText), wordCount: m.reference.length },
    transcript: { text: observed, wordCount: observedWords.length, words: observedWords.map((text: string, index: number) => ({ text, startMs: index * 300, endMs: index * 300 + 250 })) },
    assessment: { wordErrorRate: m.wer, lexicalRecall: m.recall, missingNumericTerms: m.missing, thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 }, passed: m.wer <= 0.18 && m.recall >= 0.92 } };
  // Actual process caller and strict proof consumer, with only its external ASR result supplied.
  const accepted = transcript.proveNarrationTranscript({ ...options, runner: () => ({ status: 0, stdout: JSON.stringify(result), stderr: "" }) });
  afterProof?.(options);
  return accepted;
}
function actualBlock(path: string): Block {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} as { qaVisual: Block } };
  const guardedRequire = (name: string) => {
    const actual = requireLocal(name);
    if (name === "@/lib/storage") return { ...actual, getObjectBytes: async (key: string) => { if (key === store.narrationKey) { sourceDownloads++; callOrder.push("source-download"); const next = sourceReadOutcomes ? sourceReadOutcomes.shift() : downloadSource; if (next instanceof Error) throw next; assert.ok(next, "source download must be explicitly guarded"); return next; } assert.equal(key, "guarded-thumbnail"); return Buffer.from("thumbnail-process-fixture"); }, putObject: async () => { writes++; throw new Error("unapproved storage write"); } };
    if (name === "@/lib/ffmpeg") return { ...actual, probe: async () => ({ hasVideo: true, hasAudio: true, durationSec: probeDuration, width: 1920, height: 1080 }), measureAudio: async () => { onFinalAudioMeter?.(); return { integratedLufs: -18, windowMeanDb: -22 }; }, measureNarrationMixCorrelation: async () => ({ correlation: 0.99 }) };
    if (name === "@/lib/visualReview") return { ...actual, reviewRender: async (_path: string, _duration: number, _intent: unknown, options: { sourceSha256: string }) => { reviewerCalls++; callOrder.push("review"); onReview?.(); return { ran: true, verdict: "pass", defects: [], evidence: { source: { sha256: options.sourceSha256 }, frames: [], coverage: { maxGapSec: 1, maxAllowedGapSec: 2, focusedWindows: [] } }, focusWindows: [], broadQualityScore: { score: 9, broadBatchCount: 1 }, summary: "Guarded transport fixture, not a visual review." }; } };
    if (name === "@/lib/videoVerifier") return { ...actual, evaluateThumbnail: async () => ({ score: 9, issues: [] }), evaluateSeo: async () => ({ score: 9, issues: [] }), evaluateIdentity: async () => ({ score: 9, issues: [] }) };
    if (name === "@/lib/renderValidate") return { ...actual, validateRender: async () => ({ ran: true, verdict: "pass", issues: [], temporalDynamism: { verdict: "not_required", source: "guarded", maxFrozenHoldSec: 0, frozenIntervals: [], evaluatedIntervals: [], violatingIntervals: [] }, visualPacing: { verdict: "not_required", usable: true, policy: { mode: "exempt" }, maxHoldSec: 0, medianHoldSec: 0, changeTimestampsSec: [] } }) };
    if (name === "@/lib/narrationTranscriptProof") return { ...actual, proveNarrationTranscript: proofFor, prepareFinalMasterNarrationTranscriptAudit: (input: Parameters<typeof transcript.prepareFinalMasterNarrationTranscriptAudit>[0]) => { const audit = transcript.prepareFinalMasterNarrationTranscriptAudit(input); audits.push(audit); return audit; } };
    if (name === "@/lib/narrationCueTiming") return { ...actual, assertNarrationCueTimingEvidence: (input: unknown) => { try { const result = actual.assertNarrationCueTimingEvidence(input); cueEvents.push({ passed: true }); return result; } catch (error) { cueEvents.push({ passed: false, error: String(error) }); throw error; } } };
    if (name === "@/engine/qualityEvidence") return { ...actual, buildQualityEvidence: (input: Parameters<typeof buildQualityEvidence>[0]) => { if (!stopAtQuality) return actual.buildQualityEvidence(input); sentinelCalls++; throw sentinel; } };
    return actual;
  };
  const load = new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: path }).runInThisContext();
  load(guardedRequire, mod, mod.exports); return mod.exports.qaVisual;
}

type Observation = Awaited<ReturnType<typeof invoke>>;
const results: unknown[] = [];
const sourceBytes = readFileSync(sourcePath), masterBytes = readFileSync(masterPath);
async function invoke(block: Block, seed: Record<string, unknown> = store, selectedParams = params) {
  probeDuration = Number(seed.videoDurationSec ?? duration);
  transcriptCalls = 0; reviewerCalls = 0; sourceDownloads = 0; sentinelCalls = 0; audits = [];
  logs.length = 0; callOrder.length = 0; cueEvents.length = 0;
  let error: unknown;
  try { await block.run({ ...scope, params: selectedParams, store: seed, budgetUsd: 100, stageBudgetUsd: 100,
    log: (message, extra) => logs.push(extra ? `${message} ${JSON.stringify(extra)}` : message) }); }
  catch (caught) { error = caught; }
  return { error, transcriptCalls, reviewerCalls, sourceDownloads, sentinelCalls, audit: audits[0], order: [...callOrder], logs: [...logs], cues: [...cueEvents] };
}
function positive(got: Observation) {
  assert.equal(got.error, sentinel, `${String(got.error)}; ${got.logs.join("\n")}`);
  assert.equal(got.reviewerCalls, 1); assert.equal(got.transcriptCalls, 2); assert.ok(got.audit);
  assert.deepEqual(got.cues, [{ passed: true }]);
  assert.equal(got.audit.bytes.toString(), canonicalJson(got.audit.audit));
  assert.equal(hash(got.audit.bytes), GOOD_AUDIT_SHA256, "accepted ordinary audit bytes must stay exact");
  assert.deepEqual(got.audit.audit.narration.sourceSha256, hash(sourceBytes));
}
function held(got: Observation, reviewers = 0) {
  assert.match(String(got.error), /PAID_STAGE_RECONCILIATION_REQUIRED.*QA_NARRATION_SOURCE_(?:REFUSED|READ_UNAVAILABLE|PROOF_UNAVAILABLE)/);
  assert.equal(classifyExecutionError(got.error).retryable, false);
  assert.equal(taskErrorForRetryPolicy(got.error).classification.kind, "deterministic");
  assert.equal((got.error as { visualRepairSignals?: unknown }).visualRepairSignals, undefined);
  assert.equal(got.reviewerCalls, reviewers); assert.equal(got.audit, undefined); assert.equal(got.sentinelCalls, 0);
}
function invalidSeed(name: string) {
  const seed = structuredClone(store); sourceObserved = expected; masterObserved = expected; timestampText = undefined;
  if (name === "missing-performance") delete seed.narrationPerformanceEvidence;
  if (name === "malformed-performance") seed.narrationPerformanceEvidence = { source: "unmeasured" };
  if (name === "changed-performance-duration") (seed.narrationPerformanceEvidence as { durationSec: number }).durationSec += 1;
  if (name.includes("performance") || name.includes("script")) {
    seed.narrationLocalPath = join(root, `${name}-absent-source.mp3`); downloadSource = sourceBytes;
  }
  if (name === "empty-script") seed.narrationTranscriptText = "  ";
  if (name === "missing-script") delete seed.narrationTranscriptText;
  if (name === "wrong-source") sourceObserved = "Entirely different speech unrelated to the approved narration.";
  if (name === "cue-drift") seed.sentenceTimings = [{ text: expected, start: 4, end: duration }];
  if (name === "contradictory-timestamp-words") timestampText = expected.replace("coastal", "distant");
  if (name === "short-source-duration") {
    seed.narrationDurationSec = 3; seed.videoDurationSec = 3;
    seed.narrationPerformanceEvidence = { ...(store.narrationPerformanceEvidence as object), durationSec: 3, wordCount: 6, wordsPerSec: 2 };
    seed.sentenceTimings = [{ text: expected, start: 0, end: 3 }];
  }
  return seed;
}
const defects = ["missing-performance", "malformed-performance", "changed-performance-duration", "empty-script", "missing-script", "wrong-source", "cue-drift", "contradictory-timestamp-words", "short-source-duration"];

async function beforeOracle(block: Block) {
  positive(await invoke(block));
  for (const name of defects) {
    const seed = invalidSeed(name), got = await invoke(block, seed);
    assert.equal(got.error, sentinel, `${name}: ${String(got.error)}`);
    assert.equal(got.reviewerCalls, 1, "the exact production caller reaches the paid reviewer before noticing known-invalid source evidence");
    if (name.includes("script")) { assert.equal(got.sourceDownloads, 1); assert.equal(got.transcriptCalls, 0); }
    if (name.includes("performance")) { assert.equal(got.sourceDownloads, 1); assert.equal(got.transcriptCalls, 2); }
    if (name === "cue-drift" || name === "short-source-duration") assert.equal(got.cues[0]?.passed, false);
    results.push({ before: true, name, reviewerCalls: got.reviewerCalls, sourceDownloads: got.sourceDownloads, transcriptCalls: got.transcriptCalls, cues: got.cues });
    downloadSource = undefined;
  }
  sourceObserved = expected; timestampText = undefined;
}

async function cacheControl(block: Block, label: string) {
  _clear(); register(block); const manifest = getManifest("qa_visual")!;
  const cached: BlockPatch = Object.fromEntries(Object.keys(manifest.produces).map((key) => [key, {}]));
  Object.assign(cached, { qaPassed: true, finalMasterSha256: hash(masterBytes),
    qaReport: { structural: { ok: true, durationSec: duration, width: 1920, height: 1080 }, lengthMatch: { videoSec: duration, targetSec: duration, ratio: 1, ok: true },
      video: { score: 9, issues: [] }, thumbnail: { score: 9, issues: [] }, watch: { ran: true, verdict: "pass", defects: [], summary: "Synthetic cache transport control, not a fresh quality claim." } },
    qualityEvidence: buildQualityEvidence({ episode: { lane: { key: "narrated_documentary" }, topic: "Synthetic resume transport control" } }),
    visualPacing: measureVisualPacing({ videoPath: masterPath, durationSec: duration, policy: { mode: "exempt", sceneThreshold: 0.1, maxMarkerHoldSec: null, rationale: "Schema-only resume fixture" } }),
  });
  for (const [key, value] of Object.entries(cached)) validateArtifact(artifactContract(key), value);
  const completed = [{ block: "qa_visual", outputs: cached, cost: 0.73 }], original = structuredClone(completed);
  const rows: Parameters<RunStageSink["upsert"]>[0][] = [], demands: unknown[] = [], persisted: string[] = [];
  const calls = { reviewerCalls, transcriptCalls, sourceDownloads, writes };
  const result = await runPipeline(validatePipeline([{ block: "qa_visual", params }], Object.keys(store)), { ...scope, budgetUsd: 100, seedStore: store,
    sink: { async getCompleted() { return completed; }, async upsert(row) { rows.push(row); }, async upsertArtifacts(row) { persisted.push(...row.artifacts.map((artifact) => artifact.artifact.producerModule)); } },
    rehydrate: (id, outputs, demand) => { demands.push({ id, keys: [...(demand?.neededOutputKeys ?? [])].sort() }); return rehydrateOutputsWithStorage(id, outputs, scope.runId, demand, {
      async getObjectToFile() { throw new Error("ordinary cached QA must not download source"); }, async headObjectMetadata() { throw new Error("ordinary cached QA must not HEAD source"); },
    }); }, log: () => {},
  });
  assert.equal(result.ok, true, result.error); assert.equal(result.costTotal, 0.73); assert.deepEqual(result.store.qaReport, cached.qaReport);
  assert.deepEqual(completed, original); assert.deepEqual({ reviewerCalls, transcriptCalls, sourceDownloads, writes }, calls);
  assert.deepEqual(demands, [{ id: "qa_visual", keys: [] }]);
  assert.equal(persisted.length, Object.keys(cached).length); assert.ok(persisted.every((producer) => producer === "qa_visual")); assert.equal(rows[0]?.cost, undefined);
  results.push({ name: `ordinary-cache-${label}`, cost: result.costTotal, demands, sourceDownloads: 0, reviewerCalls: 0, retainedRows: true });
  assert.ok(rows.every((row) => typeof row.finishedAt === "number"));
  return { outputs: cached, cost: result.costTotal, demands, rows: rows.map(({ finishedAt: _clock, ...row }) => { void _clock; return row; }) };
}

async function afterControls(block: Block, baseline?: Block) {
  for (const downloaded of [false, true]) {
    const seed = structuredClone(store);
    if (downloaded) { seed.narrationLocalPath = join(root, "good-absent-source.mp3"); downloadSource = sourceBytes; }
    const got = await invoke(block, seed); positive(got);
    assert.equal(got.sourceDownloads, downloaded ? 1 : 0);
    assert.deepEqual(got.order, [...downloaded ? ["source-download"] : [], "source-proof", "review", "master-proof"]);
    if (baseline) {
      const before = await invoke(baseline, seed); positive(before); assert.deepEqual(got.audit!.bytes, before.audit!.bytes);
      assert.deepEqual(before.order, ["review", ...downloaded ? ["source-download"] : [], "source-proof", "master-proof"]);
    }
    writeFileSync(join(root, `good-${downloaded ? "downloaded" : "local"}-audit.json`), got.audit!.bytes);
    results.push({ name: `good-${downloaded ? "downloaded" : "local"}`, exactAuditBytes: Boolean(baseline), sourceGets: got.sourceDownloads, proofCount: got.transcriptCalls, order: got.order });
    downloadSource = undefined;
  }
  // Actual repaired producer shape: one timestamp entry for grouped digits and
  // hyphenated words, despite multiple lexical tokens. No threshold is changed.
  const normalized = await invoke(block); positive(normalized);
  assert.ok(normalized.audit!.audit.sourceTranscript.transcript.words.some((word) => word.text === "2,259"));
  assert.ok(normalized.audit!.audit.sourceTranscript.transcript.words.some((word) => word.text === "well-preserved"));
  results.push({ name: "grouped-numeral-hyphen-and-spoken-heading", actualCuePassed: true, transcriptWords: normalized.audit!.audit.sourceTranscript.transcript.wordCount, expectedLexicalWords: normalized.audit!.audit.sourceTranscript.expected.wordCount });
  const goodAudit = normalized.audit!.bytes;
  // Continue through the real critical-list failure, not the quality sentinel,
  // to show that final-master failures still reach the existing release gate.
  stopAtQuality = false;
  try {
    for (const name of ["wrong-master", "master-changed-before-audit"] as const) {
      masterObserved = name === "wrong-master" ? "Unrelated speech entirely." : expected;
      if (name === "master-changed-before-audit") onFinalAudioMeter = () => writeFileSync(masterPath, Buffer.alloc(masterBytes.length, 28));
      try {
        const got = await invoke(block);
        assert.match(String(got.error), /qa_visual FAILED:.*final-master narration semantic evidence unavailable/);
        if (name === "master-changed-before-audit") assert.match(String(got.error), /source hash differs from the reviewed final master/);
        assert.equal(got.reviewerCalls, 1); assert.equal(got.transcriptCalls, name === "wrong-master" ? 2 : 1); assert.equal(got.audit, undefined);
        writeFileSync(masterPath, masterBytes);
        if (baseline) {
          const before = await invoke(baseline); assert.equal(String(before.error), String(got.error)); assert.equal(before.reviewerCalls, got.reviewerCalls);
          assert.equal(before.transcriptCalls, got.transcriptCalls); assert.equal(before.audit, undefined);
        }
        results.push({ name, actualCriticalListRefusal: true, identicalBeforeFailure: Boolean(baseline), reviewerCalls: got.reviewerCalls, proofCount: got.transcriptCalls });
      } finally { onFinalAudioMeter = undefined; writeFileSync(masterPath, masterBytes); }
    }
  } finally { masterObserved = expected; stopAtQuality = true; }
  for (const name of defects) {
    const got = await invoke(block, invalidSeed(name)); held(got);
    const cheap = name.includes("performance") || name.includes("script");
    assert.equal(got.sourceDownloads, 0); assert.equal(got.transcriptCalls, cheap ? 0 : 1);
    if (name.includes("script")) assert.match(String(got.error), /narration_tts did not preserve the exact spoken script/);
    if (name === "wrong-source") assert.match(String(got.error), /narration transcript fidelity failure/);
    if (name === "contradictory-timestamp-words") assert.match(String(got.error), /timestamped words do not cover the transcript lexical sequence/);
    if (name === "short-source-duration") assert.match(String(got.error), /extends beyond the authored narration duration/);
    results.push({ name, sourceGets: 0, reviewerCalls: 0, proofCount: got.transcriptCalls, error: String(got.error) });
    downloadSource = undefined;
  }
  sourceObserved = expected; timestampText = undefined;
  for (const moment of ["during-source-proof", "during-review", "before-audit"] as const) for (const target of ["source", "master"] as const) {
    const mutate = () => writeFileSync(target === "source" ? sourcePath : masterPath, Buffer.alloc(target === "source" ? sourceBytes.length : masterBytes.length, 25));
    if (moment === "during-source-proof") afterProof = (options) => { if (options.audioPath !== masterPath) mutate(); };
    if (moment === "during-review") onReview = mutate;
    if (moment === "before-audit") onFinalAudioMeter = mutate;
    try {
      const got = await invoke(block);
      if (target === "source") { held(got, moment === "during-source-proof" ? 0 : 1); assert.match(String(got.error), /source bytes changed after source proof/); }
      else if (moment !== "before-audit") { assert.match(String(got.error), /final master changed during evidence-backed visual review/); assert.equal(got.sentinelCalls, 0); }
      else { assert.equal(got.error, sentinel, "existing ordinary late-master defect is collected, not a new early-throw path"); assert.equal(got.audit, undefined); }
      assert.equal(got.transcriptCalls, 1); assert.equal(got.audit, undefined);
      results.push({ name: `${target}-${moment}`, reviewerCalls: got.reviewerCalls, proofCount: got.transcriptCalls, noAudit: true });
    } finally { afterProof = undefined; onReview = undefined; onFinalAudioMeter = undefined; writeFileSync(sourcePath, sourceBytes); writeFileSync(masterPath, masterBytes); }
  }
  for (const name of ["good", "missing-performance", "empty-script", "wrong-source", "cue-drift", "contradictory-timestamp-words", "read-unavailable", "proof-unavailable"]) {
    const seed = invalidSeed(name), draftParams = { ...params, qaProfile: "draft" };
    if (name === "read-unavailable") { seed.narrationLocalPath = join(root, "draft-missing.mp3"); downloadSource = Object.assign(new Error("guarded service response"), { $metadata: { httpStatusCode: 503 } }); }
    if (name === "proof-unavailable") proofProcessFailure = { status: null, stdout: "", stderr: "", error: Object.assign(new Error("guarded worker timeout"), { code: "ETIMEDOUT" }) };
    try {
      const got = await invoke(block, seed, draftParams);
      assert.equal(got.error, sentinel, String(got.error)); assert.equal(got.audit, undefined);
      if (baseline) {
        const before = await invoke(baseline, seed, draftParams); assert.equal(before.error, sentinel);
        assert.deepEqual(got.order, before.order); assert.deepEqual(got.logs, before.logs); assert.deepEqual(got.cues, before.cues);
      }
      if (name === "empty-script") { assert.equal(got.sourceDownloads, 1); assert.equal(got.transcriptCalls, 0); }
      results.push({ name: `draft-${name}`, exactOrderLogsCues: Boolean(baseline), sourceGets: got.sourceDownloads, proofCount: got.transcriptCalls });
    } finally { downloadSource = undefined; proofProcessFailure = undefined; }
  }
  sourceObserved = expected; timestampText = undefined;
  const noNarration = structuredClone(store);
  for (const key of ["narrationDurationSec", "narrationPerformanceEvidence", "narrationLocalPath", "narrationKey", "narrationTranscriptText"]) delete noNarration[key];
  const absent = await invoke(block, noNarration);
  assert.equal(absent.error, sentinel); assert.deepEqual(absent.order, ["review"]);
  if (baseline) { const absentBefore = await invoke(baseline, noNarration); assert.deepEqual(absent.logs, absentBefore.logs); }
  const afterCache = await cacheControl(block, "current");
  if (baseline) { const beforeCache = await cacheControl(baseline, "98ca"); assert.deepEqual(afterCache, beforeCache); }
  _clear(); register(block);
  await availabilityControls(block, goodAudit);
}

async function availabilityControls(block: Block, goodAudit: Buffer) {
  // Execute the actual run-level self-heal guard, stopping at its first possible
  // planHeal call. This is not a full Trigger invocation or a mocked approval.
  const taskSource = ts.createSourceFile("runPipeline.ts", readFileSync(join(repo, "src/trigger/runPipeline.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const healLoops: ts.WhileStatement[] = [];
  const visit = (node: ts.Node): void => { if (ts.isWhileStatement(node) && node.expression.getText(taskSource).includes("heals < MAX_SELF_HEALS")) healLoops.push(node); ts.forEachChild(node, visit); };
  visit(taskSource); assert.equal(healLoops.length, 1);
  const healLoopScript = ts.transpileModule(`(async () => { ${healLoops[0]!.getText(taskSource)} })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  async function actualHealCalls(error: string): Promise<number> {
    let calls = 0; const boundary = new Error("GUARDED_SELF_HEAL_PLAN_BOUNDARY");
    try {
      await new vm.Script(healLoopScript).runInNewContext({
        result: { ok: false, error }, heals: 0, MAX_SELF_HEALS: 2, PAID_STAGE_RECONCILIATION_MARKER,
        log: () => {}, healable: [], contentLane: { key: "narrated_documentary" }, channel: {},
        planHeal: () => { calls++; throw boundary; },
      });
    } catch (error) { assert.equal(error, boundary); }
    return calls;
  }
  assert.equal(await actualHealCalls("ordinary failure without reconciliation marker"), 1, "negative control must reach the actual self-heal planner boundary");
  const transientReadErrors = [
    ["structured-timeout", Object.assign(new Error("guarded source read timeout"), { code: "ETIMEDOUT" })],
    ["sdk-named-timeout", Object.assign(new Error("guarded SDK connection failure"), { name: "TimeoutError" })],
    ["sdk-503", Object.assign(new Error("guarded service response"), { $metadata: { httpStatusCode: 503, attempts: 3 } })],
  ] as const;
  for (const [name, transportError] of transientReadErrors) {
    const seed = { ...store, narrationLocalPath: join(root, `${name}-missing.mp3`) };
    sourceReadOutcomes = [transportError];
    const direct = await invoke(block, seed);
    assert.match(String(direct.error), /QA_NARRATION_SOURCE_READ_UNAVAILABLE/); assert.equal(classifyExecutionError(direct.error).retryable, true);
    const task = taskErrorForRetryPolicy(direct.error); assert.equal(task.classification.kind, "transient"); assert.equal(task.error, direct.error, "marker must not turn a typed safe read retry into a task abort");
    assert.equal(direct.transcriptCalls, 0); assert.equal(direct.reviewerCalls, 0); assert.equal(direct.sourceDownloads, 1);
    for (const recover of [true, false]) {
      sourceReadOutcomes = recover ? [transportError, sourceBytes] : [transportError, transportError, transportError];
      reviewerCalls = 0; transcriptCalls = 0; sourceDownloads = 0; audits = []; callOrder.length = 0;
      const retryLogs: string[] = [], rows: Parameters<RunStageSink["upsert"]>[0][] = [], persisted: string[] = [];
      const result = await runPipeline(validatePipeline([{ block: "qa_visual", params }], Object.keys(seed)), { ...scope, budgetUsd: 100, defaultRetries: 2, seedStore: seed,
        sink: { async getCompleted() { return []; }, async upsert(row) { rows.push(row); }, async upsertArtifacts(row) { persisted.push(...row.artifacts.map((artifact) => artifact.artifact.producerModule)); } }, log: (message) => retryLogs.push(message) });
      assert.equal(result.ok, false, "good recovery stops at the explicit post-audio sentinel, never a fabricated QA completion");
      assert.equal(sourceDownloads, recover ? 2 : 3); assert.equal(transcriptCalls, recover ? 2 : 0); assert.equal(reviewerCalls, recover ? 1 : 0);
      assert.equal(retryLogs.filter((message) => message.includes("transient error (retry")).length, recover ? 1 : 2);
      assert.equal(sourceReadOutcomes.length, 0); assert.equal(result.costTotal, 0); assert.equal(result.visualRepair, undefined); assert.equal(result.retryDirective, undefined);
      assert.equal(persisted.includes("qa_visual"), false); assert.ok(rows.every((row) => row.block === "qa_visual"));
      if (recover) { assert.match(result.error!, /GUARDED_POST_AUDIO_QUALITY_BOUNDARY/); assert.equal(audits.length, 1); assert.deepEqual(audits[0]!.bytes, goodAudit); }
      else { assert.match(result.error!, /PAID_STAGE_RECONCILIATION_REQUIRED.*QA_NARRATION_SOURCE_READ_UNAVAILABLE/); assert.equal(audits.length, 0); assert.equal(await actualHealCalls(result.error!), 0); }
      results.push({ name: `${name}-${recover ? "recovers" : "exhausts"}`, sourceReads: sourceDownloads, sameStageRetries: recover ? 1 : 2, transcriptCalls, reviewerCalls, qaArtifactsPersisted: 0, upstreamReruns: 0 });
    }
    sourceReadOutcomes = undefined;
  }
  for (const [name, transportError] of [
    ["sdk-404", Object.assign(new Error("guarded missing object"), { $metadata: { httpStatusCode: 404 } })],
    ["untyped-timeout", new Error("guarded timeout text alone")],
    ["unknown-code-timeout", Object.assign(new Error("guarded timeout text"), { code: "NOT_A_TRANSPORT_CODE" })],
    ["explicit-nonretryable-timeout", Object.assign(new Error("guarded timeout"), { code: "ETIMEDOUT", retryable: false })],
  ] as const) {
    const seed = { ...store, narrationLocalPath: join(root, `${name}-missing.mp3`) }; sourceReadOutcomes = [transportError];
    const got = await invoke(block, seed); held(got); assert.match(String(got.error), /QA_NARRATION_SOURCE_READ_UNAVAILABLE/); assert.equal(got.sourceDownloads, 1); assert.equal(got.transcriptCalls, 0);
    results.push({ name, availabilityHeldNotBadSpeech: true, sourceReads: 1, retries: 0 }); sourceReadOutcomes = undefined;
  }
  // The real runner must neither retry nor publish artifacts on either refusal.
  for (const _control of [0]) {
    void _control; sourceObserved = "Wrong speech entirely.";
    const seed = structuredClone(store);
    const rows: Parameters<RunStageSink["upsert"]>[0][] = [], persisted: string[] = [];
    reviewerCalls = 0; transcriptCalls = 0;
    const result = await runPipeline(validatePipeline([{ block: "qa_visual", params }], Object.keys(seed)), { ...scope, budgetUsd: 100, defaultRetries: 2, seedStore: seed,
      sink: { async getCompleted() { return []; }, async upsert(row) { rows.push(row); }, async upsertArtifacts(row) { persisted.push(...row.artifacts.map((artifact) => artifact.artifact.producerModule)); } }, log: () => {} });
    assert.equal(result.ok, false); assert.equal(result.failedBlock, "qa_visual"); assert.match(result.error!, /PAID_STAGE_RECONCILIATION_REQUIRED/);
    assert.equal(result.visualRepair, undefined); assert.equal(result.retryDirective, undefined); assert.equal(result.costTotal, 0);
    assert.equal(await actualHealCalls(result.error!), 0);
    assert.equal(reviewerCalls, 0); assert.equal(transcriptCalls, 1); assert.equal(rows.filter((row) => row.status === "failed").length, 1);
    assert.equal(rows.some((row) => row.status === "ok"), false); assert.equal(rows.find((row) => row.status === "failed")?.cost, undefined);
    assert.equal(persisted.includes("qa_visual"), false);
    results.push({ name: "runner-source-refusal", retries: 0, reviewerCalls, sourceProofs: transcriptCalls, observedCost: result.costTotal, qaArtifactsPersisted: 0 });
  }
  sourceObserved = expected; masterObserved = expected;
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("all network forbidden"); };
  try {
    const file = process.env.NARRATION_PREFLIGHT_SOURCE ?? join(repo, "src/trigger/blocks/narratedBlocks.ts");
    if (process.env.NARRATION_PREFLIGHT_EXPECT_BEFORE) assert.equal(hash(readFileSync(file)), PRODUCTION_98CA_SOURCE_SHA256, "before oracle requires the exact production source, never current code mislabeled as baseline");
    if (process.env.NARRATION_PREFLIGHT_BASELINE) assert.equal(hash(readFileSync(process.env.NARRATION_PREFLIGHT_BASELINE)), PRODUCTION_98CA_SOURCE_SHA256, "historical comparison is pinned to production 98ca");
    const block = actualBlock(file); _clear(); register(block);
    if (process.env.NARRATION_PREFLIGHT_EXPECT_BEFORE) await beforeOracle(block);
    else {
      await afterControls(block, process.env.NARRATION_PREFLIGHT_BASELINE ? actualBlock(process.env.NARRATION_PREFLIGHT_BASELINE) : undefined);
      proofProcessFailure = { status: null, stdout: "", stderr: "", error: Object.assign(new Error("guarded transcriber timeout"), { code: "ETIMEDOUT" }) };
      const unavailable = await invoke(block); held(unavailable); assert.match(String(unavailable.error), /QA_NARRATION_SOURCE_PROOF_UNAVAILABLE.*availability is unclassified/);
      assert.equal(unavailable.transcriptCalls, 1); proofProcessFailure = undefined;
      results.push({ name: "flattened-ASR-availability-unclassified", reviewerCalls: 0, sourceProofs: 1, noAutomaticRetry: true });
      writeFileSync(sourcePath, "");
      try { const empty = await invoke(block); held(empty); assert.equal(empty.transcriptCalls, 0); }
      finally { writeFileSync(sourcePath, sourceBytes); }
    }
    assert.equal(writes, 0);
    console.log(JSON.stringify({ retained: root, sourceSha256: hash(readFileSync(file)), before: Boolean(process.env.NARRATION_PREFLIGHT_EXPECT_BEFORE), liveProviders: 0, fullQualityCompletion: false, results }, null, 2));
  } finally { globalThis.fetch = originalFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
