/** Additional held arithmetic evidence. ASR is fallible; this is not pronunciation certification. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import type { NarrationTranscriptProof } from "@/lib/narrationTranscriptProof";
import { assertWorkedExamplePreparation, WORKED_EXAMPLE_LIMITS } from "./workedExample";
import { assertWorkedExampleNarrationBinding, assertWorkedExampleEditorialApproval, workedExampleEditorialApprovalFor } from "./workedExampleNarration";
import { WorkedExampleAudioBindingSchema } from "./workedExampleAudioBinding";
import { ExecutionError } from "./executionErrors";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fingerprint = (value: unknown) => hash(canonicalJson(value));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.string().max(14).regex(/^(?:0|-?[1-9][0-9]*)$/);
const operation = z.enum(["add", "subtract", "multiply", "exact_divide"]);
type Operation = z.infer<typeof operation>;
const term = z.union([z.object({ integer }).strict(), z.object({ operation }).strict()]);
const event = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("problem"), postfix: z.array(term).min(3).max(31) }).strict(),
  z.object({ kind: z.literal("heading"), chapter: z.number().int().min(1).max(18), step: z.number().int().min(1).max(8) }).strict(),
  z.object({ kind: z.literal("step"), step: z.number().int().min(1).max(8), left: integer, operation, right: integer, result: integer }).strict(),
  z.object({ kind: z.literal("answer"), value: integer }).strict(),
]);
const meaning = z.array(event).min(3).max(18);
export type WorkedExampleSpeechEvent = z.infer<typeof event>;
const observation = z.object({
  sourceSha256: sha, sourceByteLength: z.number().int().positive(), proofSha256: sha,
  expectedTextSha256: sha, transcriptTextSha256: sha, timestampWordsSha256: sha,
  meaning,
}).strict();
const ReportShape = z.object({
  version: z.literal("worked-example-critical-speech/en-integer-v1"),
  inputs: z.object({ requestFingerprint: sha, preparationFingerprint: sha, scriptFingerprint: sha,
    audioBindingFingerprint: sha, spokenSequenceFingerprint: sha, qaInputsFingerprint: sha }).strict(),
  expectedMeaning: meaning, source: observation, finalMaster: observation, reportFingerprint: sha,
}).strict();
export type WorkedExampleSpeechReport = z.infer<typeof ReportShape>;

function calculate(left: bigint, op: Operation, right: bigint): bigint {
  if (op === "exact_divide" && (right === BigInt(0) || left % right !== BigInt(0))) throw new Error("division is not a supported exact integer operation");
  const value = op === "add" ? left + right : op === "subtract" ? left - right : op === "multiply" ? left * right : left / right;
  if (value > BigInt(WORKED_EXAMPLE_LIMITS.resultMagnitude) || value < -BigInt(WORKED_EXAMPLE_LIMITS.resultMagnitude)) throw new Error("integer magnitude exceeds supported domain");
  return value;
}

/** Replay meaning, not merely report.pass or its public fingerprint. */
function assertMeaning(events: WorkedExampleSpeechEvent[]): void {
  if (events[0]?.kind !== "problem" || events.at(-1)?.kind !== "answer") throw new Error("problem/answer boundaries missing");
  const stack: bigint[] = [], expectedSteps: Array<{ left: string; operation: Operation; right: string; result: string }> = [];
  for (const item of events[0].postfix) {
    if ("integer" in item) {
      const literal = BigInt(item.integer);
      if (literal > BigInt(WORKED_EXAMPLE_LIMITS.literalMagnitude) || literal < -BigInt(WORKED_EXAMPLE_LIMITS.literalMagnitude)) throw new Error("problem literal exceeds supported domain");
      stack.push(literal); continue;
    }
    const right = stack.pop(), left = stack.pop();
    if (left === undefined || right === undefined) throw new Error("unbound problem operand");
    const result = calculate(left, item.operation, right);
    expectedSteps.push({ left: String(left), operation: item.operation, right: String(right), result: String(result) }); stack.push(result);
  }
  if (stack.length !== 1 || expectedSteps.length < 1 || expectedSteps.length > 8) throw new Error("malformed problem expression");
  let step = 0, chapter = 0;
  const hasHeadings = events.some((item) => item.kind === "heading");
  for (let index = 1; index < events.length - 1; index++) {
    const item = events[index]!;
    if (item.kind === "heading") {
      const next = events[index + 1];
      if (++chapter !== item.chapter || next?.kind !== "step" || item.step !== next.step || (expectedSteps.length >= 2 && item.step === 1)) throw new Error("changed, misplaced or repeated chapter heading");
      continue;
    }
    if (item.kind !== "step" || item.step !== ++step) throw new Error("missing, repeated or reordered step");
    const { kind: _kind, step: _step, ...observed } = item; void _kind; void _step;
    if (canonicalJson(observed) !== canonicalJson(expectedSteps[step - 1])) throw new Error(`step ${step} operand, operator, sign or result differs from problem`);
    if (hasHeadings && (expectedSteps.length === 1 || step > 1) && events[index - 1]?.kind !== "heading") throw new Error("expected spoken chapter heading missing");
  }
  const answer = events.at(-1)!;
  if (step !== expectedSteps.length || answer.kind !== "answer" || answer.value !== String(stack[0])) throw new Error("missing step or incorrect final answer");
}

