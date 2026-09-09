/** Held arithmetic preparation only: no provider, script approval or render admission. */
import { z } from "zod";
import { sha256Hex } from "@/lib/sha256";

export const WORKED_EXAMPLE_POLICY = "worked-example/integer-v1" as const;
export const WORKED_EXAMPLE_LIMITS = Object.freeze({
  nodes: 31, steps: 8, depth: 8, literalMagnitude: 1_000_000,
  resultMagnitude: 1_000_000_000_000, projectionCharacters: 4_096,
});
const OperationSchema = z.enum(["add", "subtract", "multiply", "exact_divide"]);
type Operation = z.infer<typeof OperationSchema>;
const identity = z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const nodeId = z.string().regex(/^node-[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
// Bound length BEFORE BigInt conversion; JSON numbers/fractions/exponents are not this domain.
const integer = z.string().max(14).regex(/^(?:0|-?[1-9][0-9]*)$/);

export const WorkedExampleRequestSchema = z.object({
  policy: z.literal(WORKED_EXAMPLE_POLICY),
  ownerId: identity, channelId: identity, runId: identity, requestId: identity,
  seed: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  operations: z.array(OperationSchema).min(1).max(WORKED_EXAMPLE_LIMITS.steps),
}).strict();
export type WorkedExampleRequest = z.infer<typeof WorkedExampleRequestSchema>;

const NodeSchema = z.discriminatedUnion("kind", [
  z.object({ id: nodeId, kind: z.literal("integer"), value: integer }).strict(),
  z.object({ id: nodeId, kind: z.literal("operation"), operation: OperationSchema, left: nodeId, right: nodeId }).strict(),
]);
const ExpressionSchema = z.object({
  nodes: z.array(NodeSchema).min(3).max(WORKED_EXAMPLE_LIMITS.nodes), rootId: nodeId,
}).strict();
const DerivationSchema = z.object({
  expression: ExpressionSchema,
  steps: z.array(z.object({ nodeId, result: integer }).strict()).min(1).max(WORKED_EXAMPLE_LIMITS.steps),
  answer: integer,
}).strict();
type Derivation = z.infer<typeof DerivationSchema>;
type Expression = Derivation["expression"];
const ProjectionSchema = z.object({
  version: z.literal("worked-example-projection/en-v1"),
  problemDisplay: z.string().min(1).max(WORKED_EXAMPLE_LIMITS.projectionCharacters),
  problemSpeech: z.string().min(1).max(WORKED_EXAMPLE_LIMITS.projectionCharacters),
  steps: z.array(z.object({
    nodeId, display: z.string().min(1).max(300), speech: z.string().min(1).max(900),
  }).strict()).min(1).max(WORKED_EXAMPLE_LIMITS.steps),
  answerDisplay: z.string().min(1).max(30), answerSpeech: z.string().min(1).max(300),
}).strict();
type Projection = z.infer<typeof ProjectionSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string { return sha256Hex(canonical(value)); }
function bounded(value: bigint, maximum: number, label: string): bigint {
  if (value > BigInt(maximum) || value < -BigInt(maximum)) throw new Error(`${label} exceeds integer magnitude limit`);
  return value;
}

const smallWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tensWords = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function spokenInteger(value: bigint): string {
  if (value < BigInt(0)) return `negative ${spokenInteger(-value)}`;
  if (value < BigInt(20)) return smallWords[Number(value)];
  if (value < BigInt(100)) return `${tensWords[Number(value / BigInt(10))]}${value % BigInt(10) ? ` ${spokenInteger(value % BigInt(10))}` : ""}`;
  for (const [scale, word] of [[1_000_000_000_000, "trillion"], [1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"], [100, "hundred"]] as const) {
    if (value >= BigInt(scale)) return `${spokenInteger(value / BigInt(scale))} ${word}${value % BigInt(scale) ? ` ${spokenInteger(value % BigInt(scale))}` : ""}`;
  }
  throw new Error("unsupported spoken integer");
}
const operators: Record<Operation, { display: string; speech: string }> = {
  add: { display: "+", speech: "plus" }, subtract: { display: "−", speech: "minus" },
  multiply: { display: "×", speech: "times" }, exact_divide: { display: "÷", speech: "divided by" },
};
function displayInteger(value: bigint): string { return value < BigInt(0) ? `(${value})` : String(value); }

/** Independent replay, not a comparison of an asserted answer with itself. No eval. */
export function verifyWorkedExampleDerivation(value: unknown): Projection {
  const derivation = DerivationSchema.parse(value);
  const { expression, steps } = derivation;
  const values = new Map<string, bigint>();
  const depths = new Map<string, number>();
  const displays = new Map<string, string>();
  const speeches = new Map<string, string>();
  const nodes = new Map<string, Expression["nodes"][number]>();
  const projectionSteps: Projection["steps"] = [];
  let stepIndex = 0;
  for (const node of expression.nodes) {
    if (nodes.has(node.id)) throw new Error(`duplicate node id ${node.id}`);
    nodes.set(node.id, node);
    if (node.kind === "integer") {
      const n = bounded(BigInt(node.value), WORKED_EXAMPLE_LIMITS.literalMagnitude, "literal");
      values.set(node.id, n); depths.set(node.id, 0);
      displays.set(node.id, displayInteger(n)); speeches.set(node.id, spokenInteger(n));
      continue;
    }
    const left = values.get(node.left), right = values.get(node.right);
    if (left === undefined || right === undefined) throw new Error(`future, cyclic or unbound operand at ${node.id}`);
    const depth = 1 + Math.max(depths.get(node.left)!, depths.get(node.right)!);
    if (depth > WORKED_EXAMPLE_LIMITS.depth) throw new Error("expression depth limit exceeded");
    let result: bigint;
    switch (node.operation) {
      case "add": result = left + right; break;
      case "subtract": result = left - right; break;
      case "multiply": result = left * right; break;
      case "exact_divide":
        if (right === BigInt(0)) throw new Error("division by zero");
        if (left % right !== BigInt(0)) throw new Error("non-integer division is unsupported");
        result = left / right; break;
    }
    bounded(result, WORKED_EXAMPLE_LIMITS.resultMagnitude, "result");
    const step = steps[stepIndex];
    if (!step || step.nodeId !== node.id) throw new Error(`missing, duplicate or reordered derivation step at ${node.id}`);
    if (step.result !== String(result)) throw new Error(`incorrect derivation result at ${node.id}`);
    const operator = operators[node.operation];
    const display = `(${displays.get(node.left)} ${operator.display} ${displays.get(node.right)})`;
    const speech = `open parenthesis ${speeches.get(node.left)} ${operator.speech} ${speeches.get(node.right)} close parenthesis`;
    if (display.length > WORKED_EXAMPLE_LIMITS.projectionCharacters || speech.length > WORKED_EXAMPLE_LIMITS.projectionCharacters) throw new Error("expression projection limit exceeded");
    values.set(node.id, result); depths.set(node.id, depth);
    displays.set(node.id, display); speeches.set(node.id, speech);
    projectionSteps.push({
      nodeId: node.id,
      display: `${displayInteger(left)} ${operator.display} ${displayInteger(right)} = ${result}`,
      speech: `Step ${spokenInteger(BigInt(stepIndex + 1))}. ${spokenInteger(left)} ${operator.speech} ${spokenInteger(right)} equals ${spokenInteger(result)}.`,
    });
    stepIndex += 1;
  }
  if (stepIndex !== steps.length) throw new Error("unused derivation steps");
  if (nodes.get(expression.rootId)?.kind !== "operation") throw new Error("root must reference an operation");
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const node = nodes.get(id)!;
    if (node.kind === "operation") { visit(node.left); visit(node.right); }
  };
  visit(expression.rootId);
  if (reachable.size !== nodes.size) throw new Error("disconnected or unused expression nodes");
  const answer = values.get(expression.rootId)!;
  if (derivation.answer !== String(answer)) throw new Error("incorrect final answer");
  return ProjectionSchema.parse({
    version: "worked-example-projection/en-v1",
    problemDisplay: displays.get(expression.rootId), problemSpeech: `Calculate ${speeches.get(expression.rootId)}.`,
    steps: projectionSteps, answerDisplay: String(answer), answerSpeech: `The answer is ${spokenInteger(answer)}.`,
  });
}

/** Problem generation is separate from replay; this never accepts a supplied solution. */
function generateDerivation(request: WorkedExampleRequest): Derivation {
  const sample = (index: number): bigint => BigInt(parseInt(sha256Hex(`${WORKED_EXAMPLE_POLICY}:${request.seed}:${index}`).slice(0, 8), 16));
  let current = sample(0) % BigInt(201) - BigInt(100);
  let currentId = "node-start";
  const nodes: Expression["nodes"] = [{ id: currentId, kind: "integer", value: String(current) }];
  const steps: Derivation["steps"] = [];
  request.operations.forEach((operation, index) => {
    let right = sample(index + 1) % BigInt(25) - BigInt(12);
    if (operation === "exact_divide") {
      // Select a true divisor; never round or silently change the requested operation.
      const divisors = Array.from({ length: 12 }, (_, i) => BigInt(i + 1)).filter((n) => current % n === BigInt(0));
      right = divisors[Number(sample(index + 1) % BigInt(divisors.length))];
    }
    const rightId = `node-input-${index + 1}`, id = `node-operation-${index + 1}`;
    nodes.push({ id: rightId, kind: "integer", value: String(right) }, { id, kind: "operation", operation, left: currentId, right: rightId });
    // Intentionally separate producer arithmetic: replay above checks these claims.
    if (operation === "add") current += right;
    else if (operation === "subtract") current -= right;
    else if (operation === "multiply") current *= right;
    else current /= right;
    steps.push({ nodeId: id, result: String(current) });
    currentId = id;
  });
  return { expression: { nodes, rootId: currentId }, steps, answer: String(current) };
}

const PreparationShape = z.object({
  version: z.literal("worked-example-preparation/v1"), request: WorkedExampleRequestSchema,
  requestFingerprint: fingerprint, derivation: DerivationSchema, projection: ProjectionSchema, fingerprint,
}).strict();
export type WorkedExamplePreparation = z.infer<typeof PreparationShape>;

function checkPreparation(preparation: WorkedExamplePreparation): void {
  if (preparation.requestFingerprint !== hash(preparation.request)) throw new Error("worked example request fingerprint mismatch");
  const projection = verifyWorkedExampleDerivation(preparation.derivation);
  if (canonical(preparation.derivation.expression) !== canonical(generateDerivation(preparation.request).expression)) throw new Error("expression does not belong to the deterministic request");
  if (canonical(projection) !== canonical(preparation.projection)) throw new Error("worked example display/speech projection mismatch");
  const { fingerprint: actual, ...body } = preparation;
  if (actual !== hash(body)) throw new Error("worked example preparation fingerprint mismatch");
}

// Actual artifact consumers replay the math, not merely validate the outer JSON shape.
export const WorkedExamplePreparationSchema = PreparationShape.superRefine((preparation, ctx) => {
  try { checkPreparation(preparation); }
  catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "invalid worked example" }); }
});

/** Integrity linkage is not a signature or authorization. Bind to the caller's request too. */
export function assertWorkedExamplePreparation(value: unknown, expectedRequest: unknown): WorkedExamplePreparation {
  const preparation = WorkedExamplePreparationSchema.parse(value);
  const expected = WorkedExampleRequestSchema.parse(expectedRequest);
  if (preparation.requestFingerprint !== hash(expected)) throw new Error("worked example belongs to a different request or namespace");
  return preparation;
}

export function prepareWorkedExample(value: unknown): WorkedExamplePreparation {
  const request = WorkedExampleRequestSchema.parse(value);
  const derivation = generateDerivation(request);
  const body = {
    version: "worked-example-preparation/v1" as const, request,
    requestFingerprint: hash(request), derivation, projection: verifyWorkedExampleDerivation(derivation),
  };
  return assertWorkedExamplePreparation({ ...body, fingerprint: hash(body) }, request);
}
