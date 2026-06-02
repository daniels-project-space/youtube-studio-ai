/**
 * `verify-mastra` — cheap cloud check that the Mastra agent stack LOADS and
 * instantiates inside the Trigger image (the bundling risk). No LLM call, no
 * keys needed — just import + construct.
 */
import { task } from "@trigger.dev/sdk";

export const verifyMastraTask = task({
  id: "verify-mastra",
  machine: "small-1x",
  maxDuration: 120,
  run: async () => {
    const { Mastra } = await import("@mastra/core");
    const { Agent } = await import("@mastra/core/agent");
    const a = new Agent({
      id: "probe",
      name: "probe",
      instructions: "probe",
      model: "google/gemini-2.5-flash",
    });
    const m = new Mastra({ agents: { probe: a } } as ConstructorParameters<typeof Mastra>[0]);
    const result = {
      ok: true,
      hasGenerate: typeof a.generate === "function",
      hasGetAgent: typeof m.getAgent === "function",
    };
    console.log("[verify-mastra]", result);
    return result;
  },
});
