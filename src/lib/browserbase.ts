/**
 * Browserbase + Stagehand session helper. Runs a cloud Chrome (Browserbase) so
 * the Trigger task drives a real browser over CDP — no local Chromium. Stagehand
 * adds LLM-driven `act`/`extract` on top of Playwright.
 *
 * AUTH: YouTube actions need a logged-in Google session. The reliable pattern is
 * a Browserbase CONTEXT that you authenticate ONCE (open its live view, log into
 * Google) — then every session reuses it. Set BROWSERBASE_CONTEXT_ID for that.
 * Without it the session is anonymous and channel creation will stop at login.
 *
 * Dynamic import so a missing/heavy dep can never break the Trigger bundle at
 * deploy time — only a task that actually calls this pays the cost.
 */
import { assertNonGeminiModelIdentifier } from "@/lib/gemini";

export interface StagehandRunResult<T> {
  value: T;
  /** Browserbase live-view / replay session id (watch + debug the run). */
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
 * Open a Stagehand-on-Browserbase session, run `fn(page)`, and always close it.
 * Returns fn's value plus the Browserbase session id for the live view.
 */
export async function withStagehand<T>(
  fn: (stagehand: unknown) => Promise<T>,
  log: (m: string, x?: Record<string, unknown>) => void = () => {},
): Promise<StagehandRunResult<T>> {
  if (!hasBrowserbase()) {
    throw new Error("Browserbase not configured (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID)");
  }
  const model = browserbaseStagehandModel();
  const { Stagehand } = (await import("@browserbasehq/stagehand")) as unknown as {
    Stagehand: new (opts: Record<string, unknown>) => {
      init: () => Promise<unknown>;
      close: () => Promise<void>;
      browserbaseSessionID?: string;
    };
  };

  const contextId = process.env.BROWSERBASE_CONTEXT_ID;
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    // A separately configured non-Google model; never reuse the thumbnail key.
    modelName: model.model,
    modelClientOptions: { apiKey: model.apiKey },
    // Route Stagehand logs through OUR logger so it never spins up pino-pretty
    // (that transport isn't in the Trigger image → "unable to determine transport").
    verbose: 0,
    logger: (line: unknown) => {
      const l = line as { message?: string; category?: string } | string;
      log("stagehand", { msg: typeof l === "string" ? l : `${l.category ?? ""} ${l.message ?? ""}`.trim() });
    },
    browserbaseSessionCreateParams: {
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      // Long enough for a multi-step create flow (default Browserbase timeout is
      // short and was killing the session mid-run).
      timeout: Number(process.env.BROWSERBASE_SESSION_TIMEOUT ?? 1800),
      // Reuse the authenticated context (persisted Google login) when provided.
      ...(contextId
        ? { browserSettings: { context: { id: contextId, persist: true } } }
        : {}),
    },
  });

  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  log("browserbase: session started", {
    sessionId,
    liveView: sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined,
    authed: Boolean(contextId),
  });
  try {
    const value = await fn(stagehand);
    return { value, sessionId };
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore close errors */
    }
  }
}
