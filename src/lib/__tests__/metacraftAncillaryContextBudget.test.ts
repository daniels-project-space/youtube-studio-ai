import assert from "node:assert/strict";
import Module from "node:module";

/**
 * The title generator and semantic judge still receive the complete source,
 * but the post-selection description/comment calls do not need to repeat a
 * very long narration. This test pins that split and measures the bounded
 * prompt payload rather than relying on a provider response.
 */
const prompts: string[] = [];
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;

loader._load = function patchedLoad(request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved,
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      if (prompt.includes("pinned comment")) return { comment: "Which detail changed your view?" };
      if (prompt.includes("description + tags")) return {
        description: "Roman aqueducts moved water across mountains.",
        tagsCsv: "roman,aqueduct,water,engineering,history",
      };
      if (prompt.startsWith("You are a YouTube CTR strategist")) return {
        rankings: [{
          idx: 0,
          clickScore: 9,
          direct: 9,
          identityFit: 9,
          viewerMotivation: 9,
          grounding: "supported",
          reason: "The candidate states the demonstrated engineering result.",
        }],
      };
      return { candidates: [{ frame: "mechanism", title: "Roman Aqueducts Moved Water Across Mountains" }] };
    },
  };
};

function contextFrom(prompt: string): { source?: { text?: string } } {
  const json = prompt.split("VIDEO CONTEXT JSON:\n")[1]?.split("\nEND VIDEO CONTEXT")[0];
  assert.ok(json, "creative consumer should receive the shared context envelope");
  return JSON.parse(json) as { source?: { text?: string } };
}

async function main(): Promise<void> {
  try {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /^https:\/\/suggestqueries\.google\.com\//);
      return Response.json(["", []]);
    };
    const { ANCILLARY_SOURCE_CHAR_BUDGET, craftMetadata } = await import("../metacraft");
    const source = (
      "Roman aqueducts moved water across mountains using carefully graded channels. " +
      "A late source detail preserves the exact episode context. "
    ).repeat(2_000);
    assert.ok(source.length > ANCILLARY_SOURCE_CHAR_BUDGET * 2, "fixture must exercise compaction");

    const result = await craftMetadata({
      topic: "Roman aqueduct engineering",
      channelName: "Water Archive",
      niche: "history",
      narrationText: source,
      competitorTitles: [],
    });
    assert.equal(result.title, "Roman Aqueducts Moved Water Across Mountains");

    const sourceTexts = prompts.map((prompt) => contextFrom(prompt).source?.text ?? "");
    assert.equal(sourceTexts.length, 4, "one generation, judge, package and comment call is expected");
    assert.equal(sourceTexts.filter((text) => text === source).length, 2,
      "title generation and semantic judging retain the complete source");
    const compact = sourceTexts.filter((text) => text !== source);
    assert.equal(compact.length, 2, "only ancillary calls should use the compact source");
    for (const text of compact) {
      assert.ok(text.length <= ANCILLARY_SOURCE_CHAR_BUDGET, "ancillary source must stay inside its hard character budget");
      assert.match(text, /middle of narration omitted for ancillary packaging/);
      assert.ok(text.startsWith(source.slice(0, 100)), "compact source retains the opening hook");
      assert.ok(text.endsWith(source.slice(-100)), "compact source retains the closing context");
    }
    const oldSourceChars = source.length * sourceTexts.length;
    const newSourceChars = sourceTexts.reduce((total, text) => total + text.length, 0);
    assert.ok(newSourceChars < oldSourceChars * 0.6,
      `ancillary compaction should cut repeated source payload materially (${newSourceChars}/${oldSourceChars})`);
    console.log(`METACRAFT ANCILLARY CONTEXT PASS — ${oldSourceChars - newSourceChars} source chars avoided across package/comment calls`);
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
