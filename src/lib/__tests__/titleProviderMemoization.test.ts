import assert from "node:assert/strict";
import { craftMetadata } from "@/lib/metacraft";
import { createModelUsageScope } from "@/lib/modelUsage";

const title = "47 Engineers Died in the Bridge Collapse";
const args = { topic: "Bridge collapse", channelName: "Field Notes", scriptExcerpt: "The bridge collapse killed 47 engineers.", suggestions: [], competitorTitles: [] };
async function main() {
  process.env.OPENROUTER_API_KEY = "fixture-only-key";
  for (const invalidPhase of ["package", "judge"] as const) {
    const calls = { generator: 0, judge: 0, package: 0, comment: 0 };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      const prompt = body.messages.at(-1).content as string;
      const phase = prompt.startsWith("Write SEVEN") ? "generator" : prompt.startsWith("You are") ? "judge" : prompt.startsWith("Write the YouTube") ? "package" : "comment";
      calls[phase]++;
      const value = phase === invalidPhase && calls[phase] === 1 ? {} :
        phase === "generator" ? { candidates: [{ frame: "direct_verdict", title }] } :
        phase === "judge" ? { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "The source explicitly says47 engineers died" }] } :
        phase === "package" ? { description: "The bridge failure explained.", tagsCsv: "bridge,collapse,engineers,design,history" } :
        { comment: "Which safety decision mattered?" };
      return Response.json({ id: "fixture-" + phase + calls[phase], model: body.model,
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
    };
    const scope = createModelUsageScope();
    const result = await scope.run(() => craftMetadata(args));
    assert.equal(result.title, title);
    assert.equal(calls[invalidPhase], 2, "a deliberate schema-repair attempt must reach the provider, not replay invalid parsed JSON");
    assert.equal(calls.generator, invalidPhase === "package" ? 1 : 2);
    assert.equal(calls.comment, 1);
    const usage = scope.snapshot();
    assert.equal(usage.calls, Object.values(calls).reduce((sum, count) => sum + count, 0), "all rejected and accepted HTTP purchases remain accounted");
    assert.ok(usage.costUsd > 0);
    assert.equal(usage.unpricedCalls, 0);
  }
  console.log("Real OpenRouter HTTP/parser/memo/usage title retry integration passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
