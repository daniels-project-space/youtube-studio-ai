/** Held, browser-safe arithmetic presentation contract. Not renderer admission or speech QA. */
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { WorkedExamplePreparationSchema, type WorkedExamplePreparation } from "./workedExample";
import { draftWorkedExampleNarration } from "./workedExampleNarration";

export const WORKED_EXAMPLE_VISUAL_VERSION = "worked-example-visual/sentence-end-v1" as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const stableId = (prefix: string) => z.string().max(120).regex(new RegExp(`^${prefix}-[a-z0-9]+(?:-[a-z0-9]+)*$`));
const sec = z.number().finite().nonnegative();
const integer = z.string().max(14).regex(/^(?:0|-?[1-9][0-9]*)$/);
const hash = (value: unknown) => sha256Hex(canonicalJson(value));

const SentenceSchema = z.object({ id: stableId("sentence"), text: z.string().min(1).max(4096), start: sec, end: sec }).strict();
const BeatSchema = z.object({ id: stableId("beat"), sentenceId: stableId("sentence"), t0: sec, t1: sec }).strict();
const SlotSchema = z.object({
  id: stableId("slot"), beatId: stableId("beat"), sentenceId: stableId("sentence"), t0: sec, t1: sec,
  phase: z.enum(["problem", "step", "answer"]),
  label: z.string().min(1).max(80), stepIndex: z.number().int().nonnegative().max(7).optional(),
  nodeId: stableId("node").optional(),
}).strict();
const StepSchema = z.object({
  nodeId: stableId("node"), leftNodeId: stableId("node"), rightNodeId: stableId("node"),
  operation: z.enum(["add", "subtract", "multiply", "exact_divide"]),
  left: integer, right: integer, result: integer,
  display: z.string().min(1).max(300),
  sentenceId: stableId("sentence"), revealAtSec: sec,
}).strict();
const PlanShape = z.object({
  version: z.literal(WORKED_EXAMPLE_VISUAL_VERSION),
  aspectRatio: z.literal("16:9"),
  preparation: WorkedExamplePreparationSchema,
  source: z.object({
    scriptFingerprint: sha, inputFingerprint: sha, timingFingerprint: sha, storySpineFingerprint: sha, segmentClockFingerprint: sha,
    artifact: z.object({ key: z.string().min(1).max(1024), sha256: sha, byteLength: z.number().int().positive().max(256 * 1024 * 1024) }).strict(),
  }).strict(),
  durationSec: z.number().finite().positive().max(36000),
  sentences: z.array(SentenceSchema).min(3).max(10),
  beats: z.array(BeatSchema).min(3).max(10),
  problemDisplay: z.string().min(1).max(4096), answer: integer,
  steps: z.array(StepSchema).min(1).max(8), slots: z.array(SlotSchema).min(3).max(10),
  fingerprint: sha,
}).strict();
export type WorkedExampleVisualPlan = z.infer<typeof PlanShape>;
export type WorkedExampleVisualSlot = WorkedExampleVisualPlan["slots"][number];

/** Current TTS keeps each canonical "Step one. negative ..." as ONE utterance:
 * its splitter starts a new unit only before uppercase text. Never invent a clock
 * for the announcement within that utterance. Tests derive units from the real TTS splitter. */
export function workedExampleVisualSentences(preparation: WorkedExamplePreparation): string[] {
  return [preparation.projection.problemSpeech, ...preparation.projection.steps.map((step) => step.speech), preparation.projection.answerSpeech];
}

type PlanInputs = Pick<WorkedExampleVisualPlan, "preparation" | "source" | "durationSec" | "sentences" | "beats">;

