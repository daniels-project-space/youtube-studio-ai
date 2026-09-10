import { SceneManifestSchema, type SceneManifest } from "@/engine/episodeGraph";
import type { WorkedExampleVisualPlan } from "@/engine/workedExampleVisual";

/** Held native visual qualification, not a pipeline admission profile. */
export const WORKED_EXAMPLE_LAYOUT = Object.freeze({
  width: 1920, height: 1080, fps: 30,
  frame: { x: 154, y: 97, width: 1612, height: 799 },
  problem: { x: 194, y: 137, width: 1532, height: 112 },
  working: { x: 194, y: 277, width: 1532, height: 100 },
  recent: { x: 194, y: 405, width: 1532, height: 84 },
  history: { x: 194, y: 521, width: 1532, height: 328 },
  label: { x: 154, y: 950, width: 1612, height: 68 },
  problemFont: 40, workingFont: 72, recentFont: 64, historyFont: 30, labelFont: 52,
});

export function displayWorkedInteger(value: string): string {
  return value.startsWith("-") ? `(${value})` : value;
}
export const WORKED_OPERATORS = { add: "+", subtract: "−", multiply: "×", exact_divide: "÷" } as const;

/** Monospace glyph cells, with explicit lines shared by preflight and DOM. */
export function workedProblemLines(text: string): string[] {
  // Courier New is 0.6em; reserve 8% and never decrease the native font.
  const capacity = Math.floor(WORKED_EXAMPLE_LAYOUT.problem.width * 0.92 / (WORKED_EXAMPLE_LAYOUT.problemFont * 0.6));
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    if (word.length > capacity) throw new Error("Worked-example problem has an unsupported unbreakable expression.");
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= capacity) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (!text.trim() || lines.length > 2) throw new Error("Worked-example problem exceeds the readable two-line native region.");
  return lines;
}

/** ANY root/reference marker opts into full strict validation, even null/undefined. */
export function preflightWorkedExampleLayout(manifest: SceneManifest, width: number, height: number): WorkedExampleVisualPlan | undefined {
  const marked = Object.hasOwn(manifest, "workedExampleVisualPlan") || manifest.scenes.some((scene) => scene.visualState && Object.hasOwn(scene.visualState, "workedExampleVisual"));
  if (!marked) return undefined;
  const parsed = SceneManifestSchema.parse(manifest);
  const plan = parsed.workedExampleVisualPlan;
  if (!plan) throw new Error("Worked-example renderer requires a complete marked visual plan.");
  if (width !== 1920 || height !== 1080) throw new Error("Worked-example visual foundation requires native 1920x1080 landscape; portrait is unfinished.");
  if (parsed.audience !== "general") throw new Error("Worked-example children presentation is not qualified by this held foundation.");
  for (const scene of parsed.scenes) {
    if (scene.transition !== "cut" && scene.transition !== "match_cut") throw new Error("Worked-example presentation currently supports cut/match_cut only.");
  }
  const fps = WORKED_EXAMPLE_LAYOUT.fps;
  for (const slot of plan.slots) {
    if (Math.ceil(slot.t0 * fps) / fps >= slot.t1) throw new Error(`Worked-example slot ${slot.id} has no renderable frame.`);
  }
  const lastFrame = Math.ceil(plan.durationSec * fps) - 1;
  if (lastFrame / fps < plan.steps.at(-1)!.revealAtSec) throw new Error("Worked-example final answer has no eligible actual frame.");
  workedProblemLines(plan.problemDisplay);
  for (const step of plan.steps) {
    const expression = `${displayWorkedInteger(step.left)} ${WORKED_OPERATORS[step.operation]} ${displayWorkedInteger(step.right)}`;
    if (`${expression} = ${step.result}` !== step.display) throw new Error("Worked-example token display differs from independently verified projection.");
    if (step.display.length * WORKED_EXAMPLE_LAYOUT.recentFont * 0.6 > WORKED_EXAMPLE_LAYOUT.recent.width * 0.92) throw new Error("Worked-example completed equation exceeds the readable recent-result region.");
    if (expression.length * WORKED_EXAMPLE_LAYOUT.workingFont * 0.6 > WORKED_EXAMPLE_LAYOUT.working.width * 0.92 || step.display.length * WORKED_EXAMPLE_LAYOUT.historyFont * 0.6 > WORKED_EXAMPLE_LAYOUT.history.width * 0.92) throw new Error("Worked-example equation exceeds readable native text bounds.");
  }
  return plan;
}
