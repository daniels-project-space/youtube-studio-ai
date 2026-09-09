import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  assertWorkedExamplePreparation, prepareWorkedExample, verifyWorkedExampleDerivation,
  WorkedExamplePreparationSchema, WorkedExampleRequestSchema, WORKED_EXAMPLE_LIMITS,
  type WorkedExamplePreparation, type WorkedExampleRequest,
} from "@/engine/workedExample";

type Derivation = WorkedExamplePreparation["derivation"];
const request: WorkedExampleRequest = {
  policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a",
  runId: "run-a", requestId: "request-a", seed: "example-a",
  operations: ["add", "multiply", "subtract", "exact_divide"],
};
function single(left: string, right: string, operation: WorkedExampleRequest["operations"][number], result: string): Derivation {
  return { expression: { nodes: [
    { id: "node-left", kind: "integer", value: left }, { id: "node-right", kind: "integer", value: right },
    { id: "node-result", kind: "operation", operation, left: "node-left", right: "node-right" },
  ], rootId: "node-result" }, steps: [{ nodeId: "node-result", result }], answer: result };
}
const twoSteps: Derivation = {
  expression: { nodes: [
    { id: "node-two", kind: "integer", value: "2" }, { id: "node-three", kind: "integer", value: "3" },
    { id: "node-four", kind: "integer", value: "4" },
    { id: "node-product", kind: "operation", operation: "multiply", left: "node-three", right: "node-four" },
    { id: "node-answer", kind: "operation", operation: "add", left: "node-two", right: "node-product" },
  ], rootId: "node-answer" },
  steps: [{ nodeId: "node-product", result: "12" }, { nodeId: "node-answer", result: "14" }], answer: "14",
};
function changed(change: (value: Derivation) => void, base = twoSteps): Derivation {
  const value = structuredClone(base); change(value); return value;
}

// Independent authored gold answers and exact display/speech, not snapshots of the producer.
assert.deepEqual(verifyWorkedExampleDerivation(single("27", "15", "add", "42")), {
  version: "worked-example-projection/en-v1", problemDisplay: "(27 + 15)",
  problemSpeech: "Calculate open parenthesis twenty seven plus fifteen close parenthesis.",
  steps: [{ nodeId: "node-result", display: "27 + 15 = 42", speech: "Step one. twenty seven plus fifteen equals forty two." }],
  answerDisplay: "42", answerSpeech: "The answer is forty two.",
});
assert.equal(verifyWorkedExampleDerivation(twoSteps).problemDisplay, "(2 + (3 × 4))");
const grouped = changed((v) => {
  v.expression.nodes[3] = { id: "node-product", kind: "operation", operation: "add", left: "node-two", right: "node-three" };
  v.expression.nodes[4] = { id: "node-answer", kind: "operation", operation: "multiply", left: "node-product", right: "node-four" };
  v.steps[0].result = "5"; v.steps[1].result = "20"; v.answer = "20";
});
assert.equal(verifyWorkedExampleDerivation(grouped).problemDisplay, "((2 + 3) × 4)");
for (const [a, b, op, expected] of [["12", "3", "exact_divide", "4"], ["-12", "3", "exact_divide", "-4"], ["0", "7", "multiply", "0"], ["3", "8", "subtract", "-5"], ["1000000", "1000000", "multiply", "1000000000000"]] as const) {
  assert.equal(verifyWorkedExampleDerivation(single(a, b, op, expected)).answerDisplay, expected);
}
// A shared-subexpression DAG is legal when every node actually contributes to the root.
const shared = changed((v) => {
  v.expression.nodes.splice(0, 1);
  v.expression.nodes[3] = { id: "node-answer", kind: "operation", operation: "add", left: "node-product", right: "node-product" };
  v.steps[1].result = "24"; v.answer = "24";
});
assert.equal(verifyWorkedExampleDerivation(shared).answerDisplay, "24");

