import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import type { WorkedExampleVisualPlan } from "@/engine/workedExampleVisual";
import { WORKED_EXAMPLE_LAYOUT as layout, WORKED_OPERATORS, displayWorkedInteger, workedProblemLines } from "./workedExampleLayout";

interface Palette { ink: string; surface: string; primary: string; accent: string; text: string; muted: string }
type Step = WorkedExampleVisualPlan["steps"][number];
const rect = (region: { x: number; y: number; width: number; height: number }): CSSProperties => ({ position: "absolute", left: region.x, top: region.y, width: region.width, height: region.height, boxSizing: "border-box" });

function Operands({ step }: { step: Step }) {
  return <><span data-math-role="operand" data-node-id={step.leftNodeId}>{displayWorkedInteger(step.left)}</span>{" "}<span data-math-role="operator" data-node-id={step.nodeId}>{WORKED_OPERATORS[step.operation]}</span>{" "}<span data-math-role="operand" data-node-id={step.rightNodeId}>{displayWorkedInteger(step.right)}</span></>;
}

function CompletedEquation({ step, recent, accent }: { step: Step; recent?: boolean; accent: string }) {
  return <div data-math-equation={recent ? "recent" : "history"} data-step-node={step.nodeId}><Operands step={step} />{" = "}<span data-math-role="result" data-node-id={step.nodeId} style={{ color: accent }}>{step.result}</span></div>;
}

/** Receives a once-validated plan. No parsing prose, recalculating math, or clock guesses. */
export function WorkedExampleScene({ plan, frame, fps, palette, grid }: { plan: WorkedExampleVisualPlan; frame: number; fps: number; palette: Palette; grid: ReactNode }) {
  const problemLines = useMemo(() => workedProblemLines(plan.problemDisplay), [plan]);
  const second = frame / fps;
  const slot = plan.slots.find((entry) => second >= entry.t0 && second < entry.t1) ?? plan.slots.at(-1)!;
  const current = slot.phase === "step" ? plan.steps[slot.stepIndex!] : undefined;
  // No previous-layer DOM: future results are absent, not transparent or offscreen.
  const completed = plan.steps.filter((step) => second >= step.revealAtSec);
  const answerReady = slot.phase === "answer" && completed.length === plan.steps.length;
  return <AbsoluteFill data-worked-example-layout="worked-example/native-landscape-v1" data-worked-slot={slot.id} data-worked-frame={frame} style={{ background: palette.ink, color: palette.text, fontFamily: "Arial, Helvetica, sans-serif" }}>
    {grid}
    <div style={{ ...rect(layout.frame), borderRadius: 38, background: `${palette.surface}88`, border: `2px solid ${palette.text}1F` }} />
    <div data-math-region="problem" style={{ ...rect(layout.problem), fontFamily: "Courier New, monospace", fontSize: layout.problemFont, lineHeight: "52px", fontWeight: 700 }}>
      {problemLines.map((line, index) => <div data-math-role="problem" key={index}>{line}</div>)}
    </div>
    <div data-math-region="working" style={{ ...rect(layout.working), fontFamily: "Courier New, monospace", fontSize: layout.workingFont, lineHeight: "92px", fontWeight: 700, color: palette.primary }}>
      {current ? <div data-math-equation="working" data-step-node={current.nodeId}><Operands step={current} /></div> : null}
      {answerReady ? <div><span data-math-role="answer" data-node-id={plan.steps.at(-1)!.nodeId}>{plan.answer}</span></div> : null}
    </div>
    <div data-math-region="history" style={{ ...rect(layout.history), fontFamily: "Courier New, monospace", fontSize: layout.historyFont, lineHeight: "42px", fontWeight: 700 }}>
      {completed.slice(0, -1).map((step) => <CompletedEquation key={step.nodeId} step={step} accent={palette.accent} />)}
    </div>
    <div data-math-region="recent" style={{ ...rect(layout.recent), fontFamily: "Courier New, monospace", fontSize: layout.recentFont, lineHeight: "82px", fontWeight: 700 }}>
      {completed.length ? <CompletedEquation step={completed.at(-1)!} recent accent={palette.accent} /> : null}
    </div>
    <div data-math-region="label" style={{ ...rect(layout.label), fontSize: layout.labelFont, fontWeight: 800, lineHeight: "64px", letterSpacing: "-0.035em", textShadow: "0 4px 22px #00000088" }}><span data-math-role="label">{slot.label}</span></div>
  </AbsoluteFill>;
}
