/**
 * Browserbase + Stagehand session helper. Runs a cloud Chrome (Browserbase) so
 * the Trigger task drives a real browser over CDP — no local Chromium. Stagehand
 * adds LLM-driven `act`/`observe`/`extract` on top of that browser.
 *
 * AUTH: YouTube actions need a logged-in Google session. The reliable pattern is
 * a Browserbase CONTEXT that you authenticate ONCE (open its live view, log into
 * Google) — then every session reuses it. Set BROWSERBASE_CONTEXT_ID for that.
 * Without it the session is anonymous and channel creation will stop at login.
 *
 * SDK SHAPE (Stagehand 4.x): construction is two-phase and the old
 * `new Stagehand({ env, projectId, browserbaseSessionCreateParams, ... })` +
 * `.init()` pattern is gone (the constructor is private in 4.x).
 *   1. `browserbase.launch(sessionCreateParams)` creates the Browserbase session
 *      and returns a browser handle. Every option the old
 *      `browserbaseSessionCreateParams` carried (projectId, session lifetime,
 *      browserSettings.context) is a top-level field here.
 *   2. `Stagehand.create({ browser, model, logging })` attaches the LLM layer.
 * The live-view session id moved from `stagehand.browserbaseSessionID` to
 * `browser.sessionId`, and the `logger` callback became `logging.onLog`.
 *
 * NOTE: Stagehand 4.x validates `model.modelName` against a closed list of
 * supported provider/model identifiers at create time. An operator-supplied
 * BROWSERBASE_STAGEHAND_MODEL that is not on that list fails inside
 * `Stagehand.create()` rather than being silently ignored.
 *
 * Dynamic import so a missing/heavy dep can never break the Trigger bundle at
 * deploy time — only a task that actually calls this pays the cost.
 */
import { assertNonGeminiModelIdentifier } from "@/lib/gemini";
import type { ModelName } from "@browserbasehq/stagehand";

export interface StagehandRunResult<T> {
  value: T;
  /** Browserbase live-view / replay session id (watch + debug the run). */
  sessionId?: string;
}

/**
 * What `withStagehand()` hands its callback. Deliberately exposes BOTH halves of
 * the 4.x object model, because the callers want different ones:
 *  - `stagehand` — the LLM primitives (`act` / `observe` / `extract`). Used by
 *    the agent step-loop in `src/lib/stagehandAgentLoop.ts`.
 *  - `context`  — the browser context (`newPage`, `addInitScript`,
 *    `setDomainPolicy`, cookies…). `webSearch.ts` uses ONLY this half: it drives
 *    a deterministic Bing scrape with no LLM involvement at all.
 * Both are `unknown` so callers keep casting to the narrow local interface they
 * actually need, exactly as they did against the 3.x shape.
 */
export interface StagehandSession {
  stagehand: unknown;
  context: unknown;
  sessionId?: string;
}

export function hasBrowserbase(): boolean {
  return !!process.env.BROWSERBASE_API_KEY && !!process.env.BROWSERBASE_PROJECT_ID;
}

/**
 * Browser automation is deliberately independent from the sealed thumbnail
 * credential. There is no implicit provider default: an operator must supply
 * a reviewed, non-Google Stagehand model and its own credential.
 */
export function browserbaseStagehandModel(): { model: string; apiKey: string } {
  const model = process.env.BROWSERBASE_STAGEHAND_MODEL?.trim();
  const apiKey = process.env.BROWSERBASE_STAGEHAND_MODEL_API_KEY?.trim();
  if (!model || !apiKey) {
    throw new Error(
      "Browserbase Stagehand requires BROWSERBASE_STAGEHAND_MODEL and " +
        "BROWSERBASE_STAGEHAND_MODEL_API_KEY; Gemini is not permitted outside sealed thumbnails",
    );
  }
  assertNonGeminiModelIdentifier(model, "Browserbase Stagehand model");
  return { model, apiKey };
}

/**
 * Open a Stagehand-on-Browserbase session, run `fn(session)`, and always close
 * it. Returns fn's value plus the Browserbase session id for the live view.
 */
export async function withStagehand<T>(
  fn: (session: unknown) => Promise<T>,
  log: (m: string, x?: Record<string, unknown>) => void = () => {},
): Promise<StagehandRunResult<T>> {
  if (!hasBrowserbase()) {
    throw new Error("Browserbase not configured (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID)");
  }
  // Resolve (and Gemini-gate) the model BEFORE anything opens a browser or a
  // paid session. A refused provider must never reach Browserbase or `fn`.
  const model = browserbaseStagehandModel();
  const { browserbase, Stagehand } = await import("@browserbasehq/stagehand");

  const contextId = process.env.BROWSERBASE_CONTEXT_ID;
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    // Long enough for a multi-step create flow (default Browserbase timeout is
    // short and was killing the session mid-run). The current SDK names this
    // session-lifetime field `api_timeout`; preserve the existing env setting.
    api_timeout: Number(process.env.BROWSERBASE_SESSION_TIMEOUT ?? 1800),
    // Reuse the authenticated context (persisted Google login) when provided.
    ...(contextId
      ? { browserSettings: { context: { id: contextId, persist: true } } }
      : {}),
  });

  const sessionId = browser.sessionId;
  let stagehand: Awaited<ReturnType<typeof Stagehand.create>>;
  try {
    stagehand = await Stagehand.create({
      browser,
      // A separately configured non-Google model; never reuse the thumbnail key.
      // The cast is deliberate: the identifier is operator-supplied and is
      // validated by our own non-Gemini gate above, then by Stagehand at create.
      model: { modelName: model.model as ModelName, apiKey: model.apiKey },
      // Route Stagehand logs through OUR logger instead of its own stdout
      // writer, so browser-automation noise lands in the task log stream.
      logging: {
        level: "info",
        onLog: (entry) => {
          log("stagehand", {
            level: entry?.level,
            msg: typeof entry?.message === "string" ? entry.message.slice(0, 300) : undefined,
          });
        },
      },
    });
  } catch (error) {
    // The session is already billing at this point; never leak it on a failed
    // attach (e.g. an unsupported model identifier).
    try {
      await browser.close();
    } catch {
      /* ignore close errors */
    }
    throw error;
  }

  log("browserbase: session started", {
    sessionId,
    liveView: sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined,
    authed: Boolean(contextId),
  });
  try {
    const value = await fn({ stagehand, context: browser.context, sessionId } satisfies StagehandSession);
    return { value, sessionId };
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore close errors */
    }
    try {
      await browser.close();
    } catch {
      /* ignore close errors */
    }
  }
}