function derivePresentation(input: PlanInputs) {
  // Replays all arithmetic and the deterministic request, including edited public fingerprints.
  const preparation = WorkedExamplePreparationSchema.parse(input.preparation);
  const spoken = workedExampleVisualSentences(preparation);
  if (input.sentences.length !== spoken.length || input.beats.length !== spoken.length) throw new Error("arithmetic visual timing requires exactly one ordered beat per canonical sentence");
  const sentenceIds = new Set<string>(), beatIds = new Set<string>();
  input.sentences.forEach((sentence, index) => {
    if (sentenceIds.has(sentence.id)) throw new Error("arithmetic visual timing repeats a sentence id");
    sentenceIds.add(sentence.id);
    if (sentence.text !== spoken[index]) throw new Error("arithmetic visual sentence differs from the verified ordered speech");
    if (sentence.end <= sentence.start || sentence.end > input.durationSec || (index > 0 && sentence.start < input.sentences[index - 1].end)) throw new Error("arithmetic visual sentence timing overlaps or exceeds narration");
    const beat = input.beats[index];
    if (beatIds.has(beat.id)) throw new Error("arithmetic visual timing repeats a beat id");
    beatIds.add(beat.id);
    if (beat.sentenceId !== sentence.id || beat.t0 !== (index ? input.sentences[index - 1].end : 0) || beat.t1 !== (index === spoken.length - 1 ? input.durationSec : sentence.end)) throw new Error("arithmetic visual beat does not preserve the bound Story Spine sentence window");
    if (beat.t0 > sentence.start || beat.t1 < sentence.end || beat.t1 <= beat.t0) throw new Error("arithmetic visual beat does not contain its narration sentence");
  });
  const script = draftWorkedExampleNarration(preparation, preparation.request).script;
  if (input.source.scriptFingerprint !== hash(script)) throw new Error("arithmetic visual script fingerprint differs from its verified preparation");
  const values = new Map(preparation.derivation.expression.nodes.flatMap((node) => node.kind === "integer" ? [[node.id, node.value] as const] : []));
  // Values are taken only from the independently replayed derivation, never supplied scene labels.
  preparation.derivation.steps.forEach((step) => values.set(step.nodeId, step.result));
  const steps = preparation.derivation.steps.map((step, index) => {
    const node = preparation.derivation.expression.nodes.find((node) => node.id === step.nodeId)!;
    if (node.kind !== "operation") throw new Error("arithmetic step is not an operation");
    const sentence = input.sentences[1 + index];
    return { nodeId: node.id, leftNodeId: node.left, rightNodeId: node.right, operation: node.operation,
      left: values.get(node.left)!, right: values.get(node.right)!, result: step.result,
      display: preparation.projection.steps[index].display, sentenceId: sentence.id, revealAtSec: sentence.end };
  });
  const slots = input.beats.map((beat, index): WorkedExampleVisualSlot => {
    const base = { id: `slot-${String(index + 1).padStart(4, "0")}`, beatId: beat.id, sentenceId: beat.sentenceId, t0: beat.t0, t1: beat.t1 };
    if (index === 0) return { ...base, phase: "problem", label: "The problem" };
    if (index === input.beats.length - 1) return { ...base, phase: "answer", label: "Review the answer", nodeId: preparation.derivation.expression.rootId };
    const stepIndex = index - 1;
    return { ...base, phase: "step", label: `Step ${stepIndex + 1}`, stepIndex, nodeId: steps[stepIndex].nodeId };
  });
  return { problemDisplay: preparation.projection.problemDisplay, answer: preparation.derivation.answer, steps, slots };
}

export const WorkedExampleVisualPlanSchema = PlanShape.superRefine((plan, ctx) => {
  try {
    const expected = derivePresentation(plan);
    for (const key of ["problemDisplay", "answer", "steps", "slots"] as const) {
      if (canonicalJson(plan[key]) !== canonicalJson(expected[key])) throw new Error(`arithmetic visual ${key} differs from its verified derivation/timing`);
    }
    const { fingerprint, ...body } = plan;
    if (fingerprint !== hash(body)) throw new Error("arithmetic visual plan fingerprint mismatch");
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "invalid arithmetic visual plan" }); }
});

/** Internal contract construction only; current source authority belongs to the compiler's
 * full-bundle assertion. A recomputed public hash does not validate a foreign audio artifact. */
export function createWorkedExampleVisualPlan(input: PlanInputs): WorkedExampleVisualPlan {
  const body = { version: WORKED_EXAMPLE_VISUAL_VERSION, aspectRatio: "16:9" as const, ...input, ...derivePresentation(input) };
  return WorkedExampleVisualPlanSchema.parse({ ...body, fingerprint: hash(body) });
}

