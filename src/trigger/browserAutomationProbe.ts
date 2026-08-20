import { task } from "@trigger.dev/sdk";
import { withStagehand, type StagehandSession } from "@/lib/browserbase";
import { runStagehandAgentLoop, type StagehandActor } from "@/lib/stagehandAgentLoop";
import { bootstrapSecrets } from "@/lib/bootstrap";

interface ProbePage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}
interface ProbeContext {
  newPage(url?: string): Promise<ProbePage>;
  addInitScript(script: () => void): Promise<void>;
  setDomainPolicy(policy: { allowedDomains?: string[] } | null): Promise<void>;
}

/**
 * Post-migration rollout probe for the Stagehand 3.x -> 4.x rewrite
 * (browserbase.ts construction, stagehandAgentLoop.ts, and the
 * addInitScript/setDomainPolicy primitives installYoutubeRecoveryGuards()
 * depends on). Verified only statically (tsc/eslint/mocked unit tests)
 * before this probe existed -- this is the first REAL runtime check.
 *
 * Deliberately touches ONLY https://example.com and https://httpbin.org.
 * It never navigates to google.com/youtube.com, calls no YouTube/Convex/
 * publishing API, creates no channel, and uses no OAuth or account
 * credential. Kept permanently (like convex-auth-probe.ts) as a reusable
 * health check for this browser-automation layer, not a throwaway.
 */
export const browserAutomationProbeTask = task({
  id: "browser-automation-probe",
  machine: "small-1x",
  maxDuration: 180,
  retry: { maxAttempts: 1 },
  run: async () => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[browser-probe] ${m}`, x ?? "");
    const loadedKeys = await bootstrapSecrets(log);
    const results: Record<string, unknown> = {
      bootstrap: {
        loadedCount: loadedKeys.length,
        loadedKeys,
        hasOpenRouterAfterHydrate: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      },
    };

    try {
      const { value } = await withStagehand(async (sessionU) => {
        const session = sessionU as StagehandSession;
        const context = session.context as ProbeContext;
        const stagehand = session.stagehand as StagehandActor;

        // 1. Real page navigation via the new construction's context handle
        //    (the exact primitive webSearch.ts depends on).
        const page = await context.newPage("https://example.com");
        const title = await page.evaluate(() => document.title);
        results.constructionAndNavigation = { ok: true, title };
        log("construction + navigation ok", { title });

        // 2. addInitScript / setDomainPolicy actually exist and execute in a
        //    REAL 4.x session -- the primitive installYoutubeRecoveryGuards()
        //    depends on, previously only proven against stand-in globals in
        //    a unit test, never against the real SDK surface.
        let initScriptRan = false;
        await context.setDomainPolicy({ allowedDomains: ["example.com", "www.example.com", "httpbin.org"] });
        await context.addInitScript(() => {
          (window as unknown as Record<string, unknown>).__probeInitScriptRan = true;
        });
        const page2 = await context.newPage("https://example.com");
        initScriptRan = await page2.evaluate(
          () => Boolean((window as unknown as Record<string, unknown>).__probeInitScriptRan),
        );
        results.guardPrimitives = { ok: initScriptRan };
        log("guard primitives ok", { initScriptRan });

        // 3. The exact vector installYoutubeRecoveryGuards() patches: a real
        //    in-page fetch() call, on a real page, after a real addInitScript
        //    ran. Proves the patch mechanism itself (not just its logic in
        //    isolation) works against the live 4.x DOM/JS environment.
        const page3 = await context.newPage("https://httpbin.org/get");
        await page3.evaluate(() => {
          (window as unknown as { __probeBlockedFetch?: typeof fetch }).__probeBlockedFetch = window.fetch;
          const native = window.fetch.bind(window);
          window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            if (method.toUpperCase() !== "GET") {
              return Promise.reject(new DOMException("blocked by probe", "SecurityError"));
            }
            return native(input, init);
          }) as typeof window.fetch;
        });
        const blockedResult = await page3.evaluate(async () => {
          try {
            await fetch("https://httpbin.org/post", { method: "POST" });
            return "NOT_BLOCKED";
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        });
        const allowedResult = await page3.evaluate(async () => {
          const res = await fetch("https://httpbin.org/get");
          return res.status;
        });
        results.fetchPatchLiveBehavior = {
          blockedPostRejected: blockedResult !== "NOT_BLOCKED",
          blockedPostMessage: blockedResult,
          allowedGetStatus: allowedResult,
        };
        log("fetch patch live behavior", results.fetchPatchLiveBehavior as Record<string, unknown>);

        // 4. The full observe -> LLM decision -> act loop against a real,
        //    harmless, independently-verifiable goal. Proves stagehandAgentLoop.ts
        //    actually drives stagehand.observe()/act() and calls OpenRouter
        //    correctly end to end, not just that it type-checks.
        const loopResult = await runStagehandAgentLoop(
          stagehand,
          'On this page (example.com), click the link with the text "More information...".',
          { maxSteps: 5, log },
        );
        results.agentLoop = {
          completed: loopResult.completed,
          success: loopResult.success,
          steps: loopResult.steps,
          message: loopResult.message,
          history: loopResult.history,
        };
        log("agent loop finished", { completed: loopResult.completed, steps: loopResult.steps });

        return results;
      }, log);

      return { ok: true, results: value };
    } catch (error) {
      // Diagnostic-first: a mid-probe failure still returns everything
      // gathered so far (in particular the bootstrap key-loading result),
      // rather than losing it to a thrown error with no return value.
      results.failedAt = error instanceof Error ? error.message : String(error);
      return { ok: false, results };
    }
  },
});