const badResult = changed((v) => { v.steps[0].result = "13"; }); // final answer remains correct
const badFinal = changed((v) => { v.answer = "15"; });
const badStepId = changed((v) => { v.steps[0].nodeId = "node-foreign"; });
const disconnected = changed((v) => {
  v.expression.nodes.push({ id: "node-unused", kind: "operation", operation: "add", left: "node-two", right: "node-three" });
  v.steps.push({ nodeId: "node-unused", result: "5" });
});
const duplicate = changed((v) => { v.expression.nodes.splice(1, 0, { id: "node-two", kind: "integer", value: "2" }); });
const fractional = single("1", "2", "exact_divide", "0");
const badCases: Array<[string, unknown]> = [
  ["bad intermediate with correct final", badResult], ["bad final", badFinal],
  ["foreign step id", badStepId], ["unused operation", disconnected], ["duplicate id", duplicate],
  ["fractional division", fractional], ["zero division", single("1", "0", "exact_divide", "0")],
  ["unused literal", changed((v) => { v.expression.nodes.push({ id: "node-unused", kind: "integer", value: "1" }); })],
  ["missing step", changed((v) => { v.steps.shift(); })], ["reordered steps", changed((v) => { v.steps.reverse(); })],
  ["duplicate step", changed((v) => { v.steps[1] = v.steps[0]; })],
  ["root literal", changed((v) => { v.expression.rootId = "node-two"; })],
  ["unknown root", changed((v) => { v.expression.rootId = "node-unknown"; })],
  ["future operand", changed((v) => { const n = v.expression.nodes[3]; if (n.kind === "operation") n.left = "node-answer"; })],
  ["self cycle", changed((v) => { const n = v.expression.nodes[3]; if (n.kind === "operation") n.left = n.id; })],
  ["unbound operand", changed((v) => { const n = v.expression.nodes[3]; if (n.kind === "operation") n.right = "node-absent"; })],
  ["literal limit", single("1000001", "1", "add", "1000002")],
  ["unsupported operator", { ...single("2", "3", "add", "5"), expression: { ...single("2", "3", "add", "5").expression, nodes: [{ id: "node-left", kind: "operation", operation: "power", left: "node-x", right: "node-y" }] } }],
  ["unknown field", { ...twoSteps, verified: true }],
  ["unknown node field", changed((v) => { v.expression.nodes[0] = { ...v.expression.nodes[0], unknown: true } as unknown as Derivation["expression"]["nodes"][number]; })],
  ["JSON number instead of canonical integer", single(2 as unknown as string, "3", "add", "5")],
];
const overflow = single("1000000", "1000000", "multiply", "1000000000000");
overflow.expression.nodes.push({ id: "node-overflow", kind: "operation", operation: "add", left: "node-result", right: "node-left" });
overflow.expression.rootId = "node-overflow"; overflow.steps.push({ nodeId: "node-overflow", result: "1000001000000" }); overflow.answer = "1000001000000";
badCases.push(["intermediate limit", overflow]);
const tooManyNodes = changed((v) => {
  for (let i = v.expression.nodes.length; i <= WORKED_EXAMPLE_LIMITS.nodes; i += 1) v.expression.nodes.push({ id: `node-limit-${i}`, kind: "integer", value: "0" });
});
badCases.push(["node count limit", tooManyNodes]);
const longProjection = single("0", "0", "add", "0");
for (let i = 1; i < WORKED_EXAMPLE_LIMITS.steps; i += 1) {
  const prior = longProjection.expression.rootId, id = `node-double-${i}`;
  longProjection.expression.nodes.push({ id, kind: "operation", operation: "add", left: prior, right: prior });
  longProjection.steps.push({ nodeId: id, result: "0" }); longProjection.expression.rootId = id;
}
badCases.push(["bounded DAG expansion", longProjection]);
const tooManySteps = changed((v) => { while (v.steps.length <= WORKED_EXAMPLE_LIMITS.steps) v.steps.push(v.steps[0]); });
badCases.push(["step count limit", tooManySteps]);
for (const value of ["01", "-0", "+1", "1.5", "1e3", "NaN", "Infinity", "9".repeat(10000)]) badCases.push([`noncanonical integer ${value.slice(0, 10)}`, single(value, "1", "add", "2")]);
for (const [label, value] of badCases) assert.throws(() => verifyWorkedExampleDerivation(value), label);