export const WorkedExampleSpeechReportSchema = ReportShape.superRefine((report, ctx) => {
  try {
    assertMeaning(report.expectedMeaning); assertMeaning(report.source.meaning); assertMeaning(report.finalMaster.meaning);
    if (canonicalJson(report.expectedMeaning) !== canonicalJson(report.source.meaning) || canonicalJson(report.expectedMeaning) !== canonicalJson(report.finalMaster.meaning)) throw new Error("source/master critical meaning differs from independent expectation");
    const { reportFingerprint, ...body } = report;
    if (reportFingerprint !== fingerprint(body)) throw new Error("arithmetic speech report fingerprint mismatch");
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(error) }); }
});

const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const scales = new Map([["thousand", 1000], ["million", 1_000_000], ["billion", 1_000_000_000], ["trillion", 1_000_000_000_000]]);
const numberWords = new Set([...small, ...tens, ...scales.keys(), "hundred", "and"]);
function group(words: string[]): number {
  let total = 0;
  if (words.length >= 2 && small.indexOf(words[0]!) >= 1 && small.indexOf(words[0]!) <= 9 && words[1] === "hundred") {
    total = small.indexOf(words[0]!) * 100; words = words.slice(2);
    if (words[0] === "and") { words = words.slice(1); if (!words.length) throw new Error("dangling number conjunction"); }
    if (!words.length) return total;
  }
  let remainder: number;
  if (words.length === 1 && small.includes(words[0]!)) remainder = small.indexOf(words[0]!);
  else if ((words.length === 1 || words.length === 2) && tens.includes(words[0]!)) {
    remainder = (tens.indexOf(words[0]!) + 2) * 10;
    if (words.length === 2) {
      const ones = small.indexOf(words[1]!); if (ones < 1 || ones > 9) throw new Error("malformed tens group"); remainder += ones;
    }
  } else throw new Error("unsupported or ambiguous written integer");
  if (total && remainder === 0) throw new Error("noncanonical trailing zero");
  return total + remainder;
}
function writtenInteger(words: string[]): bigint {
  let result = BigInt(0), start = 0, previousScale = Infinity;
  for (let index = 0; index < words.length; index++) {
    const scale = scales.get(words[index]!); if (!scale) continue;
    if (scale >= previousScale) throw new Error("repeated or out-of-order integer scale");
    const coefficient = group(words.slice(start, index)); if (coefficient === 0) throw new Error("zero scale coefficient");
    result += BigInt(coefficient) * BigInt(scale); previousScale = scale; start = index + 1;
  }
  let tail = words.slice(start);
  if (start && tail[0] === "and") { tail = tail.slice(1); if (!tail.length) throw new Error("dangling number conjunction"); }
  if (tail.length) { const remainder = group(tail); if (start && remainder === 0) throw new Error("noncanonical trailing zero"); result += BigInt(remainder); }
  else if (!start) throw new Error("missing integer");
  if (result > BigInt(WORKED_EXAMPLE_LIMITS.resultMagnitude)) throw new Error("integer magnitude exceeds supported domain");
  return result;
}

