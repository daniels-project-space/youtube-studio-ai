/**
 * Validation-spec executor. The Critic (crew) authors a per-video ValidationSpec;
 * this runs it. Deterministic assertions compare a metric the caller already
 * computed; vision assertions defer to a caller-supplied judge. Decoupled from
 * ffmpeg/gemini on purpose (pure + testable) — the qa blocks supply the inputs.
 *
 * Philosophy (matches the rest of the engine): a metric we cannot compute is
 * SKIPPED, never failed — no silent dealbreaker from a missing measurement. Only
 * a genuinely-failed BLOCK-severity assertion fails the outcome.
 */
import type {
  ValidationSpec,
  ValidationAssertion,
  ValidationResult,
  ValidationOutcome,
  ValidationOp,
} from "./types";

function compare(observed: number, op: ValidationOp, threshold: number): boolean {
  switch (op) {
    case "<": return observed < threshold;
    case "<=": return observed <= threshold;
    case ">": return observed > threshold;
    case ">=": return observed >= threshold;
    case "==": return observed === threshold;
    default: return true;
  }
}

export interface RunSpecInputs {
  /** Pre-computed deterministic metric values (e.g. { captionCoveragePct: 0.97 }). */
  metrics: Record<string, number>;
  /** Judge a vision assertion → true=pass. Omit → vision assertions are skipped. */
  visionJudge?: (a: ValidationAssertion) => Promise<boolean | null>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

async function evalAssertion(
  a: ValidationAssertion,
  inputs: RunSpecInputs,
): Promise<ValidationResult> {
  const base = { id: a.id, severity: a.severity };
  if (a.check === "deterministic") {
    const metric = a.metric ?? "";
    const observed = inputs.metrics[metric];
    if (metric === "" || typeof observed !== "number" || !Number.isFinite(observed)) {
      return { ...base, passed: true, skipped: true, note: `metric "${metric}" not measured` };
    }
    if (a.op === undefined || a.threshold === undefined) {
      return { ...base, passed: true, skipped: true, observed, note: "no op/threshold" };
    }
    const passed = compare(observed, a.op, a.threshold);
    return { ...base, passed, observed, note: passed ? undefined : `${observed} ${a.op} ${a.threshold} failed` };
  }
  // vision
  if (!inputs.visionJudge) {
    return { ...base, passed: true, skipped: true, note: "no vision judge" };
  }
  try {
    const verdict = await inputs.visionJudge(a);
    if (verdict === null) return { ...base, passed: true, skipped: true, note: "vision judge undecided" };
    return { ...base, passed: verdict, note: verdict ? undefined : "vision judge rejected" };
  } catch (e) {
    return { ...base, passed: true, skipped: true, note: `vision judge error: ${e instanceof Error ? e.message : e}` };
  }
}

export async function runValidationSpec(
  spec: ValidationSpec | undefined,
  inputs: RunSpecInputs,
): Promise<ValidationOutcome> {
  const log = inputs.log ?? (() => {});
  const assertions = spec?.assertions ?? [];
  if (assertions.length === 0) return { passed: true, results: [] };

  const results: ValidationResult[] = [];
  for (const a of assertions) results.push(await evalAssertion(a, inputs));

  const blockedFailures = results.filter((r) => !r.passed && !r.skipped && r.severity === "block");
  const warned = results.filter((r) => !r.passed && !r.skipped && r.severity === "warn");
  const skipped = results.filter((r) => r.skipped);
  log(
    `validationSpec: ${results.length} assertions — ${blockedFailures.length} blocking fail, ${warned.length} warn, ${skipped.length} skipped`,
    { failed: blockedFailures.map((r) => r.id), warned: warned.map((r) => r.id) },
  );
  return { passed: blockedFailures.length === 0, results };
}
