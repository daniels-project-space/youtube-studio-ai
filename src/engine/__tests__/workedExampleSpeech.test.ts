import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { prepareWorkedExample } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { createWorkedExampleAudioBinding } from "@/engine/workedExampleAudioBinding";
import { parseWorkedExampleSpeech, prepareWorkedExampleSpeechAdmission, createWorkedExampleSpeechReport,
  WorkedExampleSpeechReportSchema, assertWorkedExampleSpeechReportCurrent, assertWorkedExampleSpeechAuditBinding,
  type WorkedExampleSpeechEvent } from "@/engine/workedExampleSpeech";
import { prepareFinalMasterNarrationTranscriptAudit, assertFinalMasterNarrationTranscriptAudit, type NarrationTranscriptProof } from "@/lib/narrationTranscriptProof";

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex"), fp = (v: unknown) => hash(canonicalJson(v));
const sourceBytes = Buffer.from("explicit synthetic identity, not speech evidence"), masterBytes = Buffer.from("explicit synthetic master");
const scope = { ownerId: "owner-a", channelId: "channel-a", runId: "run-a", keyPrefix: "owners/owner-a/" };
function fixture(seed: string, operations = ["subtract", "multiply", "add", "exact_divide"], chapter = false) {
  const request = { ...scope, policy: "worked-example/integer-v1", requestId: "critical-speech", seed, operations };
  const { keyPrefix: _keyPrefix, ...cleanRequest } = request; void _keyPrefix;
  const prepared = prepareWorkedExample(cleanRequest), draft = draftWorkedExampleNarration(prepared, cleanRequest);
  const sections = [draft.script.hook, ...draft.script.sections.map((section, index) => `${chapter && (draft.script.sections.length < 3 || index > 0 && index < draft.script.sections.length - 1) && section.role === "body" ? `Chapter ${draft.script.sections.length < 3 ? 1 : index}: ${section.heading}. ` : ""}${section.narration}`)];
  const spoken = chapter ? sections.join(" ") : draft.narrationText;
  const store: Record<string, unknown> = { workedExampleRequest: cleanRequest, workedExamplePreparation: prepared, script: draft.script,
    narrationText: draft.narrationText, scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script),
    narrationKey: `${scope.keyPrefix}runs/${scope.runId}/narration.mp3`, narrationDurationSec: 100, narrationTranscriptText: spoken,
    sentenceTimings: [{ text: spoken, start: 0, end: 100 }], videoKey: "current-master", videoDurationSec: 100 };
  store.workedExampleAudioBinding = createWorkedExampleAudioBinding({ ...scope, params: {}, store }, store, [spoken], sourceBytes);
  const ctx = { ...scope, params: {}, store }, admission = prepareWorkedExampleSpeechAdmission(ctx)!;
  return { prepared, draft, spoken, ctx, admission };
}
function proof(expected: string, observed = expected, master = false): NarrationTranscriptProof {
  const words = observed.split(/\s+/).map((text, index) => ({ text, startMs: index * 100, endMs: index * 100 + 90 }));
  return { schemaVersion: "narration-transcript-proof/v1", provider: "faster-whisper",
    model: { id: "Systran/faster-whisper-small.en", revision: "d1d751a5f8271d482d14ca55d9e2deeebbae577f", packageVersion: "1.2.1", computeType: "int8-cpu" },
    source: { sha256: hash(master ? masterBytes : sourceBytes), byteLength: (master ? masterBytes : sourceBytes).length },
    expected: { textSha256: hash(expected), wordCount: expected.split(/\s+/).length }, transcript: { text: observed, wordCount: words.length, words },
    assessment: { wordErrorRate: 0, lexicalRecall: 1, missingNumericTerms: [], thresholds: { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 }, passed: true } };
}
const operators = { add: "+", subtract: "-", multiply: "×", exact_divide: "÷" };
/** Independent numeral projection of semantic events tests notation, not a successful answer supplied to generation. */
function digits(events: WorkedExampleSpeechEvent[]) {
  return events.map((event) => {
    if (event.kind === "problem") {
      const stack: string[] = [];
      for (const node of event.postfix) {
        if ("integer" in node) stack.push(node.integer);
        else { const right = stack.pop(), left = stack.pop(); stack.push(`(${left} ${operators[node.operation]} ${right})`); }
      }
      return `Calculate ${stack[0]}.`;
    }
    if (event.kind === "heading") return `Chapter ${event.chapter}: Step ${event.step}.`;
    if (event.kind === "step") return `Step ${event.step}. ${event.left} ${operators[event.operation]} ${event.right} = ${event.result}.`;
    return `The answer is ${event.value}.`;
  }).join(" ");
}
let good = 0, mutations = 0;
for (let index = 0; index < 256; index++) {
  const ops = ["add", "subtract", "multiply", "exact_divide"];
  const example = fixture(`independent-critical-${index}`, Array.from({ length: index % 8 + 1 }, (_, n) => ops[(index + n) % 4]!), index % 2 === 0);
  const source = proof(example.spoken), final = proof(example.spoken, example.spoken, true);
  const report = createWorkedExampleSpeechReport(example.admission, source, final, hash(masterBytes)); good++;
  assert.deepEqual(parseWorkedExampleSpeech(digits(report.expectedMeaning)), report.expectedMeaning);
  const numeric = digits(report.expectedMeaning).replace(/\b\d{4,}\b/g, (value) => Number(value).toLocaleString("en-US"));
  assert.deepEqual(parseWorkedExampleSpeech(numeric), report.expectedMeaning);
  assert.equal(report.expectedMeaning.at(-1)?.kind, "answer");
  for (const event of report.expectedMeaning.filter((item) => item.kind === "step")) {
    const changed = structuredClone(report.expectedMeaning);
    const target = changed.find((item) => item.kind === "step" && item.step === event.step)!;
    if (target.kind !== "step") throw new Error("fixture step missing"); target.result = String(BigInt(target.result) + BigInt(1));
    assert.throws(() => createWorkedExampleSpeechReport(example.admission, proof(example.spoken, digits(changed)), final, hash(masterBytes))); mutations++;
  }
  if (index < 8) {
    const wrong = structuredClone(report); const answer = wrong.source.meaning.at(-1)!;
    if (answer.kind !== "answer") throw new Error("fixture answer missing"); answer.value = String(BigInt(answer.value) + BigInt(1));
    const { reportFingerprint: _fp, ...body } = wrong; void _fp; wrong.reportFingerprint = fp(body);
    assert.equal(WorkedExampleSpeechReportSchema.safeParse(wrong).success, false, "rehashed report cannot bless a false answer");
  }
}
const current = fixture("critical-speech-a"), original = current.spoken, source = proof(original), final = proof(original, original, true);
const report = createWorkedExampleSpeechReport(current.admission, source, final, hash(masterBytes));
for (const unsupported of [
  "Calculate (1 ÷ 0). Step 1. 1 ÷ 0 = 0. The answer is 0.",
  "Calculate (5 ÷ 2). Step 1. 5 ÷ 2 = 2. The answer is 2.",
  "Calculate (1000001 + 1). Step 1. 1000001 + 1 = 1000002. The answer is 1000002.",
]) {
  const invalidMeaning = parseWorkedExampleSpeech(unsupported), forged = structuredClone(report);
  forged.expectedMeaning = invalidMeaning; forged.source.meaning = invalidMeaning; forged.finalMaster.meaning = invalidMeaning;
  const { reportFingerprint: _hash, ...body } = forged; void _hash; forged.reportFingerprint = fp(body);
  assert.equal(WorkedExampleSpeechReportSchema.safeParse(forged).success, false, "independent replay refuses unsupported math even with matching/rehashed observations");
}
const changes = [
  original.replace(current.prepared.projection.answerSpeech, "The answer is seven."), original.replace("The answer is ", "The answer is negative "),
  original.replace("negative ", ""), original.replace(" minus ", " plus "), original.replace("Step one.", "Step two."),
  original.replace(/Step one\.[\s\S]*?Step two\./, "Step two."), original + " The answer is seven.",
  original.replace("Calculate", "Maybe calculate"), original.replace(/negative/, "not negative"),
];
for (const bad of changes) {
  assert.notEqual(bad, original);
  assert.throws(() => createWorkedExampleSpeechReport(current.admission, proof(original, bad), final, hash(masterBytes)));
  assert.throws(() => createWorkedExampleSpeechReport(current.admission, source, proof(original, bad, true), hash(masterBytes)));
}
for (const malformed of [".5", "5.5", "1e3", "1,00", "01", "negative negative five", "negative zero", "twenty zero", "one hundred and", "one thousand thousand", "one million zero", "five or six", "NaN", "Infinity", "5/2", "--5", "one point five", "1000000000001"]) {
  assert.throws(() => parseWorkedExampleSpeech(`Calculate (1 + 2). Step 1. 1 + 2 = 3. The answer is ${malformed}.`), malformed);
}
assert.deepEqual(parseWorkedExampleSpeech("Calculate (100 + 21). Step 1. one hundred + twenty-one = one hundred and twenty-one. The answer is 121."), parseWorkedExampleSpeech("Calculate (100 + 21). Step 1. 100 + 21 = 121. The answer is 121."));
for (const key of ["workedExampleRequest", "workedExamplePreparation", "workedExampleEditorialApproval", "workedExampleAudioBinding", "scriptApproved"] as const) {
  const ctx = structuredClone(current.ctx); delete ctx.store[key]; assert.throws(() => prepareWorkedExampleSpeechAdmission(ctx), key);
}
for (const mutate of [
  (ctx: typeof current.ctx) => { ctx.ownerId = "foreign"; },
  (ctx: typeof current.ctx) => { ctx.store.narrationDurationSec = 101; },
  (ctx: typeof current.ctx) => { ctx.store.narrationTranscriptText = original + " seven"; },
]) { const ctx = structuredClone(current.ctx); mutate(ctx); assert.throws(() => prepareWorkedExampleSpeechAdmission(ctx)); }
for (const ctx of [{ ...current.ctx, params: { ttsSpeed: 0.9 } }, { ...current.ctx, store: { ...current.ctx.store, videoKey: "different-master" } }]) {
  assert.throws(() => assertWorkedExampleSpeechReportCurrent(report, prepareWorkedExampleSpeechAdmission(ctx)!, hash(masterBytes)));
}
const auditInput = { version: "final-master-narration-transcript-audit/v1" as const, finalMaster: { sha256: hash(masterBytes), durationSec: 100 }, narration: { sourceSha256: hash(sourceBytes), expectedTextSha256: hash(original), startSec: 0, durationSec: 100 }, sourceTranscript: source, finalMasterTranscript: final };
const ordinary = prepareFinalMasterNarrationTranscriptAudit(auditInput);
assert.equal(ordinary.bytes.toString(), canonicalJson(auditInput), "absent arithmetic extension preserves exact ordinary canonical bytes");
const audit = prepareFinalMasterNarrationTranscriptAudit({ ...auditInput, workedExampleCriticalSpeech: report });
assert.doesNotThrow(() => assertFinalMasterNarrationTranscriptAudit(JSON.parse(audit.bytes.toString())));
const mismatched = structuredClone(source); mismatched.transcript.words[0]!.text = "Maybe";
assert.throws(() => assertWorkedExampleSpeechAuditBinding(report, mismatched, final));
assert.throws(() => assertFinalMasterNarrationTranscriptAudit({ ...audit.audit, sourceTranscript: mismatched }));
console.log(JSON.stringify({ independentlyGeneratedProblems: good, wrongStepMutations: mutations, criticalChangesBothScopes: changes.length * 2, noProviders: true, ordinaryAuditByteParity: true }));