/** Closed lexer: punctuation may delimit words; it must never erase fractions, decimals or extra signs. */
function tokens(text: string): string[] {
  if (typeof text !== "string" || !text.trim() || text.length > 24_000) throw new Error("missing or oversized arithmetic transcript");
  const value = text.toLowerCase(), result: string[] = [];
  for (let index = 0; index < value.length;) {
    const char = value[index]!;
    if (/\s/.test(char)) { index++; continue; }
    const rest = value.slice(index), word = rest.match(/^[a-z]+/);
    if (word) { result.push(word[0]); index += word[0].length; if (/\d/.test(value[index] ?? "")) throw new Error("unseparated word and numeral"); continue; }
    const digits = rest.match(/^\d+(?:,\d+)*/);
    if (digits) {
      const raw = digits[0];
      if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(raw) || raw.replaceAll(",", "").length > 13) throw new Error("malformed grouped integer");
      index += raw.length;
      if (/[a-z]/.test(value[index] ?? "") || value[index] === "." && /\d/.test(value[index + 1] ?? "")) throw new Error("fractional/exponent or mixed numeral is unsupported");
      result.push(raw.replaceAll(",", "")); continue;
    }
    if (char === "-" && /[a-z]/.test(value[index - 1] ?? "") && /[a-z]/.test(value[index + 1] ?? "")) { index++; continue; }
    if (char === "." && /\d/.test(value[index + 1] ?? "")) throw new Error("leading fractional numeral is unsupported");
    if (".,:;!?".includes(char)) { index++; continue; }
    if ("()+-=×*÷/−".includes(char)) { result.push(char === "−" ? "-" : char); index++; continue; }
    throw new Error(`unsupported arithmetic transcript character at ${index}`);
  }
  if (result.length > 4096) throw new Error("arithmetic token limit exceeded");
  return result;
}

/** Parse the complete tiny language. Unknown words are not dropped to improve a match. */
export function parseWorkedExampleSpeech(text: string): WorkedExampleSpeechEvent[] {
  const words = tokens(text); let at = 0;
  const take = (word: string) => { if (words[at++] !== word) throw new Error(`expected ${word} at token ${at}`); };
  const indexNumber = (maximum: number) => {
    const word = words[at++]!, value = /^\d+$/.test(word) ? Number(word) : small.indexOf(word);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error("unsupported step/chapter index"); return value;
  };
  const number = (): string => {
    let sign = 1;
    if (["negative", "minus", "-", "positive", "+"].includes(words[at]!)) { if (["negative", "minus", "-"].includes(words[at]!)) sign = -1; at++; }
    let value: bigint;
    if (/^\d+$/.test(words[at] ?? "")) value = BigInt(words[at++]!);
    else { const start = at; while (numberWords.has(words[at]!)) at++; value = writtenInteger(words.slice(start, at)); }
    if (value > BigInt(WORKED_EXAMPLE_LIMITS.resultMagnitude) || sign < 0 && value === BigInt(0)) throw new Error("unsupported magnitude or negative zero");
    return String(sign < 0 ? -value : value);
  };
  const op = (): Operation => {
    const word = words[at++];
    if (word === "plus" || word === "+") return "add";
    if (word === "minus" || word === "-") return "subtract";
    if (["times", "×", "*"].includes(word!)) return "multiply";
    if (word === "divided") { take("by"); return "exact_divide"; }
    if (word === "÷" || word === "/") return "exact_divide";
    throw new Error("missing or unsupported arithmetic operator");
  };
  let nodeCount = 0;
  const expression = (depth = 0): z.infer<typeof term>[] => {
    if (++nodeCount > 31 || depth > 8) throw new Error("problem expression limit exceeded");
    const opened = words[at] === "open" || words[at] === "(";
    if (!opened) return [{ integer: number() }];
    if (words[at] === "(") at++; else { take("open"); take("parenthesis"); }
    const left = expression(depth + 1), operation = op(), right = expression(depth + 1);
    if (words[at] === ")") at++; else { take("close"); take("parenthesis"); }
    return [...left, ...right, { operation }];
  };
  take("calculate"); const events: WorkedExampleSpeechEvent[] = [{ kind: "problem", postfix: expression() }];
  while (words[at] === "chapter" || words[at] === "step") {
    if (events.length > 16) throw new Error("critical event limit exceeded");
    if (words[at] === "chapter") { at++; const chapter = indexNumber(18); take("step"); events.push({ kind: "heading", chapter, step: indexNumber(8) }); }
    else {
      at++; const step = indexNumber(8), left = number(), operation = op(), right = number();
      if (words[at] === "=") at++; else take("equals");
      events.push({ kind: "step", step, left, operation, right, result: number() });
    }
  }
  take("the"); take("answer"); take("is"); events.push({ kind: "answer", value: number() });
  if (at !== words.length) throw new Error("unbound extra arithmetic speech");
  return meaning.parse(events);
}

