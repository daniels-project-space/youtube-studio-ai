import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import ts from "typescript";
import type { Block, StageContext, BlockPatch, RunStageSink } from "@/engine/types";
import { register, getManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import { rehydrateOutputsWithStorage } from "@/lib/rehydrate";
import { measureVisualPacing } from "@/lib/visualPacing";
import { canonicalJson } from "@/lib/canonicalJson";
import { parseWorkedExampleSpeech } from "@/engine/workedExampleSpeech";
import { prepareWorkedExample } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { createWorkedExampleAudioBinding } from "@/engine/workedExampleAudioBinding";
import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { contentLaneForFamily } from "@/engine/contentLane";
import * as transcript from "@/lib/narrationTranscriptProof";

// A guarded real qaVisual caller. Orthogonal media/reviewer process transports are
// fixtures; existing transcript validation, hashes, cue gate and audit are real.
// The post-audio sentinel is not a full visual-quality or production approval.
const repo = process.cwd(), requireLocal = createRequire(join(repo, "src/trigger/blocks/narratedBlocks.ts"));
const root = mkdtempSync(join(tmpdir(), "ysa-arithmetic-critical-qa-caller-"));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const request = { policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a", runId: "run-a", requestId: "lesson-a", seed: "critical-speech-a", operations: ["subtract", "multiply", "add", "exact_divide"] };
const prepared = prepareWorkedExample(request), draft = draftWorkedExampleNarration(prepared, request);
const expected = draft.narrationText, duration = expected.split(/\s+/).length * 0.3 + 2;
const sourcePath = join(root, "synthetic-source-not-speech.mp3"), masterPath = join(root, "synthetic-master-not-video.mp4");
writeFileSync(sourcePath, "guarded source identity; no speech claim"); writeFileSync(masterPath, "guarded final-master identity; no visual claim");
const scope = { ownerId: request.ownerId, channelId: request.channelId, runId: request.runId, keyPrefix: "owners/owner-a/" };
const params = { qaProfile: "production", audioQa: false, contentLane: contentLaneForFamily("narrated_stock") };
const store: Record<string, unknown> = { workedExampleRequest: request, workedExamplePreparation: prepared, script: draft.script, narrationText: expected,
  scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script),
  narrationKey: `${scope.keyPrefix}runs/${scope.runId}/narration.mp3`, narrationLocalPath: sourcePath,
  narrationDurationSec: duration, narrationTranscriptText: expected, sentenceTimings: [{ text: expected, start: 0, end: duration }],
  chapterPlan: [], narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg", durationSec: duration, wordCount: expected.split(/\s+/).length, wordsPerSec: expected.split(/\s+/).length / duration, integratedLufs: -18, windowMeanDb: -20 },
  videoLocalPath: masterPath, videoKey: `${scope.keyPrefix}runs/${scope.runId}/video.mp4`, videoDurationSec: duration,
  thumbnailKey: "guarded-thumbnail", title: "Verified integer example", qualityBar: { referenceQuality: referenceQualityContractFor("narrated_stock") },
};
store.workedExampleAudioBinding = createWorkedExampleAudioBinding({ ...scope, params: {}, store }, store, expected.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'“‘])/), readFileSync(sourcePath));
let sourceObserved = expected, masterObserved = expected, audits: ReturnType<typeof transcript.prepareFinalMasterNarrationTranscriptAudit>[] = [];
let transcriptCalls = 0, reviewerCalls = 0, sentinelCalls = 0, writes = 0;
let auditGet: ((key: string, options: { timeoutMs?: number } | undefined) => Promise<Uint8Array>) | undefined;
let timestampText: string | undefined, timestampScope: "source" | "final-master" = "source", rawTimestampWords = false;
const logs: string[] = [];
const sentinel = new Error("GUARDED_POST_AUDIO_QUALITY_BOUNDARY");
function proofFor(options: transcript.NarrationTranscriptProofOptions) {
  transcriptCalls++;
  const observed = options.audioPath === masterPath ? masterObserved : sourceObserved;
  const metrics = spawnSync("python3", ["-c", `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('proof','scripts/narration_transcript_proof.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=json.load(sys.stdin);r=m.tokens(d['expected']);h=m.tokens(d['observed']);w=m.levenshtein(r,h)/len(r);l=m.lexical_recall(r,h)
print(json.dumps({'reference':r,'words':h,'wer':w,'recall':l,'missing':sorted({x for x in r if any(c.isdigit() for c in x) and x not in h})}))`], { cwd: repo, input: JSON.stringify({ expected: options.expectedText, observed }), encoding: "utf8" });
  assert.equal(metrics.status, 0, metrics.stderr); const m = JSON.parse(metrics.stdout);
  const overrideWords = timestampText && (options.audioPath === masterPath ? "final-master" : "source") === timestampScope ? timestampText.split(/\s+/) : undefined;
  const observedWords: string[] = overrideWords ?? (rawTimestampWords ? observed.split(/\s+/) : m.words);
  const result: transcript.NarrationTranscriptProof = { schemaVersion: "narration-transcript-proof/v1", provider: "faster-whisper",
    model: { id: transcript.NARRATION_TRANSCRIPT_MODEL_ID, revision: transcript.NARRATION_TRANSCRIPT_MODEL_REVISION, packageVersion: "1.2.1", computeType: "int8-cpu" },
    source: { sha256: options.sourceSha256, byteLength: readFileSync(options.audioPath).length }, expected: { textSha256: hash(options.expectedText), wordCount: m.reference.length },
    transcript: { text: observed, wordCount: m.words.length, words: observedWords.map((text: string, index: number) => ({ text, startMs: index * 300, endMs: index * 300 + 250 })) },
    assessment: { wordErrorRate: m.wer, lexicalRecall: m.recall, missingNumericTerms: m.missing, thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 }, passed: m.wer <= 0.18 && m.recall >= 0.92 } };
  // Actual process caller and strict proof consumer, with only its external ASR result supplied.
  return transcript.proveNarrationTranscript({ ...options, runner: () => ({ status: 0, stdout: JSON.stringify(result), stderr: "" }) });
}
function actualBlock(path: string): Block {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} as { qaVisual: Block } };
  const guardedRequire = (name: string) => {
    const actual = requireLocal(name);
    if (name === "@/lib/storage") return { ...actual, getObjectBytes: async (key: string, _bucket?: string, options?: { timeoutMs?: number }) => { if (auditGet) return auditGet(key, options); assert.equal(key, "guarded-thumbnail"); return Buffer.from("thumbnail-process-fixture"); }, putObject: async () => { writes++; throw new Error("unapproved storage write"); } };
    if (name === "@/lib/ffmpeg") return { ...actual, probe: async () => ({ hasVideo: true, hasAudio: true, durationSec: duration, width: 1920, height: 1080 }), measureAudio: async () => ({ integratedLufs: -18, windowMeanDb: -22 }), measureNarrationMixCorrelation: async () => ({ correlation: 0.99 }) };
    if (name === "@/lib/visualReview") return { ...actual, reviewRender: async (_path: string, _duration: number, _intent: unknown, options: { sourceSha256: string }) => { reviewerCalls++; return { ran: true, verdict: "pass", defects: [], evidence: { source: { sha256: options.sourceSha256 }, frames: [], coverage: { maxGapSec: 1, maxAllowedGapSec: 2, focusedWindows: [] } }, focusWindows: [], broadQualityScore: { score: 9, broadBatchCount: 1 }, summary: "Guarded transport fixture, not a visual review." }; } };
    if (name === "@/lib/videoVerifier") return { ...actual, evaluateThumbnail: async () => ({ score: 9, issues: [] }), evaluateSeo: async () => ({ score: 9, issues: [] }), evaluateIdentity: async () => ({ score: 9, issues: [] }) };
    if (name === "@/lib/renderValidate") return { ...actual, validateRender: async () => ({ ran: true, verdict: "pass", issues: [], temporalDynamism: { verdict: "not_required", source: "guarded", maxFrozenHoldSec: 0, frozenIntervals: [], evaluatedIntervals: [], violatingIntervals: [] }, visualPacing: { verdict: "not_required", usable: true, policy: { mode: "exempt" }, maxHoldSec: 0, medianHoldSec: 0, changeTimestampsSec: [] } }) };
    if (name === "@/lib/narrationTranscriptProof") return { ...actual, proveNarrationTranscript: proofFor, prepareFinalMasterNarrationTranscriptAudit: (input: Parameters<typeof transcript.prepareFinalMasterNarrationTranscriptAudit>[0]) => { const audit = transcript.prepareFinalMasterNarrationTranscriptAudit(input); audits.push(audit); return audit; } };
    if (name === "@/engine/qualityEvidence") return { ...actual, buildQualityEvidence: () => { sentinelCalls++; throw sentinel; } };
    return actual;
  };
  const load = new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: path }).runInThisContext();
  load(guardedRequire, mod, mod.exports); return mod.exports.qaVisual;
}
async function cacheCases(block: Block, audit: ReturnType<typeof transcript.prepareFinalMasterNarrationTranscriptAudit>) {
  register(block); const manifest = getManifest("qa_visual")!;
  const upstream = requireLocal("@/trigger/blocks/narratedBlocks"); register(upstream.narrationTts); register(upstream.timelineAssemble);
  const auditKey = transcript.finalMasterNarrationTranscriptAuditObjectKey(scope.keyPrefix, scope.runId, audit.contentSha256);
  const semantic = transcript.sealFinalMasterNarrationSemanticEvidence({ version: "final-master-narration-semantic-evidence/v1", finalMaster: audit.audit.finalMaster, narration: audit.audit.narration,
    sourceTranscript: audit.sourceTranscript, finalMasterTranscript: audit.finalMasterTranscript,
    auditArtifact: { version: "final-master-narration-transcript-audit/v1", r2Key: auditKey, contentSha256: audit.contentSha256, byteLength: audit.bytes.length } });
  const cached: BlockPatch = Object.fromEntries(Object.keys(manifest.produces).map((key) => [key, {}]));
  Object.assign(cached, { qaPassed: true, finalMasterSha256: hash(readFileSync(masterPath)),
    qaReport: { structural: { ok: true, durationSec: duration, width: 1920, height: 1080 }, lengthMatch: { videoSec: duration, targetSec: duration, ratio: 1, ok: true },
      video: { score: 9, issues: [] }, thumbnail: { score: 9, issues: [] }, watch: { ran: true, verdict: "pass", defects: [], summary: "Synthetic cached boundary fixture, not a quality approval." },
      renderValidation: { unrelatedExistingField: { retain: true }, workedExampleCriticalSpeech: audit.audit.workedExampleCriticalSpeech, finalMasterNarrationSemantic: semantic } },
    qualityEvidence: buildQualityEvidence({ episode: { lane: { key: "narrated_documentary" }, topic: "Explicit synthetic resume fixture" } }),
    visualPacing: measureVisualPacing({ videoPath: masterPath, durationSec: duration, policy: { mode: "exempt", sceneThreshold: 0.1, maxMarkerHoldSec: null, rationale: "Synthetic artifact-schema fixture only" } }),
  });
  for (const [key, value] of Object.entries(cached)) validateArtifact(artifactContract(key), value);
  const verdicts: unknown[] = [];
  const sourceBytes = readFileSync(sourcePath), masterBytes = readFileSync(masterPath);
  async function attempt(name: string, options: { mutate?: (patch: BlockPatch, seed: Record<string, unknown>) => void; params?: Record<string, unknown>;
    missing?: "source" | "both"; transport?: "404" | "timeout" | "corrupt" | "changed-source"; ordinary?: boolean; noRehydrate?: boolean; seedOnly?: boolean; auditBytes?: Uint8Array } = {}, good = false, expectedGets = 0) {
    const patch = structuredClone(cached), seed = structuredClone(store), currentParams = options.params ?? params;
    if (options.ordinary) {
      for (const key of ["workedExampleRequest", "workedExamplePreparation", "workedExampleAudioBinding", "workedExampleEditorialApproval"]) delete seed[key];
      seed.script = { hook: draft.script.hook, sections: draft.script.sections, narrationText: expected, estDurationSec: draft.script.estDurationSec };
      delete (patch.qaReport as { renderValidation: Record<string, unknown> }).renderValidation.workedExampleCriticalSpeech;
    }
    if (options.missing) seed.narrationLocalPath = join(root, `${name}-missing-source.mp3`);
    if (options.missing === "both") seed.videoLocalPath = join(root, `${name}-missing-master.mp4`);
    options.mutate?.(patch, seed);
    const useUpstream = options.missing && !options.seedOnly;
    const speech = Object.fromEntries([...Object.keys(getManifest("narration_tts")!.produces), ...Object.keys(getManifest("narration_tts")!.optionalProduces)].filter((key) => key in seed).map((key) => [key, seed[key]]));
    const master = Object.fromEntries(Object.keys(getManifest("timeline_assemble")!.produces).map((key) => [key, seed[key] ?? (key.endsWith("Applied") ? false : key === "overlaysDropped" ? 0 : key.endsWith("Key") || key.endsWith("Path") ? "" : [])]));
    const completed = [...useUpstream ? [{ block: "narration_tts", outputs: speech, cost: 0.42 }, { block: "timeline_assemble", outputs: master, cost: 0 }] : [], { block: "qa_visual", outputs: patch, cost: 0.73 }], original = structuredClone(completed);
    const selected = [...useUpstream ? [{ block: "narration_tts", params: {} }, { block: "timeline_assemble", params: {} }] : [], { block: "qa_visual", params: currentParams }];
    if (useUpstream) Object.assign(seed, { footageClips: [], entityClips: [], introCardPath: "", musicUrl: "" });
    const rows: Parameters<RunStageSink["upsert"]>[0][] = [], persisted: string[] = [], demands: unknown[] = [];
    let gets = 0, downloads = 0, failure: unknown, result: Awaited<ReturnType<typeof runPipeline>> | undefined;
    const beforeCalls = { transcriptCalls, reviewerCalls, sentinelCalls, writes };
    auditGet = async (key, options_) => { gets++; assert.equal(key, ((patch.qaReport as { renderValidation: { finalMasterNarrationSemantic: typeof semantic } }).renderValidation.finalMasterNarrationSemantic).auditArtifact.r2Key); assert.equal(options_?.timeoutMs, 30_000);
      if (options.transport === "404" || options.transport === "timeout") throw new Error(`guarded ${options.transport}`);
      if (options.transport === "changed-source") writeFileSync(sourcePath, Buffer.alloc(sourceBytes.length, 23));
      return options.transport === "corrupt" ? Buffer.alloc(audit.bytes.length, 0) : options.auditBytes ?? audit.bytes;
    };
    try {
      result = await runPipeline(validatePipeline(selected, Object.keys(seed)), { ...scope, budgetUsd: 100, defaultRetries: 2, seedStore: seed,
        sink: { async getCompleted() { return completed; }, async upsert(row) { rows.push(row); }, async upsertArtifacts(row) { persisted.push(...row.artifacts.map((artifact) => artifact.artifact.producerModule)); } },
        ...options.noRehydrate ? {} : { rehydrate: (id: string, outputs: Record<string, unknown>, demand?: Parameters<typeof rehydrateOutputsWithStorage>[3]) => {
          demands.push({ id, keys: [...(demand?.neededOutputKeys ?? [])].sort() });
          return rehydrateOutputsWithStorage(id, outputs, scope.runId, demand, {
            async getObjectToFile(key, path) { downloads++; assert.ok(key === store.narrationKey || key === store.videoKey); writeFileSync(path, key === store.narrationKey ? sourceBytes : masterBytes); return path; },
            async headObjectMetadata(key) { assert.ok(useUpstream && key === store.videoKey, "only the existing skipped upstream master HEAD fence is permitted"); return { contentLength: masterBytes.length, metadata: {} }; },
          });
        } }, log: () => {},
      });
    } catch (error) { failure = error; }
    finally { auditGet = undefined; writeFileSync(sourcePath, sourceBytes); writeFileSync(masterPath, masterBytes); }
    assert.equal(gets, expectedGets, `${name}: ${String(failure)}; demands=${JSON.stringify(demands)}`); assert.deepEqual(completed, original, "original completed row/cost retained");
    assert.deepEqual({ transcriptCalls, reviewerCalls, sentinelCalls, writes }, beforeCalls, "cached inspection cannot invoke any fresh work or storage mutation");
    if (good) {
      assert.equal(failure, undefined, `${name}: ${String(failure)}`); assert.equal(result?.ok, true, `${name}: ${result?.error}`); assert.equal(result.costTotal, useUpstream ? 1.15 : 0.73);
      assert.deepEqual(result.store.qaReport, patch.qaReport); assert.equal(rows.filter((row) => row.block === "qa_visual").length, 1); assert.equal(rows.find((row) => row.block === "qa_visual")?.cost, undefined); assert.ok(persisted.includes("qa_visual"));
    } else { assert.match(String(failure), /CACHED_OUTPUT_BINDING_REFUSED/, `${name}: ${String(failure)}`); assert.equal(rows.filter((row) => row.block === "qa_visual").length, 0); assert.equal(persisted.includes("qa_visual"), false); }
    if (options.ordinary) { assert.equal(downloads, 0); assert.deepEqual(demands, [{ id: "qa_visual", keys: [] }]); }
    verdicts.push({ name, good, gets, downloads, demands, retainedOriginalCost: 0.73 });
  }
  const render = (patch: BlockPatch) => (patch.qaReport as { renderValidation: Record<string, unknown> }).renderValidation;
  await attempt("unchanged-local", {}, true, 1);
  await attempt("unchanged-missing-source", { missing: "source" }, true, 1);
  await attempt("unchanged-missing-both", { missing: "both" }, true, 1);
  await attempt("missing-seed-only-holds-without-producer", { missing: "source", seedOnly: true });
  await attempt("ordinary-unchanged", { ordinary: true }, true);
  await attempt("legacy-missing-report", { mutate: (patch) => { delete render(patch).workedExampleCriticalSpeech; } });
  await attempt("report-only-no-sealed-proof", { mutate: (patch) => { delete render(patch).finalMasterNarrationSemantic; } });
  const falseAudit = structuredClone(audit.audit);
  const falseText = expected.replace(prepared.projection.answerSpeech, "The answer is seven.");
  falseAudit.finalMasterTranscript.transcript.text = falseText;
  falseAudit.finalMasterTranscript.transcript.words = falseText.split(/\s+/).map((text, index) => ({ text, startMs: index * 300, endMs: index * 300 + 250 }));
  falseAudit.finalMasterTranscript.transcript.wordCount = falseAudit.finalMasterTranscript.transcript.words.length;
  const falseReport = falseAudit.workedExampleCriticalSpeech!;
  falseReport.finalMaster.proofSha256 = hash(canonicalJson(falseAudit.finalMasterTranscript));
  falseReport.finalMaster.transcriptTextSha256 = hash(falseText);
  falseReport.finalMaster.timestampWordsSha256 = hash(canonicalJson(falseAudit.finalMasterTranscript.transcript.words));
  const { reportFingerprint: _falseFingerprint, ...falseReportBody } = falseReport; void _falseFingerprint;
  falseReport.reportFingerprint = hash(canonicalJson(falseReportBody));
  const falseBytes = Buffer.from(canonicalJson(falseAudit));
  await attempt("rehash-every-summary-but-wrong-full-transcript", { auditBytes: falseBytes, mutate: (patch) => {
    const altered = structuredClone(semantic); altered.finalMasterTranscript = transcript.summarizeNarrationTranscriptProof(falseAudit.finalMasterTranscript);
    altered.auditArtifact = { ...altered.auditArtifact, contentSha256: hash(falseBytes), byteLength: falseBytes.length,
      r2Key: transcript.finalMasterNarrationTranscriptAuditObjectKey(scope.keyPrefix, scope.runId, hash(falseBytes)) };
    const { receiptFingerprint: _receipt, ...body } = altered; void _receipt;
    render(patch).finalMasterNarrationSemantic = transcript.sealFinalMasterNarrationSemanticEvidence(body);
    render(patch).workedExampleCriticalSpeech = falseReport;
  } }, false, 1);
  await attempt("tampered-report", { mutate: (patch) => { (render(patch).workedExampleCriticalSpeech as { reportFingerprint: string }).reportFingerprint = "f".repeat(64); } });
  await attempt("changed-qa-settings", { params: { ...params, chapterCards: true } });
  await attempt("changed-current-timing", { mutate: (_patch, seed) => { seed.narrationDurationSec = duration + 1; } });
  await attempt("changed-current-voice-binding", { mutate: (_patch, seed) => { (seed.workedExampleAudioBinding as { inputFingerprint: string }).inputFingerprint = "f".repeat(64); } });
  await attempt("changed-current-master-key", { mutate: (_patch, seed) => { seed.videoKey = "different-master"; } });
  await attempt("changed-source-bytes", { mutate: () => { writeFileSync(sourcePath, Buffer.alloc(sourceBytes.length, 4)); } });
  await attempt("changed-master-bytes", { mutate: () => { writeFileSync(masterPath, Buffer.alloc(masterBytes.length, 5)); } });
  await attempt("symlink-source", { mutate: (_patch, seed) => { const link = join(root, "symlink-source.mp3"); symlinkSync(sourcePath, link); seed.narrationLocalPath = link; } });
  await attempt("missing-current-request", { mutate: (_patch, seed) => { delete seed.workedExampleRequest; } });
  await attempt("bad-audit-key", { mutate: (patch) => {
    const altered = structuredClone(semantic); altered.auditArtifact.r2Key = "foreign/run/audit.json";
    const { receiptFingerprint: _fingerprint, ...body } = altered; void _fingerprint;
    render(patch).finalMasterNarrationSemantic = transcript.sealFinalMasterNarrationSemanticEvidence(body);
  } });
  for (const transport of ["404", "timeout", "corrupt", "changed-source"] as const) await attempt(`audit-${transport}`, { transport }, false, 1);
  await attempt("no-rehydrator", { noRehydrate: true });
  console.log(JSON.stringify({ actualRegisteredQaVisualCache: verdicts, retained: root }, null, 2));
}
async function freshControls(block: Block) {
  const results: unknown[] = [];
  const invoke = async (seed: Record<string, unknown>, selectedParams: Record<string, unknown> = params, selectedBlock = block) => {
    transcriptCalls = 0; reviewerCalls = 0; sentinelCalls = 0; audits = []; logs.length = 0;
    let error: unknown;
    try { await selectedBlock.run({ ...scope, params: selectedParams, store: seed, budgetUsd: 100, stageBudgetUsd: 100, log: (message, extra) => logs.push(extra ? `${message} ${JSON.stringify(extra)}` : message) }); }
    catch (caught) { error = caught; }
    return { error, transcriptCalls, reviewerCalls, sentinelCalls, audit: audits[0], logs: [...logs] };
  };
  for (const observed of [expected.replace("seventy eight", "seventy-eight"), expected.replace(prepared.projection.answerSpeech, "The answer is negative 961.")]) {
    assert.notEqual(observed, expected); assert.deepEqual(parseWorkedExampleSpeech(observed), parseWorkedExampleSpeech(expected));
    sourceObserved = observed; masterObserved = observed;
    const got = await invoke(store); assert.equal(got.error, sentinel, `${String(got.error)}; ${got.logs.join("\n")}`); assert.ok(got.audit?.audit.workedExampleCriticalSpeech); assert.equal(got.transcriptCalls, 2);
    results.push({ name: observed.includes("seventy-eight") ? "equivalent-hyphenated-word" : "equivalent-negative-digit", transcriptCalls: got.transcriptCalls, arithmeticAccepted: true, sharedAuditAccepted: true });
  }
  const replacements = [
    ["wrong-operator", expected.replace(" minus ", " plus ")], ["missing-negative", expected.replace("negative ", "")],
    ["missing-step", expected.replace(/Step one\.[\s\S]*?Step two\./, "Step two.")], ["reordered-step", expected.replace("Step one.", "Step two.")],
    ["wrong-step-result", expected.replace("equals negative eighty seven", "equals negative eighty eight")], ["extra-unbound-answer", expected + " The answer is seven."],
  ];
  for (const [name, observed] of replacements) for (const place of ["source", "final-master"] as const) {
    assert.notEqual(observed, expected); sourceObserved = place === "source" ? observed! : expected; masterObserved = place === "final-master" ? observed! : expected;
    const got = await invoke(store); assert.match(String(got.error), /WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED/); assert.match(String(got.error), new RegExp(place)); assert.equal(got.sentinelCalls, 0); assert.equal(got.audit, undefined);
    assert.ok(got.logs.some((line) => line.includes("worked-example-critical-speech-failure/v1") && line.includes('"verdict":"hold"')), "bounded actual failure evidence retained in structured log");
    assert.equal(got.reviewerCalls, 1, "existing fresh QA visual review precedes transcript checks; do not claim pre-spend refusal here");
    results.push({ name, place, arithmeticHeld: true, transcriptCalls: got.transcriptCalls, reviewerCalls: got.reviewerCalls });
  }
  sourceObserved = expected; masterObserved = expected;
  timestampText = expected.replace("seventy eight", "seventy seven"); // Same count; real receipt-shape validator must accept before the independent meaning check refuses.
  for (const scope of ["source", "final-master"] as const) {
    timestampScope = scope;
    const wordMismatch = await invoke(store); assert.match(String(wordMismatch.error), new RegExp(`${scope}.*critical arithmetic meaning differs`)); assert.equal(wordMismatch.transcriptCalls, scope === "source" ? 1 : 2);
  }
  timestampText = undefined;
  results.push({ name: "segment-text-correct-timestamp-words-wrong-both-scopes", arithmeticHeld: true });
  const chapterText = [draft.script.hook, ...draft.script.sections.map((section, index) => `${index > 0 && index < draft.script.sections.length - 1 ? `Chapter ${index}: ${section.heading}. ` : ""}${section.narration}`)].join(" ");
  const chapterStore: Record<string, unknown> = { ...store, narrationTranscriptText: chapterText, sentenceTimings: [{ text: chapterText, start: 0, end: duration }] };
  chapterStore.workedExampleAudioBinding = createWorkedExampleAudioBinding({ ...scope, params: { chapterCards: true }, store: chapterStore }, chapterStore, [chapterText], readFileSync(sourcePath));
  sourceObserved = chapterText; masterObserved = chapterText;
  const chapter = await invoke(chapterStore, { ...params, chapterCards: true }); assert.equal(chapter.error, sentinel, String(chapter.error)); assert.ok(chapter.audit?.audit.workedExampleCriticalSpeech);
  for (const place of ["source", "final-master"] as const) {
    sourceObserved = place === "source" ? chapterText.replace("Chapter 1", "Chapter 2") : chapterText;
    masterObserved = place === "final-master" ? chapterText.replace("Chapter 1", "Chapter 2") : chapterText;
    const changed = await invoke(chapterStore, { ...params, chapterCards: true }); assert.match(String(changed.error), /WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED/); assert.match(String(changed.error), new RegExp(place));
  }
  results.push({ name: "chapter-headings-good-and-reordered-both-scopes", passed: true });
  // Retain a grouped numeral observation with the actual worker's lexical count.
  // A single Whisper timestamp token for 2,157 has a pre-existing token-count incompatibility.
  let groupedSeed: Record<string, unknown> | undefined, groupedExpected = "", groupedObserved = "";
  for (let n = 0; n < 50 && !groupedSeed; n++) {
    const req = { ...request, seed: `grouped-${n}`, operations: ["multiply", "multiply", "add", "exact_divide"] }, prep = prepareWorkedExample(req);
    if (Math.abs(Number(prep.derivation.answer)) < 1000) continue;
    const drafted = draftWorkedExampleNarration(prep, req);
    groupedExpected = drafted.narrationText; groupedObserved = groupedExpected.replace(prep.projection.answerSpeech, `The answer is ${Number(prep.derivation.answer) < 0 ? "negative " : ""}${Math.abs(Number(prep.derivation.answer)).toLocaleString("en-US")}.`);
    groupedSeed = { ...store, workedExampleRequest: req, workedExamplePreparation: prep, script: drafted.script, narrationText: groupedExpected,
      workedExampleEditorialApproval: workedExampleEditorialApprovalFor(drafted.script), narrationTranscriptText: groupedExpected,
      sentenceTimings: [{ text: groupedExpected, start: 0, end: duration }] };
    groupedSeed.workedExampleAudioBinding = createWorkedExampleAudioBinding({ ...scope, params: {}, store: groupedSeed }, groupedSeed, [groupedExpected], readFileSync(sourcePath));
  }
  assert.ok(groupedSeed); assert.notEqual(groupedExpected, groupedObserved); assert.deepEqual(parseWorkedExampleSpeech(groupedObserved), parseWorkedExampleSpeech(groupedExpected));
  sourceObserved = groupedObserved; masterObserved = groupedExpected; rawTimestampWords = true;
  const grouped = await invoke(groupedSeed); assert.match(String(grouped.error), /transcript word count does not match its timestamped words/); assert.equal(grouped.transcriptCalls, 1); rawTimestampWords = false;
  results.push({ name: "equivalent-grouped-numeral-single-ASR-token", arithmeticParserEquivalent: true, existingSharedReceiptHeld: true, reason: String(grouped.error) });
  sourceObserved = expected; masterObserved = expected;
  for (const change of ["draft", "missing-approval", "missing-audio-binding"]) {
    const seed = structuredClone(store); if (change === "missing-approval") delete seed.workedExampleEditorialApproval; if (change === "missing-audio-binding") delete seed.workedExampleAudioBinding;
    const got = await invoke(seed, change === "draft" ? { ...params, qaProfile: "draft" } : params);
    assert.match(String(got.error), /WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED/); assert.equal(got.transcriptCalls, 0); assert.equal(got.reviewerCalls, 0);
  }
  const ordinary = structuredClone(store);
  for (const key of ["workedExampleRequest", "workedExamplePreparation", "workedExampleAudioBinding", "workedExampleEditorialApproval"]) delete ordinary[key];
  ordinary.script = { hook: draft.script.hook, sections: draft.script.sections, narrationText: expected, estDurationSec: draft.script.estDurationSec };
  const ordinaryResult = await invoke(ordinary); assert.equal(ordinaryResult.error, sentinel); assert.ok(ordinaryResult.audit); assert.equal(ordinaryResult.audit.audit.workedExampleCriticalSpeech, undefined);
  assert.equal(ordinaryResult.audit.bytes.toString(), canonicalJson(ordinaryResult.audit.audit));
  if (process.env.ARITHMETIC_SPEECH_PARITY_SOURCE) {
    const before = await invoke(ordinary, params, actualBlock(process.env.ARITHMETIC_SPEECH_PARITY_SOURCE));
    assert.equal(before.error, sentinel); assert.ok(before.audit); assert.deepEqual(before.audit.bytes, ordinaryResult.audit.bytes); assert.equal(before.transcriptCalls, ordinaryResult.transcriptCalls); assert.equal(before.reviewerCalls, ordinaryResult.reviewerCalls);
  }
  results.push({ name: "ordinary-current-and-frozen-before", unchangedAuditBytes: true, exactBeforeParity: Boolean(process.env.ARITHMETIC_SPEECH_PARITY_SOURCE) });
  console.log(JSON.stringify({ actualFreshQaControls: results }, null, 2));
}
async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("all network forbidden"); };
  try {
    const block = actualBlock(process.env.ARITHMETIC_SPEECH_BASELINE_SOURCE ?? join(repo, "src/trigger/blocks/narratedBlocks.ts"));
    const cases = [["unchanged", expected], ["wrong-final-answer", expected.replace(prepared.projection.answerSpeech, "The answer is seven.")], ["duplicate-negative", expected.replace("The answer is ", "The answer is negative ")]] as const;
    const results: unknown[] = [];
    let goodAudit: ReturnType<typeof transcript.prepareFinalMasterNarrationTranscriptAudit> | undefined;
    for (const [name, observed] of cases) for (const place of ["source", "final-master"] as const) {
      sourceObserved = place === "source" ? observed : expected; masterObserved = place === "final-master" ? observed : expected;
      audits = []; transcriptCalls = 0; reviewerCalls = 0; sentinelCalls = 0; logs.length = 0;
      let failure: unknown;
      try { await block.run({ ...scope, params, store, budgetUsd: 100, stageBudgetUsd: 100, log: (message) => logs.push(message) } as StageContext); } catch (error) { failure = error; }
      const before = Boolean(process.env.ARITHMETIC_SPEECH_EXPECT_BEFORE);
      if (before || name === "unchanged") {
        assert.equal(failure, sentinel, String(failure)); assert.equal(audits.length, 1, logs.join("\n")); assert.equal(transcriptCalls, 2); assert.equal(sentinelCalls, 1);
        if (name !== "unchanged") assert.ok(logs.some((line) => line.includes("cue timing") && line.includes("source words aligned")), "before oracle must retain the actual old cue-gate acceptance");
      } else {
        assert.match(String(failure), /WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED/); assert.match(String(failure), new RegExp(place)); assert.equal(audits.length, 0); assert.equal(sentinelCalls, 0);
        assert.equal(transcriptCalls, place === "source" ? 1 : 2);
      }
      results.push({ name, place, transcriptCalls, reviewerCalls, sentinelCalls, audited: audits.length, failure: String(failure), logs: [...logs] });
      if (name === "unchanged") for (const audit of audits) writeFileSync(join(root, `good-${place}-audit.json`), audit.bytes);
      if (name === "unchanged") goodAudit = audits[0];
    }
    if (!process.env.ARITHMETIC_SPEECH_EXPECT_BEFORE) { assert.ok(goodAudit); await cacheCases(block, goodAudit); await freshControls(block); }
    assert.equal(writes, 0);
    console.log(JSON.stringify({ root, before: Boolean(process.env.ARITHMETIC_SPEECH_EXPECT_BEFORE), sourceSha256: hash(readFileSync(process.env.ARITHMETIC_SPEECH_BASELINE_SOURCE ?? join(repo, "src/trigger/blocks/narratedBlocks.ts"))), results, liveProviders: 0 }, null, 2));
  } finally { globalThis.fetch = originalFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
