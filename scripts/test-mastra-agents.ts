import { agentJson } from "@/agents/mastra";
import { z } from "zod";

async function main() {
  let fellBack = false;
  const log = (m: string) => { console.log("  [log]", m); if (/REST fallback|no object/.test(m)) fellBack = true; };

  console.log("--- producer (Gemini via Mastra) ---");
  const prod = await agentJson({
    role: "producer",
    schema: z.object({ candidates: z.array(z.object({ topic: z.string(), angle: z.string().optional().default("") })) }),
    prompt: 'Propose 3 specific video topics for a Stoic philosophy YouTube channel. Return JSON {"candidates":[{"topic":string,"angle":string}]}.',
    maxTokens: 500, temperature: 0.8, log,
  });
  console.log("  => topics:", prod.candidates.map((c) => c.topic));

  console.log("--- director (Claude via Mastra) ---");
  const dir = await agentJson({
    role: "director",
    schema: z.object({ score: z.number().optional(), issues: z.array(z.string()).optional().default([]) }),
    system: "You are a YouTube content critic. Return ONLY JSON.",
    prompt: 'Score 0..1 for a Stoic channel: "Why Marcus Aurelius wrote to himself every night". Return JSON {"score":number,"issues":string[]}.',
    maxTokens: 300, temperature: 0.2, log,
  });
  console.log("  => score:", dir.score, "issues:", dir.issues);

  const ok = prod.candidates.length > 0 && typeof dir.score === "number";
  console.log(`\npath: ${fellBack ? "REST fallback (Mastra did NOT run)" : "Mastra agents"}`);
  console.log(ok ? "MASTRA AGENT TEST PASSED" : "MASTRA AGENT TEST FAILED");
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });
