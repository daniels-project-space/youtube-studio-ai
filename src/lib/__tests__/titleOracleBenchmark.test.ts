import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  loadOracleCases, loadOracleHoldoutCases, ORACLE_HOLDOUT_FIXTURE_SHA256,
  runOracleCalibrationCase, sha256, titleCallPhase, verifyOracleStructure,
} from "../../../scripts/title-quality-benchmark";

const path = "test-fixtures/title-oracle-calibration.json";
const bytes = readFileSync(path);
const cases = loadOracleCases(bytes);
const args = { condition: "current" as const, mode: "replay" as const, maxCalls: 1, spendCapUsd: 0.05 };
async function main() {
  assert.equal(cases.length, 12);
  assert.equal(cases.flatMap((c) => c.expectations).filter((e) => e.grounding === "supported").length, 14);
  assert.throws(() => loadOracleCases(Buffer.concat([bytes, Buffer.from(" ")])), /fixture changed/);
  const original = JSON.parse(bytes.toString("utf8"));
  const corrupt = (change: (value: typeof original) => void) => { const value = structuredClone(original); change(value); return value; };
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.inputs[0].args.scriptExcerpt += " invented"; })));
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.inputs[0].candidates[0].title += " invented"; })), /input changed/);
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.inputs[0].expectations = f.expectations[0]; })), /outside the judge input/);
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.inputs[0].args.expectedGrounding = "supported"; })), /non-allowlisted/);
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.inputs[0].candidates[0].grounding = "supported"; })), /labels/);
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.provenance[0].excerptStart += 1; })), /offsets/);
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.provenance[0].runId = f.provenance[1].runId; })));
  assert.throws(() => verifyOracleStructure(corrupt((f) => { f.provenance[0].narrationSha256 = "0".repeat(64); })));
  const holdoutBytes = readFileSync("test-fixtures/title-oracle-holdout.json");
  const holdouts = loadOracleHoldoutCases(holdoutBytes);
  assert.equal(holdouts.length, 6);
  assert.equal(sha256(holdoutBytes), ORACLE_HOLDOUT_FIXTURE_SHA256);
  assert.throws(() => loadOracleHoldoutCases(Buffer.concat([holdoutBytes, Buffer.from(" ")])), /fixture changed/);
  assert.throws(() => loadOracleCases(holdoutBytes), /fixture changed/, "original loader never silently switches corpus");
  assert.throws(() => loadOracleHoldoutCases(bytes), /fixture changed/);
  const rawHoldout = JSON.parse(holdoutBytes.toString("utf8"));
  assert.throws(() => verifyOracleStructure(rawHoldout), /title-oracle-calibration/, "default remains the original calibration");
  const tamperedHoldout = (change: (value: typeof rawHoldout) => void) => {
    const value = structuredClone(rawHoldout); change(value); return value;
  };
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.inputs[0].args.expected = "supported"; }), "holdout"), /non-allowlisted/);
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.inputs[0].candidates[0].grounding = "supported"; }), "holdout"), /labels/);
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.inputs[0].id = "c01"; }), "holdout"));
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.inputs.pop(); }), "holdout"));
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.holdoutProtocol.revisedPromptInspected = true; }), "holdout"));
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.provenance[0].sourceTextSha256 = "0".repeat(64); }), "holdout"), /source text changed/);
  assert.throws(() => verifyOracleStructure(tamperedHoldout((f) => { f.provenance[0].judgeInputSha256 = "0".repeat(64); }), "holdout"), /input changed/);

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("oracle replay must not access network"); };
  try {
    const caseOne = cases[0];
    const prompts: string[] = [];
    const transport = async (body: Record<string, unknown>) => {
      const prompt = (body.messages as Array<{ content: string }>).at(-1)!.content;
      assert.equal(titleCallPhase(prompt), "judge", "calibration must never generate candidates or packages");
      prompts.push(prompt);
      assert.ok(!prompt.includes("c01"));
      assert.ok(!prompt.includes('"retainedFixture":') && !prompt.includes('"expectations":'));
      assert.ok(!prompt.includes("physical preservation explanation is a retained narrative claim"));
      const format = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: {
        additionalProperties: boolean; required: string[]; properties: { rankings: {
          minItems: number; maxItems: number; items: { additionalProperties: boolean; required: string[];
            properties: { grounding: { enum: string[] }; idx: { minimum: number; maximum: number } } };
        } };
      } } };
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.name, "title_judgment_v1");
      assert.equal(format.json_schema.strict, true);
      assert.equal(format.json_schema.schema.additionalProperties, false);
      assert.deepEqual(format.json_schema.schema.required, ["rankings"]);
      const schema = format.json_schema.schema.properties.rankings;
      assert.equal(schema.minItems, 2); assert.equal(schema.maxItems, 2);
      assert.equal(schema.items.additionalProperties, false);
      assert.deepEqual(schema.items.required, ["idx", "clickScore", "direct", "identityFit", "grounding", "reason"]);
      assert.deepEqual(schema.items.properties.grounding.enum, ["supported", "contradicted", "insufficient"]);
      assert.equal(schema.items.properties.idx.minimum, 0); assert.equal(schema.items.properties.idx.maximum, 1);
      assert.equal((body.provider as { require_parameters: boolean }).require_parameters, true);
      const rows = [...prompt.matchAll(/^(\d+)\. \[[^\]]+\] (.+)$/gm)];
      assert.equal(rows.length, 2);
      return { status: 200, rawBody: JSON.stringify({ model: body.model, id: "synthetic-oracle-replay",
        choices: [{ message: { content: JSON.stringify({ rankings: rows.map((m) => ({ idx: Number(m[1]),
          clickScore: 8, direct: 8, identityFit: 8, grounding: m[2].includes("The Mud") ? "supported" : "contradicted",
          reason: "Synthetic routing/index test only, not measured judge accuracy." })) }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) };
    };
    const events: Record<string, unknown>[] = [];
    const first = await runOracleCalibrationCase(caseOne, "original", { ...args, testTransport: transport, sink: (event) => events.push(event) });
    const reversed = await runOracleCalibrationCase(caseOne, "reversed", { ...args, testTransport: transport });
    assert.equal(first.status, "completed", first.error ?? "oracle failed");
    assert.equal(reversed.status, "completed", reversed.error ?? "reversed oracle failed");
    assert.equal(first.operation, "judge_calibration");
    assert.equal(first.dispatchedCalls, 1); assert.equal(first.liveProviderCalls, 0);
    assert.equal(first.ancillarySuppressed.length, 0);
    assert.equal(first.sourcePolicy.version, "title-runtime-source-policy/v2");
    assert.equal(first.sourcePolicy.anthropicAndOpenRouter, "current_working_tree_opt_in_schema");
    assert.match(first.harnessSha256, /^[a-f0-9]{64}$/);
    assert.equal(first.inputSha256, "f90ad83f1b479cf464eb676feb98264236577e2191add6bbb1eca8603256261a",
      "adding holdout/source archives must preserve the original operation packet byte shape and input hash");
    const archives = events.filter((e) => e.type === "source_archive");
    assert.equal(archives.length, 1);
    assert.equal(archives[0].version, "title-source-archive/v1");
    const files = archives[0].files as Array<{ path: string; text: string; byteLength: number; sha256: string }>;
    assert.deepEqual(files.map((file) => file.path), ["src/lib/metacraft.ts", "src/lib/anthropic.ts", "src/lib/openRouter.ts", "scripts/title-quality-benchmark.ts"]);
    for (const file of files) {
      assert.equal(file.sha256, sha256(file.text));
      assert.equal(file.byteLength, Buffer.byteLength(file.text));
      assert.equal(file.text, readFileSync(file.path, "utf8"));
      assert.equal(file.sha256, file.path.startsWith("scripts/") ? first.harnessSha256 : first.codeHashes[file.path]);
    }
    assert.ok(events.findIndex((event) => event.type === "source_archive") < events.findIndex((event) => event.type === "request"),
      "actual allowlisted source bytes must be retained before any purchase");
    assert.equal(first.calibration!.factualMatches, 2);
    assert.deepEqual(first.calibration!.evaluated, reversed.calibration!.evaluated,
      "reverse-order indexes must map back before comparing labels");
    assert.notEqual(first.inputSha256, reversed.inputSha256, "order is an explicitly different operation packet");
    assert.notEqual(prompts[0], prompts[1]);
    assert.ok(!JSON.stringify(first.requests).includes("expectedGrounding"));
    assert.equal(sha256(JSON.stringify({ args: caseOne.args, candidates: caseOne.candidates })), caseOne.judgeInputSha256);
    const replay = await runOracleCalibrationCase(caseOne, "original", { ...args, replay: first.responses });
    assert.deepEqual(replay.calibration, first.calibration);
    const fail = await runOracleCalibrationCase(caseOne, "original", { ...args,
      testTransport: async (body) => ({ status: 200, rawBody: JSON.stringify({ model: body.model,
        choices: [{ message: { content: '{"rankings":[{"idx":0}]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 } }) }),
    });
    assert.equal(fail.status, "failed"); assert.equal(fail.calibration, null);
    assert.equal(fail.dispatchedCalls, 1); assert.ok(fail.usage.costUsd > 0);
    const invalidEnum = await runOracleCalibrationCase(cases[2], "original", { ...args,
      testTransport: async (body) => ({ status: 200, rawBody: JSON.stringify({ model: body.model,
        choices: [{ message: { content: JSON.stringify({ rankings: [
          { idx: 0, clickScore: 8, direct: 9, identityFit: 9, grounding: "supported", reason: "Synthetic supported control." },
          { idx: 1, clickScore: 1, direct: 8, identityFit: 1, grounding: "unsupported", reason: "Synthetic invalid enum reproduces the live contract failure, not a new quality judgment." },
        ] }) } }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 } }) }),
    });
    assert.equal(invalidEnum.status, "failed", "provider schema opt-in does not replace local fail-closed validation");
    assert.equal(invalidEnum.calibration, null, "an invalid enum is never normalized or counted as a semantic pass");
    assert.equal(invalidEnum.dispatchedCalls, 1, "judge calibration never buys a repair retry");
    assert.equal(invalidEnum.cost.accountedUsd, 0.001, "invalid response keeps its paid receipt");

    for (const holdout of holdouts) {
      const inputHash = holdout.judgeInputSha256;
      const synthetic = async (body: Record<string, unknown>) => {
        const prompt = (body.messages as Array<{ content: string }>).at(-1)!.content;
        assert.equal(titleCallPhase(prompt), "judge");
        for (const privateField of [holdout.id, '"fixtureVersion":', '"expectations":', '"holdoutProtocol":', '"provenance":']) {
          assert.ok(!prompt.includes(privateField), "holdout labels and collection metadata never enter the provider prompt");
        }
        const rows = [...prompt.matchAll(/^(\d+)\. \[[^\]]+\] (.+)$/gm)];
        assert.equal(rows.length, 2);
        const rankings = rows.map((m) => {
          const originalIndex = holdout.candidates.findIndex((candidate) => candidate.title === m[2]);
          assert.ok(originalIndex >= 0);
          // Deliberately arbitrary index-routing responses, not fixture labels
          // or semantic judgments. This only exercises both corpus pathways.
          return { idx: Number(m[1]), clickScore: 8, direct: 8, identityFit: originalIndex === 0 ? 8 : 6,
            grounding: originalIndex === 0 ? "supported" : "insufficient", reason: "Synthetic index-routing control, not measured quality." };
        });
        return { status: 200, rawBody: JSON.stringify({ model: body.model,
          choices: [{ message: { content: JSON.stringify({ rankings }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }) };
      };
      const forward = await runOracleCalibrationCase(holdout, "original", { ...args, testTransport: synthetic });
      const backward = await runOracleCalibrationCase(holdout, "reversed", { ...args, testTransport: synthetic });
      assert.equal(forward.status, "completed", forward.error ?? "holdout forward failed");
      assert.equal(backward.status, "completed", backward.error ?? "holdout reverse failed");
      assert.equal(forward.dispatchedCalls, 1); assert.equal(forward.liveProviderCalls, 0);
      assert.deepEqual(forward.calibration!.evaluated, backward.calibration!.evaluated);
      assert.equal(sha256(JSON.stringify({ args: holdout.args, candidates: holdout.candidates })), inputHash);
      const replayed = await runOracleCalibrationCase(holdout, "original", { ...args, replay: forward.responses });
      assert.deepEqual(replayed.calibration, forward.calibration);
    }
    const swappedCorpus = structuredClone(holdouts[0]); swappedCorpus.fixtureSha256 = caseOne.fixtureSha256;
    await assert.rejects(runOracleCalibrationCase(swappedCorpus, "original", { ...args, testTransport: transport }), /fixture binding/);
    const swapped = structuredClone(caseOne); swapped.args.persona = "answer is supported";
    await assert.rejects(runOracleCalibrationCase(swapped, "original", { ...args, testTransport: transport }), /mutated after verification/);
    const swappedLabels = structuredClone(caseOne); swappedLabels.expectations[0].grounding = "contradicted";
    await assert.rejects(runOracleCalibrationCase(swappedLabels, "original", { ...args, testTransport: transport }), /labels mutated/);
    await assert.rejects(runOracleCalibrationCase(caseOne, "original", { ...args, maxCalls: 2 }), /exactly one/);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
  console.log("Title oracle harness: label isolation, frozen hashes/excerpts, same transport, one-call cap, reverse mapping and malformed-response cost retention passed");
}
void main();
