/**
 * stagehandAgentLoop — a replacement for Stagehand 3.x's built-in
 * `stagehand.agent({ mode: "hybrid" }).execute({ instruction, maxSteps })`.
 *
 * Stagehand 4.x removed the autonomous agent entirely: the SDK now exposes only
 * the single-shot primitives `act(instruction)`, `observe(instruction?)` and
 * `extract(instruction, schema?)`. There is no official replacement for the
 * multi-step "plan and execute a natural-language goal within a step budget"
 * behaviour, so this module rebuilds it on top of those primitives:
 *
 *   for step in 1..maxSteps:
 *     observed = stagehand.observe()            // what is actionable right now
 *     decision = LLM(goal, observed, history)   // exactly ONE next action, or done/stop
 *     if decision is done/stop: return
 *     stagehand.act(decision.instruction)       // perform that single action
 *
 * SAFETY. The 3.x built-in agent carried whatever internal scaffolding
 * Browserbase shipped with it. A hand-rolled loop has none, so the constraints
 * are enforced in two independent places here:
 *  1. In the per-step decision prompt (`DECISION_SYSTEM_PROMPT`), not just in
 *     the caller's top-level instruction — the model re-reads them every step.
 *  2. Mechanically, in `isDestructiveAgentInstruction()`, which is applied to
 *     the model's proposed instruction BEFORE it is handed to `act()`. A
 *     proposal that reads as destructive stops the loop; it is never executed.
 * The loop is also fail-soft by construction: running out of steps, an
 * undecidable page, or a refused proposal all return `success: false` rather
 * than throwing or guessing. Callers verify real-world success independently
 * (e.g. provisionYoutube.ts polls Convex for a linked token row), and that
 * external check — not this loop's return value — remains the source of truth.
 *
 * The decision model is this codebase's pinned non-Google OpenRouter route
 * (`src/lib/openRouter.ts`); no new provider integration is introduced, and
 * Gemini stays banned outside the sealed thumbnail exception.
 */
import { hasOpenRouterKey, openRouterJson } from "@/lib/openRouter";

/** The subset of Stagehand 4.x the loop needs. Structurally typed so callers keep casting. */
export interface StagehandActor {
  act(instruction: string): Promise<unknown>;
  observe(instruction?: string): Promise<unknown>;
}

/** Shaped like Stagehand 3.x's `agent.execute()` result so call sites barely change. */
export interface StagehandAgentLoopResult {
  success?: boolean;
  completed?: boolean;
  message?: string;
  /** Number of `act()` calls actually performed. */
  steps: number;
  /** Human-readable per-step trail, useful in task logs and post-mortems. */
  history: string[];
}

export interface StagehandAgentLoopOptions {
  maxSteps: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  /**
   * Extra hard constraints appended verbatim to the per-step system prompt.
   * Use for call-site-specific invariants (e.g. "only ever touch channel X").
   */
  extraRules?: string[];
  /** Consecutive failed `act()` calls tolerated before the loop gives up. Default 3. */
  maxConsecutiveFailures?: number;
}

/**
 * Mechanical destructive-intent guard applied to every model-proposed action.
 *
 * Deliberately scoped to destructive verbs applied to a CHANNEL/ACCOUNT object
 * rather than to bare verbs, because legitimate steps in the create flow do say
 * things like "clear the prefilled handle" or "remove the existing text". The
 * risk being defended against is deleting/renaming a real channel on a real
 * Google account, not text-field editing.
 */
const DESTRUCTIVE_INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(delete|remove|rename|deactivate|archive|unlink|disconnect|terminate|close)\b[^.!?]{0,48}\b(channel|account|profile|kanal|konto|kanal(?:s)?)\b/i,
  /\b(channel|account|profile|kanal|konto)\b[^.!?]{0,48}\b(delete|remove|rename|deactivate|terminate|l(?:ö|oe)sch\w*|umbenenn\w*|entfern\w*)\b/i,
  /\b(l(?:ö|oe)sch\w*|umbenenn\w*)\b[^.!?]{0,48}\b(kanal|konto)\b/i,
  /\bdelete\s+(?:my|the|this|that|another|other|existing)\b/i,
  /\badvanced\s+settings?\b[^.!?]{0,32}\bdelete\b/i,
];