const prepared = prepareWorkedExample(request);
assert.deepEqual(prepareWorkedExample(request), prepared, "stable retry bytes");
assert.deepEqual(prepareWorkedExample(Object.fromEntries(Object.entries(request).reverse())), prepared, "key insertion order is irrelevant");
assert.deepEqual(assertWorkedExamplePreparation(prepared, request), prepared);
for (const key of ["ownerId", "channelId", "runId", "requestId", "seed"] as const) {
  const foreign = { ...request, [key]: `${request[key]}-other` };
  assert.throws(() => assertWorkedExamplePreparation(prepared, foreign), /different request or namespace/);
  assert.notEqual(prepareWorkedExample(foreign).fingerprint, prepared.fingerprint);
}
for (const invalid of [
  { ...request, policy: "general-education" }, { ...request, policy: undefined },
  { ...request, operations: ["fraction"] }, { ...request, operations: [] },
  { ...request, operations: Array(9).fill("add") }, { ...request, seed: "x".repeat(65) },
  { ...request, answer: "42" }, { ...request, ownerId: "" },
]) assert.throws(() => WorkedExampleRequestSchema.parse(invalid));

// Deliberately recompute unkeyed hashes after corruption: math/projection checks must
// reject it independently. These hashes are NOT authorization signatures.
function canonicalForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalForTest((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function reseal(value: WorkedExamplePreparation): WorkedExamplePreparation {
  const { fingerprint: ignored, ...body } = value; void ignored;
  return { ...body, fingerprint: createHash("sha256").update(canonicalForTest(body)).digest("hex") };
}
const badProjection = structuredClone(prepared); badProjection.projection.steps[0].speech = "Step one. two plus two equals five.";
const badDisplay = structuredClone(prepared); badDisplay.projection.steps[0].display = "2 + 2 = 5";
const badProjectionNode = structuredClone(prepared); badProjectionNode.projection.steps[0].nodeId = "node-foreign";
const forgedProblem = structuredClone(prepared); forgedProblem.derivation = twoSteps; forgedProblem.projection = verifyWorkedExampleDerivation(twoSteps);
const preparedBadResult = structuredClone(prepared); preparedBadResult.derivation.steps[0].result = "999";
for (const invalid of [badProjection, badDisplay, badProjectionNode, forgedProblem, preparedBadResult]) assert.throws(() => WorkedExamplePreparationSchema.parse(reseal(invalid)));
assert.throws(() => WorkedExamplePreparationSchema.parse({ ...prepared, fingerprint: "0".repeat(64) }), /fingerprint mismatch/);
assert.throws(() => WorkedExamplePreparationSchema.parse({ ...prepared, requestFingerprint: "0".repeat(64) }), /request fingerprint mismatch/);
assert.throws(() => WorkedExamplePreparationSchema.parse({ ...prepared, projection: { ...prepared.projection, version: "unknown" } }));

// Independent Number oracle is exact in this deliberately bounded integer domain
// (all intermediates <= 1e12 < 2^53); it imports neither generator nor verifier math.
const uniqueProblems = new Set<string>();
for (let seed = 0; seed < 256; seed += 1) {
  const value = prepareWorkedExample({ ...request, seed: `generated-${seed}`, operations: [...request.operations, ...request.operations] });
  const values = new Map<string, number>();
  let step = 0;
  for (const node of value.derivation.expression.nodes) {
    if (node.kind === "integer") { values.set(node.id, Number(node.value)); continue; }
    const a = values.get(node.left)!, b = values.get(node.right)!;
    const answer = node.operation === "add" ? a + b : node.operation === "subtract" ? a - b : node.operation === "multiply" ? a * b : a / b;
    assert.ok(Number.isSafeInteger(answer)); assert.ok(Math.abs(answer) <= WORKED_EXAMPLE_LIMITS.resultMagnitude);
    assert.equal(String(answer), value.derivation.steps[step++].result);
    values.set(node.id, answer);
  }
  assert.equal(String(values.get(value.derivation.expression.rootId)), value.derivation.answer);
  uniqueProblems.add(JSON.stringify(value.derivation.expression));
}
assert.ok(uniqueProblems.size > 240, "seeded generation must not collapse onto one example");

async function mutations(): Promise<void> {
  const require = createRequire(import.meta.url);
  const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
  };
  const filename = resolve("src/engine/workedExample.ts"), source = readFileSync(filename, "utf8");
  const cases: Array<{ name: string; guard: string; probe: (api: typeof import("@/engine/workedExample")) => void }> = [
    { name: "step-result", guard: 'if (step.result !== String(result)) throw new Error(`incorrect derivation result at ${node.id}`);', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(badResult)) },
    { name: "answer", guard: 'if (derivation.answer !== String(answer)) throw new Error("incorrect final answer");', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(badFinal)) },
    { name: "reachability", guard: 'if (reachable.size !== nodes.size) throw new Error("disconnected or unused expression nodes");', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(disconnected)) },
    { name: "unique-id", guard: 'if (nodes.has(node.id)) throw new Error(`duplicate node id ${node.id}`);', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(duplicate)) },
    { name: "step-binding", guard: 'if (!step || step.nodeId !== node.id) throw new Error(`missing, duplicate or reordered derivation step at ${node.id}`);', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(badStepId)) },
    { name: "exact-division", guard: 'if (left % right !== BigInt(0)) throw new Error("non-integer division is unsupported");', probe: (api) => assert.throws(() => api.verifyWorkedExampleDerivation(fractional)) },
    { name: "projection", guard: 'if (canonical(projection) !== canonical(preparation.projection)) throw new Error("worked example display/speech projection mismatch");', probe: (api) => assert.throws(() => api.WorkedExamplePreparationSchema.parse(reseal(badProjection))) },
    { name: "generated-request", guard: 'if (canonical(preparation.derivation.expression) !== canonical(generateDerivation(preparation.request).expression)) throw new Error("expression does not belong to the deterministic request");', probe: (api) => assert.throws(() => api.WorkedExamplePreparationSchema.parse(reseal(forgedProblem))) },
    { name: "namespace", guard: 'if (preparation.requestFingerprint !== hash(expected)) throw new Error("worked example belongs to a different request or namespace");', probe: (api) => assert.throws(() => api.assertWorkedExamplePreparation(prepared, { ...request, channelId: "channel-other" })) },
  ];
  for (const { name, guard, probe } of cases) {
    assert.equal(source.split(guard).length, 2, `mutation guard must match exactly once: ${name}`);
    const bundle = await build({
      absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      stdin: { contents: source.replace(guard, "/* removed by test mutation */"), resolveDir: dirname(filename), loader: "ts" },
    });
    const loaded = { exports: {} as typeof import("@/engine/workedExample") };
    // Test-only compilation of this repository's controlled source; never an input evaluator.
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, loaded, loaded.exports);
    assert.throws(() => probe(loaded.exports), /Missing expected exception/, `oracle must kill disabled ${name} gate`);
    console.log(`killed mutation: ${name}`);
  }
}

void mutations().then(() => console.log(`worked-example core PASS: ${badCases.length} corruptions, 256 independent generated examples, 9 killed guard mutations; zero providers`));
