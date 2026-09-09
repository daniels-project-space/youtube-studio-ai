import assert from "node:assert/strict";
import { claudeJson } from "@/lib/anthropic";
import { createModelUsageScope } from "@/lib/modelUsage";
import {
  openRouterChat, openRouterModel, openRouterProviderPreferences, type OpenRouterJsonSchema,
} from "@/lib/openRouter";
import { judgeTitleCandidates } from "@/lib/metacraft";

const schema: OpenRouterJsonSchema = {
  name: "test_outcome", strict: true,
  schema: { type: "object", properties: { answer: { type: "string", enum: ["a", "b"] } }, required: ["answer"], additionalProperties: false },
};
type RequestBody = {
  model: string; messages: { content: string }[];
  response_format?: { type: string; json_schema?: OpenRouterJsonSchema };
  provider: unknown;
};
async function main() {
  const savedKey = process.env.OPENROUTER_API_KEY;
  const savedFetch = globalThis.fetch;
  const requests: RequestBody[] = [];
  let response: unknown = { answer: "a" };
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-key";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as RequestBody;
      requests.push(body);
      return Response.json({ id: "fixture-" + requests.length, model: body.model,
        choices: [{ message: { content: JSON.stringify(response) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    };
    const scope = createModelUsageScope();
    await scope.run(async () => {
      await claudeJson({ prompt: "same prompt" });
      await claudeJson({ prompt: "same prompt" });
      assert.equal(requests.length, 1, "default callers retain ordinary memoization");
      assert.deepEqual(requests[0].response_format, { type: "json_object" });
      await claudeJson({ prompt: "same prompt", jsonSchema: schema });
      await claudeJson({ prompt: "same prompt", jsonSchema: structuredClone(schema) });
      assert.equal(requests.length, 2, "equal explicit schemas share the correct cache entry");
      assert.deepEqual(requests[1].response_format, { type: "json_schema", json_schema: schema });
      await claudeJson({ prompt: "same prompt", jsonSchema: { ...schema, name: "different_name" } });
      await claudeJson({ prompt: "same prompt", jsonSchema: { ...schema, schema: { ...schema.schema, description: "different exact contract" } } });
      assert.equal(requests.length, 4, "name and exact schema participate in memo identity");
    });
    assert.equal(scope.snapshot().calls, 4);
    assert.equal(scope.snapshot().cacheHits, 2);
    assert.ok(scope.snapshot().costUsd > 0);
    const mutable = structuredClone(schema) as { name: string; strict: true; schema: Record<string, import("@/lib/openRouter").JsonSchemaValue> };
    const mutationScope = createModelUsageScope();
    await mutationScope.run(async () => {
      const pending = claudeJson({ prompt: "mutation isolation", jsonSchema: mutable });
      mutable.schema.description = "changed after invocation";
      await pending;
      assert.deepEqual(requests.at(-1)!.response_format?.json_schema, schema, "memo identity and HTTP use one immutable schema snapshot");
      const count = requests.length;
      await claudeJson({ prompt: "mutation isolation", jsonSchema: mutable });
      assert.equal(requests.length, count + 1, "later changed schema is a distinct request");
    });
    for (const body of requests) {
      assert.equal(body.model, openRouterModel("intelligence"));
      assert.deepEqual(body.provider, openRouterProviderPreferences(body.model), "approved providers/privacy/fallback routing is unchanged");
      assert.equal((body.provider as { require_parameters: boolean }).require_parameters, true);
      assert.ok(!("plugins" in body), "no response-healing or other plugin is introduced");
    }
    await openRouterChat({ model: openRouterModel("intelligence"), messages: [{ role: "user", content: "plain text request" }], maxTokens: 100 });
    assert.equal(requests.at(-1)!.response_format, undefined, "plain text clients retain no response_format");
    const before = requests.length;
    for (const invalid of [null, { ...schema, strict: false }, { ...schema, name: "bad name" }, { ...schema, schema: [] }]) {
      await assert.rejects(() => claudeJson({ prompt: "invalid schema", jsonSchema: invalid as unknown as OpenRouterJsonSchema }), /strict JSON schema/);
    }
    assert.equal(requests.length, before, "invalid envelope is rejected before HTTP dispatch");
    response = { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: "unsupported", reason: "not established" }] };
    const args = { topic: "A bridge design lesson", channelName: "Engineering Desk", persona: "Careful source-led teaching",
      scriptExcerpt: "This lesson explains why engineers inspect bridges.", suggestions: [], competitorTitles: [] };
    const judgeBefore = requests.length;
    await assert.rejects(() => judgeTitleCandidates(args, []), /at least one candidate/);
    assert.equal(requests.length, judgeBefore, "empty candidate lists cannot send an invalid bounded schema");
    await assert.rejects(() => judgeTitleCandidates(args, [{ frame: "neutral", title: "Why Engineers Inspect Aging Bridges" }]), /malformed/);
    assert.equal(requests.length, judgeBefore + 1, "provider schema noncompliance is not coerced or automatically retried");
    const judgeRequest = requests.at(-1)!;
    assert.equal(judgeRequest.response_format?.type, "json_schema");
    const judgeSchema = judgeRequest.response_format!.json_schema!;
    assert.equal(judgeSchema.strict, true);
    assert.equal(judgeSchema.name, "title_judgment_v1");
    const rankings = (judgeSchema.schema.properties as Record<string, { minItems: number; maxItems: number; items: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }>).rankings;
    assert.equal(rankings.minItems, 1);
    assert.equal(rankings.maxItems, 1);
    assert.deepEqual(rankings.items.properties.idx, { type: "integer", minimum: 0, maximum: 0 });
    assert.deepEqual((rankings.items.properties.grounding as { enum: string[] }).enum, ["supported", "contradicted", "insufficient"]);
    assert.deepEqual(rankings.items.properties.identityFit, { type: "number", minimum: 0, maximum: 10 });
    assert.equal(rankings.items.additionalProperties, false);
    assert.deepEqual(rankings.items.required, ["idx", "clickScore", "direct", "identityFit", "grounding", "reason"]);
    const prompt = judgeRequest.messages.at(-1)!.content;
    assert.ok(prompt.includes("explicit channel persona, format, language and title formula govern register"));
    assert.ok(prompt.includes("Missing, unestablished or unresolved evidence is insufficient"));
    assert.ok(prompt.includes("Interpret recognizable metaphor or personification"));
    assert.ok(prompt.includes("IdentityFit 7 means suitable"));
    assert.ok(prompt.includes("separate identity judgment, not factual contradiction"));
    console.log("Optional structured output routing/cache/default compatibility and strict title judge contract passed");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