type Context = { ownerId: string; channelId: string; runId: string; keyPrefix: string; params: Readonly<Record<string, unknown>>; store: Readonly<Record<string, unknown>> };
export type WorkedExampleSpeechAdmission = { inputs: WorkedExampleSpeechReport["inputs"]; expectedMeaning: WorkedExampleSpeechEvent[];
  expectedTextSha256: string; source: { key: string; sha256: string; byteLength: number } };

/** Current independent expectations, not a transcript-derived problem. Any arithmetic marker requires the entire handoff. */
export function prepareWorkedExampleSpeechAdmission(ctx: Context): WorkedExampleSpeechAdmission | undefined {
  const script = assertWorkedExampleNarrationBinding({ request: ctx.store.workedExampleRequest, preparation: ctx.store.workedExamplePreparation,
    script: ctx.store.script, narrationText: ctx.store.narrationText, ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId });
  if (!script && ctx.store.workedExampleAudioBinding === undefined) return;
  if (!script) throw new Error("arithmetic speech binding has no current verified script");
  if (ctx.params.qaProfile === "draft") throw new Error("held arithmetic requires the existing source and final-master production transcript proofs");
  const prepared = assertWorkedExamplePreparation(ctx.store.workedExamplePreparation, ctx.store.workedExampleRequest);
  if (ctx.store.scriptApproved !== true) throw new Error("arithmetic speech requires current independent script approval");
  assertWorkedExampleEditorialApproval(ctx.store.workedExampleEditorialApproval, script);
  const binding = WorkedExampleAudioBindingSchema.parse(ctx.store.workedExampleAudioBinding);
  const editorial = workedExampleEditorialApprovalFor(script);
  if (binding.preparationFingerprint !== prepared.fingerprint || binding.scriptFingerprint !== editorial.scriptFingerprint) throw new Error("arithmetic speech source differs from current prepared script");
  if (binding.artifact.key !== ctx.store.narrationKey || binding.artifact.key !== `${ctx.keyPrefix}runs/${ctx.runId}/narration.mp3`) throw new Error("arithmetic speech source key/namespace mismatch");
  const timing = { narrationDurationSec: ctx.store.narrationDurationSec, narrationTranscriptText: ctx.store.narrationTranscriptText,
    narrationPerformanceEvidence: ctx.store.narrationPerformanceEvidence, sentenceTimings: ctx.store.sentenceTimings, chapterPlan: ctx.store.chapterPlan };
  if (typeof timing.narrationDurationSec !== "number" || !Number.isFinite(timing.narrationDurationSec) || timing.narrationDurationSec < 1.5 || fingerprint(timing) !== binding.timingFingerprint) throw new Error("current arithmetic source timing differs from fresh completion");
  const expectedMeaning = parseWorkedExampleSpeech(binding.spokenSequence.join(" "));
  assertMeaning(expectedMeaning);
  const ordinaryMeaning = parseWorkedExampleSpeech(script.narrationText);
  if (canonicalJson(expectedMeaning.filter((item) => item.kind !== "heading")) !== canonicalJson(ordinaryMeaning)) throw new Error("submitted speech differs from independently verified derivation");
  if (typeof ctx.store.narrationTranscriptText !== "string" || canonicalJson(parseWorkedExampleSpeech(ctx.store.narrationTranscriptText)) !== canonicalJson(expectedMeaning)) throw new Error("current transcript source differs from submitted arithmetic speech");
  return { inputs: { requestFingerprint: prepared.requestFingerprint, preparationFingerprint: prepared.fingerprint, scriptFingerprint: editorial.scriptFingerprint,
    audioBindingFingerprint: fingerprint(binding), spokenSequenceFingerprint: fingerprint(binding.spokenSequence),
    qaInputsFingerprint: fingerprint({ params: ctx.params, videoKey: ctx.store.videoKey, videoDurationSec: ctx.store.videoDurationSec,
      narrationStartSec: ctx.store.narrationStartSec, introApplied: ctx.store.introApplied, introSec: ctx.store.introSec }) },
    expectedMeaning, expectedTextSha256: hash(ctx.store.narrationTranscriptText.trim()), source: binding.artifact };
}

