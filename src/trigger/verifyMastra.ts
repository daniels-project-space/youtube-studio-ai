/**
 * `verify-mastra` — verifies the Mastra agent stack ACTUALLY WORKS inside the
 * Trigger image, not merely that it imports. The old probe (import + construct
 * + typeof generate) passed while (a) @mastra/observability was missing —
 * tracing silently dead — and (b) any generate()-options API drift would have
 * pushed every agentJson call to the REST fallback forever (mastraDisabled
 * latches per process). This probe:
 *   1. imports ALL three packages the runtime path touches,
 *   2. runs ONE real structured generate through agentJson's exact code path
 *      (cheap flash call; requires GEMINI_API_KEY from the vault),
 *   3. asserts the structured object came back.
 */
import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { bootstrapSecrets } from "@/lib/bootstrap";

export const verifyMastraTask = task({
  id: "verify-mastra",
  machine: "small-1x",
  maxDuration: 300,
  run: async () => {
    const imports: Record<string, string> = {};
    for (const pkg of ["@mastra/core", "@mastra/langfuse", "@mastra/observability"]) {
      try {
        await import(pkg);
        imports[pkg] = "ok";
      } catch (e) {
        imports[pkg] = `FAILED: ${e instanceof Error ? e.message.slice(0, 120) : e}`;
      }
    }

    // Real structured-output round trip through the SAME path production uses.
    await bootstrapSecrets((m) => console.log(`[verify-mastra] ${m}`), { required: ["GEMINI_API_KEY"] });
    const { agentJson } = await import("@/agents/mastra");
    let generate: { ok: boolean; detail: string } = { ok: false, detail: "not run" };
    // agentJson quietly falls back to REST when the Mastra path breaks — the
    // exact failure this probe exists to expose. Capture its logs to tell
    // "Mastra worked" apart from "REST papered over a broken Mastra".
    const probeLogs: string[] = [];
    try {
      const out = await agentJson({
        role: "producer",
        schema: z.object({ answer: z.number() }),
        prompt: "What is 2+2? Return JSON {\"answer\": number}.",
        maxTokens: 100,
        log: (m: string) => probeLogs.push(m),
      });
      const viaRest = probeLogs.some((l) => /REST fallback|falling back to REST/i.test(l));
      generate =
        (out as { answer?: number }).answer === 4
          ? viaRest
            ? { ok: false, detail: `answer ok but via REST FALLBACK (Mastra path broken): ${probeLogs.join(" | ").slice(0, 250)}` }
            : { ok: true, detail: "structured generate round-trip ok (Mastra path)" }
          : { ok: false, detail: `unexpected object: ${JSON.stringify(out).slice(0, 120)}` };
    } catch (e) {
      generate = { ok: false, detail: `agentJson threw: ${e instanceof Error ? e.message.slice(0, 200) : e}` };
    }

    const core = imports["@mastra/core"] === "ok";
    const result = {
      // ok = the parts production DEPENDS on work; missing tracing is reported
      // but doesn't fail the probe (it's optional by design — just no longer silent).
      ok: core && generate.ok,
      imports,
      generate,
    };
    console.log("[verify-mastra]", JSON.stringify(result));
    if (!result.ok) throw new Error(`verify-mastra FAILED: ${JSON.stringify(result)}`);
    return result;
  },
});
