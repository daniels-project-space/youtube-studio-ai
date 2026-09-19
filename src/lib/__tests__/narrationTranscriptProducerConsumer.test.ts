/**
 * Actual Python receipt producer → actual TS full-receipt consumer.
 * Only Whisper observations/package transport are fixtures, never WER/recall,
 * receipt construction, hashes, timestamp conversion, or either validator.
 * Source bytes are synthetic: this tests contracts, not real ASR quality.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFinalMasterNarrationTranscriptAudit,
  assertNarrationTranscriptProof,
  narrationTranscriptLexicalTokens,
  NARRATION_TRANSCRIPT_MODEL_DIR,
  NARRATION_TRANSCRIPT_PROOF_PYTHON,
  proveNarrationTranscript,
  summarizeNarrationTranscriptProof,
  type NarrationTranscriptProof,
} from "../narrationTranscriptProof";

interface Word { text: string; start: number; end: number }
interface Segment { text: string; words: Word[] }
interface FixtureMetadata { fixtureCalls: { model: number; transcribe: number; network: number } }
const repo = process.cwd();
const evidence = mkdtempSync(join(tmpdir(), "narration-producer-consumer-"));
const fixtureScript = join(repo, "src/lib/__tests__/fixtures/narrationTranscriptWhisperFixture.py");
const producerScript = join(repo, "scripts/narration_transcript_proof.py");
const audioPath = join(evidence, "source-fixture.bin");
const audio = Buffer.from("Local source-byte binding fixture. Not speech and not an ASR audition.");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
writeFileSync(audioPath, audio);
const sourceSha256 = sha(audio);
const before = [producerScript, join(repo, "src/lib/narrationTranscriptProof.ts")].map((path) => sha(readFileSync(path)));
let processCalls = 0;
let transcribeCalls = 0;
let networkCalls = 0;
let caseCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("transcript contract test forbids network"); };

function wordsFor(texts: string[]): Word[] {
  return texts.map((text, index) => ({ text, start: index * 0.12, end: index * 0.12 + 0.09 }));
}
function invoke(expected: string, segments: Segment[], options: { badSource?: boolean; badScriptDigest?: boolean } = {}) {
  let raw: NarrationTranscriptProof | undefined;
  let metadata: FixtureMetadata | undefined;
  let producerStatus: number | null = null;
  let receipt: NarrationTranscriptProof | undefined;
  let error = "";
  const firstCall = processCalls;
  try {
    receipt = proveNarrationTranscript({
      audioPath, expectedText: expected, sourceSha256: options.badSource ? "0".repeat(64) : sourceSha256,
      runner: (command, args, timeoutMs) => {
        assert.equal(command, NARRATION_TRANSCRIPT_PROOF_PYTHON);
        assert.equal(args[0], "scripts/narration_transcript_proof.py");
        const invocation = [...args.slice(1)];
        const modelIndex = invocation.indexOf("--model-dir") + 1;
        assert.equal(invocation[modelIndex], NARRATION_TRANSCRIPT_MODEL_DIR);
        invocation[modelIndex] = evidence;
        if (options.badScriptDigest) invocation[invocation.indexOf("--expected-text-sha256") + 1] = "0".repeat(64);
        processCalls++;
        const output = spawnSync("python3", [fixtureScript, producerScript, ...invocation], {
          cwd: repo, encoding: "utf8", timeout: Math.min(timeoutMs, 10_000),
          env: { ...process.env, NARRATION_PROOF_TEST_FIXTURE: JSON.stringify({ segments }) },
        });
        producerStatus = output.status;
        writeFileSync(join(evidence, `call-${processCalls}.stdout.json`), output.stdout);
        writeFileSync(join(evidence, `call-${processCalls}.stderr.log`), output.stderr);
        if (output.stdout.trim()) raw = JSON.parse(output.stdout) as NarrationTranscriptProof;
        const lastLine = output.stderr.trim().split("\n").at(-1);
        assert.ok(lastLine, "guarded transport metadata must not be empty");
        assert.ok(lastLine?.startsWith("{"), "guarded transport metadata must be present");
        metadata = JSON.parse(lastLine) as FixtureMetadata;
        assert.equal(metadata.fixtureCalls.network, 0);
        transcribeCalls += metadata.fixtureCalls.transcribe;
        return { status: output.status, stdout: output.stdout, stderr: output.stderr,
          ...(output.error ? { error: output.error } : {}) };
      },
    });
  } catch (caught) { error = String(caught); }
  assert.equal(processCalls - firstCall, 1, "invalid proof must not trigger an automatic second ASR attempt");
  return { receipt, raw, error, producerStatus, metadata };
}

try {
  const ordinary = "We count every bright lantern carefully before moving onward to the next stage.";
  const grouped = "We count 2,157 bright lanterns carefully before moving onward to the next stage.";
  const hyphen = "We use a step-by-step method to review every clear result before moving onward.";
  const punctuation = "Well, we check each result carefully; then continue with a clear and reliable method.";
  const validCases = [
    { name: "ordinary", text: ordinary, wordTexts: ordinary.split(" ") },
    { name: "grouped numeral", text: grouped, wordTexts: grouped.split(" ") },
    { name: "split grouped numeral", text: grouped, wordTexts: grouped.replace("2,157", "2, 157").split(" ") },
    { name: "hyphenated word", text: hyphen, wordTexts: hyphen.split(" ") },
    { name: "split hyphenated word", text: hyphen, wordTexts: hyphen.replace("step-by-step", "step- by- step").split(" ") },
    { name: "attached punctuation", text: punctuation, wordTexts: punctuation.split(" ") },
    { name: "standalone punctuation entry", text: punctuation, wordTexts: punctuation.replace("Well,", "Well ,").split(" ") },
  ];
  let ordinaryReceipt: NarrationTranscriptProof | undefined;
  for (const example of validCases) {
    const words = wordsFor(example.wordTexts);
    const result = invoke(example.text, [{ text: example.text, words }]);
    assert.equal(result.producerStatus, 0, `${example.name}: ${result.error}`);
    assert.ok(result.receipt, `${example.name}: ${result.error}`);
    assert.equal(result.receipt.assessment.wordErrorRate, 0);
    assert.equal(result.receipt.assessment.lexicalRecall, 1);
    assert.equal(result.receipt.assessment.passed, true);
    assert.equal(result.receipt.expected.wordCount, narrationTranscriptLexicalTokens(example.text).length);
    assert.equal(result.receipt.transcript.wordCount, words.length, "count is timestamp units, not lexical WER tokens");
    assert.equal(result.receipt.transcript.text, example.text, "do not replace raw observed transcript text");
    assert.deepEqual(result.receipt.transcript.words, words.map((word) => ({
      text: word.text, startMs: Math.round(word.start * 1_000), endMs: Math.round(word.end * 1_000),
    })), "preserve observed word spans and existing timestamp conversion");
    assert.deepEqual(result.receipt.assessment.thresholds, { maxWordErrorRate: 0.18, minLexicalRecall: 0.92 });
    const summary = summarizeNarrationTranscriptProof(result.receipt);
    assert.equal(summary.transcript.wordCount, words.length);
    assert.equal(summary.transcript.timestampWordCount, words.length);
    if (example.name === "ordinary") ordinaryReceipt = result.receipt;
    caseCount++;
  }
  assert.ok(ordinaryReceipt);
  const inconsistent = [
    ordinary.replace("lantern", "wolves").split(" "),
    ordinary.replace("bright lantern", "lantern bright").split(" "),
    ["We", "count"],
    [...ordinary.split(" "), "again"],
    [],
  ];
  for (const wordTexts of inconsistent) {
    const rejected = invoke(ordinary, [{ text: ordinary, words: wordsFor(wordTexts) }]);
    assert.equal(rejected.producerStatus, 1, "producer must reject contradictory/truncated/reordered lexical coverage");
    assert.equal(rejected.raw, undefined, "producer must not emit a valid-looking incomplete receipt");
    assert.match(rejected.error, /do not cover the transcript lexical sequence/);
    assert.equal(rejected.metadata?.fixtureCalls.transcribe, 1);
    caseCount++;
  }
  const bindings = { sourceSha256, sourceByteLength: audio.length, expectedTextSha256: sha(ordinary) };
  const frozenCalls = { processCalls, transcribeCalls };
  for (const wordTexts of inconsistent.filter((words) => words.length > 0)) {
    const cached = structuredClone(ordinaryReceipt);
    cached.transcript.words = wordsFor(wordTexts).map((word) => ({ text: word.text,
      startMs: Math.round(word.start * 1_000), endMs: Math.round(word.end * 1_000) }));
    cached.transcript.wordCount = cached.transcript.words.length;
    assert.throws(() => assertNarrationTranscriptProof(cached, bindings), /do not cover the transcript lexical sequence/);
    assert.throws(() => summarizeNarrationTranscriptProof(cached), /do not cover the transcript lexical sequence/);
    assert.throws(() => assertFinalMasterNarrationTranscriptAudit({
      version: "final-master-narration-transcript-audit/v1",
      finalMaster: { sha256: sourceSha256, durationSec: 10 },
      narration: { sourceSha256, expectedTextSha256: sha(ordinary), startSec: 0, durationSec: 5 },
      sourceTranscript: ordinaryReceipt, finalMasterTranscript: cached,
    }), /do not cover the transcript lexical sequence/);
    caseCount++;
  }
  assert.deepEqual({ processCalls, transcribeCalls }, frozenCalls, "cached proof refusal must not transcribe or re-buy");

  const expectedWords = "Today we subtract two thousand one hundred fifty seven from the original total and explain the answer.";
  const observedDigits = "Today we subtract 2157 from the original total and explain the answer.";
  const metrics = invoke(expectedWords, [{ text: observedDigits, words: wordsFor(observedDigits.split(" ")) }]);
  assert.ok(metrics.receipt, metrics.error);
  assert.equal(metrics.receipt.assessment.wordErrorRate, 6 / 17);
  assert.equal(metrics.receipt.assessment.lexicalRecall, 11 / 17);
  assert.equal(metrics.receipt.assessment.passed, false, "count fix must not solve separate words/digits fidelity disagreement");
  caseCount++;
  const expectedNumber = "Today we review 2157 lanterns in the original collection and then explain every result with a clear example.";
  const observedNumber = expectedNumber.replace("2157", "2158");
  const missingNumber = invoke(expectedNumber, [{ text: observedNumber, words: wordsFor(observedNumber.split(" ")) }]);
  assert.ok(missingNumber.receipt, missingNumber.error);
  assert.deepEqual(missingNumber.receipt.assessment.missingNumericTerms, ["2157"]);
  assert.equal(missingNumber.receipt.assessment.wordErrorRate, 1 / 18);
  assert.equal(missingNumber.receipt.assessment.lexicalRecall, 17 / 18);
  assert.equal(missingNumber.receipt.assessment.passed, true,
    "preserve existing aggregate threshold behavior; this is not a critical-number semantic repair");
  caseCount++;
  const badTime = wordsFor(ordinary.split(" "));
  badTime[2].end = badTime[2].start - 0.1;
  const timeResult = invoke(ordinary, [{ text: ordinary, words: badTime }]);
  assert.equal(timeResult.producerStatus, 0);
  assert.match(timeResult.error, /word end must not precede/);
  caseCount++;
  for (const options of [{ badSource: true }, { badScriptDigest: true }]) {
    const failed = invoke(ordinary, [{ text: ordinary, words: wordsFor(ordinary.split(" ")) }], options);
    assert.equal(failed.producerStatus, 1);
    assert.equal(failed.metadata?.fixtureCalls.transcribe, 0);
    assert.match(failed.error, /SHA-256/);
    caseCount++;
  }
  const vectors = ["Don't re-enter 2,157.", "-175 +175 −175 3.14", "rock'n'roll", "Here's\tV2", "İ K ẞ café Æsir", "123_456 /-/ ...", "", "O’Neil", "UPPER lower\nsecond line"];
  const tokenResult = spawnSync("python3", [fixtureScript, producerScript], {
    cwd: repo, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, NARRATION_PROOF_TEST_FIXTURE: JSON.stringify({ tokenVectors: vectors }) },
  });
  assert.equal(tokenResult.status, 0, tokenResult.stderr);
  assert.deepEqual(JSON.parse(tokenResult.stdout), vectors.map(narrationTranscriptLexicalTokens), "TS must exactly mirror the existing Python lexical policy");
  assert.deepEqual(narrationTranscriptLexicalTokens("-175"), narrationTranscriptLexicalTokens("175"),
    "lexical coverage deliberately does not claim sign or raw-punctuation semantic equality");
  caseCount++;
  assert.equal(networkCalls, 0);
  assert.deepEqual([producerScript, join(repo, "src/lib/narrationTranscriptProof.ts")].map((path) => sha(readFileSync(path))), before);
  console.log(`Python→TS transcript contract passes ${caseCount} cases; ${processCalls} producer calls; ${transcribeCalls} guarded ASR calls; zero network. Evidence: ${evidence}`);
} finally {
  globalThis.fetch = originalFetch;
}