export function assertWorkedExampleSpeechProof(admission: WorkedExampleSpeechAdmission, proof: NarrationTranscriptProof, scope: "source" | "final-master", sourceSha256: string): WorkedExampleSpeechReport["source"] {
  if (!proof || proof.source?.sha256 !== sourceSha256 || !Number.isSafeInteger(proof.source.byteLength) || proof.source.byteLength <= 0 || proof.expected?.textSha256 !== admission.expectedTextSha256) throw new Error(`${scope} transcript identity does not match current arithmetic audio/script`);
  if (scope === "source" && (sourceSha256 !== admission.source.sha256 || proof.source.byteLength !== admission.source.byteLength)) throw new Error("source transcript bytes do not match actual fresh audio binding");
  const parsed = parseWorkedExampleSpeech(proof.transcript?.text);
  const words = proof.transcript?.words;
  if (!Array.isArray(words) || words.length < 1 || words.length > 4096 || words.some((word) => typeof word?.text !== "string")) throw new Error(`${scope} timestamped transcript is missing or oversized`);
  const timestampMeaning = parseWorkedExampleSpeech(words.map((word) => word.text).join(" "));
  if (canonicalJson(parsed) !== canonicalJson(admission.expectedMeaning) || canonicalJson(timestampMeaning) !== canonicalJson(admission.expectedMeaning)) throw new Error(`${scope} critical arithmetic meaning differs (ordered operand/operator/sign/result/answer or heading)`);
  assertMeaning(parsed);
  return { sourceSha256, sourceByteLength: proof.source.byteLength, proofSha256: fingerprint(proof), expectedTextSha256: proof.expected.textSha256,
    transcriptTextSha256: hash(proof.transcript.text), timestampWordsSha256: fingerprint(words), meaning: parsed };
}

export function createWorkedExampleSpeechReport(admission: WorkedExampleSpeechAdmission, source: NarrationTranscriptProof, finalMaster: NarrationTranscriptProof, finalMasterSha256: string): WorkedExampleSpeechReport {
  const body = { version: "worked-example-critical-speech/en-integer-v1" as const, inputs: admission.inputs, expectedMeaning: admission.expectedMeaning,
    source: assertWorkedExampleSpeechProof(admission, source, "source", admission.source.sha256),
    finalMaster: assertWorkedExampleSpeechProof(admission, finalMaster, "final-master", finalMasterSha256) };
  return WorkedExampleSpeechReportSchema.parse({ ...body, reportFingerprint: fingerprint(body) });
}

