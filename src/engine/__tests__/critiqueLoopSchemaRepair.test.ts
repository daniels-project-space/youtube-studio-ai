import assert from "node:assert/strict";
import { z } from "zod";
import { produceAndCritique } from "../critiqueLoop";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { completedGenerationRepairIssues } from "@/agents/mastra";

async function main(): Promise<void> {
  const schema = z.object({ instrumentation: z.array(z.string()) });
  let produced = 0, judged = 0;
  const result = await produceAndCritique({
    maxIters: 2, repairOutputErrors: completedGenerationRepairIssues,
    produce: async issues => {
      produced++;
      if (produced === 1) return schema.parse({ instrumentation: "felt piano" });
      assert.match(issues.join(" "), /instrumentation.*array/);
      return schema.parse({ instrumentation: ["felt piano"] });
    },
    critique: async () => { judged++; return { score: 1, pass: true, issues: [] }; },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.iterations, 2);
  assert.equal(result.history[0]?.fatal, true);
  assert.equal(judged, 1, "a malformed draft must not purchase a critic call");

  produced = 0;
  await assert.rejects(produceAndCritique({
    maxIters: 2, repairOutputErrors: completedGenerationRepairIssues,
    produce: async () => { produced++; return schema.parse({ instrumentation: "still invalid" }); },
    critique: async () => { throw new Error("invalid values cannot reach critic"); },
  }), z.ZodError);
  assert.equal(produced, 2, "repair shares the original iteration budget");

  produced = 0;
  const uncertain = new OpenRouterGenerationOutcomeUnknownError("no recoverable output");
  await assert.rejects(produceAndCritique({
    maxIters: 2, repairOutputErrors: completedGenerationRepairIssues,
    produce: async () => { produced++; throw uncertain; },
    critique: async () => ({ score: 1, pass: true, issues: [] }),
  }), error => error === uncertain);
  assert.equal(produced, 1, "schema repair never replays uncertain paid work");
  produced = 0;
  const jsonRepaired = await produceAndCritique({
    maxIters: 2, repairOutputErrors: completedGenerationRepairIssues,
    produce: async issues => {
      produced++;
      if (produced === 1) throw new OpenRouterGenerationOutcomeUnknownError("completed truncated JSON", { outcome: "consumed_unusable" });
      assert.match(issues.join(" "), /not valid JSON/);
      return { instrumentation: ["felt piano"] };
    },
    critique: async () => ({ score: 1, pass: true, issues: [] }),
  });
  assert.equal(jsonRepaired.accepted, true);
  assert.equal(produced, 2, "known completed invalid JSON can use the remaining planned attempt");
  produced = 0;
  const exhausted = await produceAndCritique({
    maxIters: 2, repairOutputErrors: completedGenerationRepairIssues,
    produce: async () => {
      if (++produced === 2) return schema.parse({ instrumentation: "invalid second draft" });
      return { instrumentation: ["felt piano"] };
    },
    critique: async () => ({ score: 0.6, pass: false, issues: ["Needs a distinctive phrase."] }),
  });
  assert.equal(exhausted.accepted, false, "a repair failure cannot promote a rejected prior draft");
  assert.deepEqual(exhausted.value.instrumentation, ["felt piano"]);
  assert.equal(exhausted.critique.score, 0.6, "the valid prior value keeps its own verdict, not the schema-error verdict");
  console.log("CRITIQUE SCHEMA REPAIR PASS - bounded completed-output repair, no invalid critic call or uncertain replay");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
