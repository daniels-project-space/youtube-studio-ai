import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalYouTubeKey = process.env.YOUTUBE_API_KEY;
const creativePrompts: string[] = [];

loader._load = function patchedLoad(request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved,
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      creativePrompts.push(prompt);
      if (prompt.includes("pinned comment")) return { comment: "Which aqueduct detail surprised you?" };
      if (prompt.includes("description + tags")) return { description: "Roman aqueducts moved water across mountains.", tagsCsv: "roman,aqueduct,water,engineering,history" };
      if (prompt.startsWith("You are a YouTube CTR strategist")) {
        return {
          rankings: [{
            idx: 0,
            clickScore: 9,
            direct: 9,
            identityFit: 9,
            viewerMotivation: 9,
            grounding: "supported",
            reason: "The title precisely names the demonstrated engineering result.",
          }],
        };
      }
      return { candidates: [{ frame: "mechanism", title: "Roman Aqueducts Moved Water Across Mountains" }] };
    },
  };
};

async function main(): Promise<void> {
  try {
    process.env.YOUTUBE_API_KEY = "fixture-key-proves-a-duplicate-search-would-be-possible";
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://suggestqueries.google.com/")) return Response.json(["", []]);
      throw new Error(`unexpected network request: ${url}`);
    };

    const { craftMetadata } = await import("@/lib/metacraft");
    const result = await craftMetadata({
      topic: "Roman aqueduct engineering",
      niche: "history",
      narrationText: "Roman aqueducts moved water across mountains using carefully graded channels.",
      competitorTitles: [],
    });

    assert.equal(result.title, "Roman Aqueducts Moved Water Across Mountains");
    assert.equal(
      requestedUrls.filter((url) => url.includes("www.googleapis.com/youtube/v3/")).length,
      0,
      "an explicit upstream no-results competitor feed must not trigger a duplicate YouTube search",
    );
    assert.equal(
      requestedUrls.filter((url) => url.startsWith("https://suggestqueries.google.com/")).length,
      1,
      "independent autocomplete evidence remains available",
    );
    assert.ok(
      creativePrompts.some((prompt) => prompt.includes('FORMAT PROFILE "searchable_long"')),
      "standalone metacraft callers must resolve a format profile from channel context",
    );
    console.log("METACRAFT EXPLICIT EMPTY FEED PASS — upstream no-results reuse avoids duplicate YouTube quota");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
    if (originalYouTubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalYouTubeKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