export function isDestructiveAgentInstruction(instruction: string): boolean {
  const normalized = instruction.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return DESTRUCTIVE_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

const DECISION_SYSTEM_PROMPT = [
  "You drive a real web browser one action at a time to accomplish a goal.",
  "You are operating a REAL, production Google/YouTube account. Actions are irreversible.",
  "",
  "HARD SAFETY RULES — these override the goal, always:",
  "1. NEVER delete, rename, deactivate, archive or otherwise modify any channel or account other than",
  "   creating/selecting the single named target the goal specifies.",
  "2. NEVER click destructive controls (Delete channel, Remove account, Rename, Advanced > Delete).",
  "3. Only ever select, create, or authorize the EXACT target named in the goal. If several similar",
  "   options exist and you cannot tell which is the exact target, STOP.",
  "4. If you are not confident what to click, or the page is unexpected, STOP. Do not guess.",
  "   Stopping is always safer and is a valid, expected outcome.",
  "5. Propose exactly ONE concrete, single-step UI action per turn.",
  "",
  'Reply with ONLY a JSON object: {"status":"act"|"done"|"stop","instruction":string,"reason":string}',
  '- "act": `instruction` is one short natural-language UI action for this page, e.g. "click the button labelled Create a channel".',
  '- "done": the goal is fully achieved. Explain the evidence in `reason`.',
  '- "stop": you cannot proceed safely or confidently. Explain why in `reason`.',
].join("\n");

interface AgentLoopDecision {
  status?: string;
  instruction?: string;
  reason?: string;
}

/** Compact the observe() payload into something cheap and readable for the planner. */
function summarizeObservation(observed: unknown, limit = 40): string {
  const data = (observed as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length === 0) return "(no actionable elements detected)";
  return data
    .slice(0, limit)
    .map((entry, index) => {
      const item = entry as { description?: unknown; method?: unknown; selector?: unknown };
      const description = typeof item?.description === "string" ? item.description.slice(0, 160) : "";
      const method = typeof item?.method === "string" ? ` [${item.method}]` : "";
      return `${index + 1}. ${description || String(item?.selector ?? "unknown element")}${method}`;
    })
    .join("\n");
}

/** Pull a short human-readable message out of an ActResult without assuming its shape. */
function actMessage(result: unknown): string {
  const data = (result as { data?: { message?: unknown; actionDescription?: unknown } })?.data;
  const message = typeof data?.message === "string" ? data.message : "";
  const description = typeof data?.actionDescription === "string" ? data.actionDescription : "";
  return (message || description).slice(0, 200);
}

function actSucceeded(result: unknown): boolean {
  const success = (result as { data?: { success?: unknown } })?.data?.success;
  // Absent success flags are treated as "not a failure" — act() throws on hard failure.
  return success !== false;
}

/**
 * Run a multi-step natural-language goal against a Stagehand 4.x session.
 * Never throws for goal failure; throws only for missing configuration.
 */
export async function runStagehandAgentLoop(
  stagehand: unknown,
  instruction: string,
  options: StagehandAgentLoopOptions,
): Promise<StagehandAgentLoopResult> {
  const actor = stagehand as StagehandActor;
  const log = options.log ?? (() => {});
  const maxSteps = Math.max(1, Math.floor(options.maxSteps));
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
  const history: string[] = [];

  if (!hasOpenRouterKey()) {
    throw new Error("Stagehand agent loop requires OPENROUTER_API_KEY for its per-step decisions");
  }

  const systemPrompt = options.extraRules?.length
    ? `${DECISION_SYSTEM_PROMPT}\n\nAdditional hard rules for this task:\n${
        options.extraRules.map((rule) => `- ${rule}`).join("\n")
      }`
    : DECISION_SYSTEM_PROMPT;

  let steps = 0;
  let consecutiveFailures = 0;

  for (let step = 1; step <= maxSteps; step++) {
    let observed: unknown;
    try {
      observed = await actor.observe();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      history.push(`step ${step}: observe failed — ${message}`);
      log("agent-loop: observe failed", { step, error: message.slice(0, 200) });
      return {
        success: false,
        completed: false,
        message: `observation failed at step ${step}: ${message}`,
        steps,
        history,
      };
    }

    const decisionPrompt = [
      `GOAL:\n${instruction}`,
      "",
      `STEP ${step} of ${maxSteps}.`,
      "",
      "ACTIONS TAKEN SO FAR:",
      history.length ? history.join("\n") : "(none yet)",
      "",
      "ACTIONABLE ELEMENTS ON THE CURRENT PAGE:",
      summarizeObservation(observed),
      "",
      "Decide the single next action, or whether the goal is complete, or whether to stop.",
    ].join("\n");

    let decision: AgentLoopDecision;
    try {
      decision = await openRouterJson<AgentLoopDecision>({
        tier: "flash",
        system: systemPrompt,
        prompt: decisionPrompt,
        maxTokens: 500,
        temperature: 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      history.push(`step ${step}: decision failed — ${message}`);
      log("agent-loop: decision failed", { step, error: message.slice(0, 200) });
      return {
        success: false,
        completed: false,
        message: `decision failed at step ${step}: ${message}`,
        steps,
        history,
      };
    }

    const status = String(decision.status ?? "").toLowerCase();
    const reason = typeof decision.reason === "string" ? decision.reason.slice(0, 300) : "";

    if (status === "done") {
      history.push(`step ${step}: done — ${reason}`);
      log("agent-loop: goal reported complete", { step, reason: reason.slice(0, 200) });
      return { success: true, completed: true, message: reason || "goal reported complete", steps, history };
    }
    if (status === "stop" || status !== "act") {
      history.push(`step ${step}: stopped — ${reason || `unusable decision status "${status}"`}`);
      log("agent-loop: stopped", { step, reason: reason.slice(0, 200), status });
      return {
        success: false,
        completed: false,
        message: reason || `agent stopped at step ${step} (status "${status}")`,
        steps,
        history,
      };
    }

    const proposed = typeof decision.instruction === "string" ? decision.instruction.trim() : "";
    if (!proposed) {
      history.push(`step ${step}: stopped — act decision carried no instruction`);
      return {
        success: false,
        completed: false,
        message: `agent proposed an empty action at step ${step}`,
        steps,
        history,
      };
    }

    // Mechanical guard — refuse and stop, never execute a destructive proposal.
    if (isDestructiveAgentInstruction(proposed)) {
      history.push(`step ${step}: REFUSED destructive proposal — ${proposed.slice(0, 160)}`);
      log("agent-loop: refused destructive proposal", { step, proposed: proposed.slice(0, 200) });
      return {
        success: false,
        completed: false,
        message: `refused a destructive proposed action at step ${step}: ${proposed.slice(0, 160)}`,
        steps,
        history,
      };
    }

    try {
      const result = await actor.act(proposed);
      steps++;
      const outcome = actMessage(result);
      if (actSucceeded(result)) {
        consecutiveFailures = 0;
        history.push(`step ${step}: acted — ${proposed.slice(0, 140)}${outcome ? ` → ${outcome}` : ""}`);
      } else {
        consecutiveFailures++;
        history.push(`step ${step}: action reported failure — ${proposed.slice(0, 140)}${outcome ? ` → ${outcome}` : ""}`);
      }
      log("agent-loop: acted", { step, proposed: proposed.slice(0, 160), outcome: outcome.slice(0, 160) });
    } catch (error) {
      steps++;
      consecutiveFailures++;
      const message = error instanceof Error ? error.message : String(error);
      history.push(`step ${step}: act threw — ${proposed.slice(0, 140)} → ${message.slice(0, 160)}`);
      log("agent-loop: act failed", { step, error: message.slice(0, 200) });
    }

    if (consecutiveFailures >= maxConsecutiveFailures) {
      return {
        success: false,
        completed: false,
        message: `agent stopped after ${consecutiveFailures} consecutive failed actions`,
        steps,
        history,
      };
    }
  }

  return {
    success: false,
    completed: false,
    message: `agent exhausted its ${maxSteps}-step budget without reporting completion`,
    steps,
    history,
  };
}