/** Rebind compact cached evidence to current independent inputs; no ASR or generation is authorized. */
export function assertWorkedExampleSpeechReportCurrent(value: unknown, admission: WorkedExampleSpeechAdmission, finalMasterSha256: string): WorkedExampleSpeechReport {
  const report = WorkedExampleSpeechReportSchema.parse(value);
  if (canonicalJson(report.inputs) !== canonicalJson(admission.inputs) || canonicalJson(report.expectedMeaning) !== canonicalJson(admission.expectedMeaning)) throw new Error("cached arithmetic speech report has different current inputs");
  if (report.source.sourceSha256 !== admission.source.sha256 || report.source.sourceByteLength !== admission.source.byteLength || report.finalMaster.sourceSha256 !== finalMasterSha256 || report.source.expectedTextSha256 !== admission.expectedTextSha256 || report.finalMaster.expectedTextSha256 !== admission.expectedTextSha256) throw new Error("cached arithmetic speech source/master/script identity mismatch");
  return report;
}

/** The existing full audit must actually carry the exact proofs summarized by this report. */
export function assertWorkedExampleSpeechAuditBinding(value: unknown, source: NarrationTranscriptProof, finalMaster: NarrationTranscriptProof): void {
  const report = WorkedExampleSpeechReportSchema.parse(value);
  for (const [observation, proof] of [[report.source, source], [report.finalMaster, finalMaster]] as const) {
    if (observation.proofSha256 !== fingerprint(proof) || observation.sourceSha256 !== proof.source.sha256 || observation.sourceByteLength !== proof.source.byteLength || observation.expectedTextSha256 !== proof.expected.textSha256 || observation.transcriptTextSha256 !== hash(proof.transcript.text) || observation.timestampWordsSha256 !== fingerprint(proof.transcript.words) || canonicalJson(observation.meaning) !== canonicalJson(parseWorkedExampleSpeech(proof.transcript.text)) || canonicalJson(observation.meaning) !== canonicalJson(parseWorkedExampleSpeech(proof.transcript.words.map((word) => word.text).join(" ")))) throw new Error("arithmetic audit report is not bound to its retained full transcript proofs");
  }
}

/** Local content identity only; no assertion that a mutable remote object still has these bytes. */
export async function assertWorkedExampleSpeechFile(path: unknown, expected: { sourceSha256: string; sourceByteLength: number }): Promise<void> {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("arithmetic speech evidence requires materialized absolute local bytes");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== expected.sourceByteLength) throw new Error("arithmetic speech evidence file type/length differs");
    const sha256 = createHash("sha256"); let length = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) { sha256.update(chunk); length += chunk.length; }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || length !== expected.sourceByteLength || sha256.digest("hex") !== expected.sourceSha256) throw new Error("arithmetic speech evidence bytes changed or differ");
  } finally { await file.close(); }
}

/** Bounded failure evidence in the existing structured run log; never a passing receipt. */
export function workedExampleSpeechFailureEvidence(admission: WorkedExampleSpeechAdmission, proof: NarrationTranscriptProof, scope: string) {
  let observedMeaning: WorkedExampleSpeechEvent[] | undefined;
  try { observedMeaning = parseWorkedExampleSpeech(proof.transcript.text); } catch { /* Unsupported ASR remains explicitly unparsed. */ }
  const body = { version: "worked-example-critical-speech-failure/v1", verdict: "hold", scope, inputs: admission.inputs,
    expectedMeaning: admission.expectedMeaning, observedMeaning, sourceSha256: proof.source.sha256, proofSha256: fingerprint(proof) };
  return { ...body, fingerprint: fingerprint(body) };
}

/** Existing reconciliation marker also keeps the result-based healer from repurchasing speech. */
export function workedExampleSpeechRefusal(error: unknown, scope: string): ExecutionError {
  if (error instanceof ExecutionError && error.code === "WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED") return error;
  return new ExecutionError(`PAID_STAGE_RECONCILIATION_REQUIRED: WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED (${scope}): ${error instanceof Error ? error.message : String(error)}; retain paid speech for manual review, never automatically regenerate`,
    { code: "WORKED_EXAMPLE_CRITICAL_SPEECH_REFUSED", retryable: false, phase: scope });
}