export const WorkedExampleVisualReferenceSchema = z.object({
  version: z.literal(WORKED_EXAMPLE_VISUAL_VERSION), planFingerprint: sha, slotId: stableId("slot"),
}).strict();
export type WorkedExampleVisualReference = z.infer<typeof WorkedExampleVisualReferenceSchema>;
export function workedExampleVisualReference(plan: WorkedExampleVisualPlan, slot: WorkedExampleVisualSlot): WorkedExampleVisualReference {
  if (!plan.slots.some((candidate) => canonicalJson(candidate) === canonicalJson(slot))) throw new Error("arithmetic visual reference has no matching plan slot");
  return { version: WORKED_EXAMPLE_VISUAL_VERSION, planFingerprint: plan.fingerprint, slotId: slot.id };
}

/** Pure reveal oracle for a future renderer. Results are absent, not hidden with opacity.
 * A result equal to a legitimate operand is distinguished by node/role, not global text matching. */
export function workedExampleVisibleResults(planValue: unknown, timeSec: number): Array<{ nodeId: string; result: string }> {
  const plan = WorkedExampleVisualPlanSchema.parse(planValue);
  if (!Number.isFinite(timeSec) || timeSec < 0 || timeSec > plan.durationSec) throw new Error("arithmetic visual clock is outside the bound narration");
  return plan.steps.filter((step) => timeSec >= step.revealAtSec).map(({ nodeId, result }) => ({ nodeId, result }));
}

type HandoffEntry = {
  id: string; t0: number; t1: number; text: string; label?: string; beatId?: string;
  storySpineSentenceIds?: string[]; storySpineBeatIds?: string[]; narrationSentenceIds?: string[];
  visualState: Record<string, unknown>;
};
/** No partial marker may silently fall back to the generic illustrated grammar. */
export function assertWorkedExampleVisualHandoff(root: { workedExampleVisualPlan?: unknown; durationSec: number }, entries: HandoffEntry[], manifest: boolean): void {
  const marked = Object.hasOwn(root, "workedExampleVisualPlan") || entries.some((entry) => Object.hasOwn(entry.visualState, "workedExampleVisual"));
  if (!marked) return;
  const plan = WorkedExampleVisualPlanSchema.parse(root.workedExampleVisualPlan);
  if (root.durationSec !== plan.durationSec || entries.length !== plan.slots.length) throw new Error("arithmetic visual handoff must cover the complete bound plan");
  entries.forEach((entry, index) => {
    const slot = plan.slots[index];
    const reference = WorkedExampleVisualReferenceSchema.parse(entry.visualState.workedExampleVisual);
    if (canonicalJson(reference) !== canonicalJson(workedExampleVisualReference(plan, slot))) throw new Error("arithmetic visual scene references a missing, foreign or reordered slot");
    const mixed = ["syntheticScenarioProfile", "syntheticScenarioVisualKind", "scenarioVisualTreatmentFingerprint", "evidenceVisualIntent", "evidenceVisualManifest"].some((key) => Object.hasOwn(entry.visualState, key));
    if (mixed) throw new Error("arithmetic visual cannot mix factual or fictional scenario grammar");
    if (entry.t0 !== slot.t0 || entry.t1 !== slot.t1 || (entry.beatId ?? entry.id) !== slot.beatId) throw new Error("arithmetic visual scene changes its bound beat or clock");
    const ids = manifest ? entry.narrationSentenceIds : entry.storySpineSentenceIds;
    if (canonicalJson(ids) !== canonicalJson([slot.sentenceId]) || (!manifest && canonicalJson(entry.storySpineBeatIds) !== canonicalJson([slot.beatId]))) throw new Error("arithmetic visual scene changes its ordered Story Spine references");
    if (entry.visualState.action !== slot.label || canonicalJson(entry.visualState.props) !== "[]" || Object.hasOwn(entry.visualState, "mood")) throw new Error("arithmetic visual requires safe canonical action and no free-form props/mood");
    // Graph text retains exact speech for provenance; renderer handoff copy stays answer-safe.
    if (entry.text !== (manifest ? slot.label : plan.sentences[index].text) || (manifest && entry.label !== slot.label)) throw new Error("arithmetic visual scene text/label is not its safe canonical projection");
  });
}
