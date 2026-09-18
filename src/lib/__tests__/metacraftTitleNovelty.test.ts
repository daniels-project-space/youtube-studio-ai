import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved,
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("pinned comment")) return { comment: "Which design detail surprised you?" };
      if (prompt.includes("description + tags")) return { description: "Roman aqueducts solved a mountain problem.", tagsCsv: "rome,aqueducts,engineering" };
      if (prompt.startsWith("You are a YouTube CTR strategist")) {
        assert.doesNotMatch(prompt, /Why Roman Aqueducts Changed City Life/, "history collision must never reach the paid judge");
        return {
          rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, viewerMotivation: 9, grounding: "supported", reason: "Specific, source-bound alternative." }],
          winner: 0,
          runnerUp: 0,
        };
      }
      return {
        candidates: [
          { frame: "repeat", title: "Why Roman Aqueducts Changed City Life" },
          { frame: "mechanism", title: "Roman Aqueducts Solved a Mountain Problem" },
        ],
      };
    },
  };
};

const originalFetch = global.fetch;
global.fetch = async () => Response.json(["", []]);

async function main(): Promise<void> {
  try {
    const { craftMetadata, matchingRecentChannelTitle } = await import("@/lib/metacraft");
    assert.equal(
      matchingRecentChannelTitle("Why Roman Aqueducts Changed City Life", ["Roman Aqueducts Changed City Life"]),
      "Roman Aqueducts Changed City Life",
      "harmless question-prefix rewrites must not repeat a released title",
    );
    assert.equal(
      matchingRecentChannelTitle("Roman Aqueducts Changed Military Logistics", ["Roman Aqueducts Changed City Life"]),
      null,
      "a materially different promise about the same subject must remain eligible",
    );
    assert.equal(matchingRecentChannelTitle("A new title", []), null);
    const result = await craftMetadata({
      topic: "Roman aqueduct engineering",
      channelName: "Water Archive",
      niche: "history",
      narrationText: "Roman aqueducts solved a mountain problem by carrying water across difficult terrain.",
      coldOpen: "Roman aqueducts solved a mountain problem before the city ran dry.",
      recentChannelTitles: ["Roman Aqueducts Changed City Life"],
    });
    assert.equal(result.title, "Roman Aqueducts Solved a Mountain Problem");
    assert.deepEqual(result.titleDecision.titleHistory, { considered: 1, rejectedCandidateCount: 1 });
    assert.equal(result.titleDecision.candidates.length, 1, "only a novel candidate may enter ranking");
    console.log("METACRAFT TITLE NOVELTY PASS — persisted-history collision rejected without blocking a distinct same-subject title");
  } finally {
    loader._load = originalLoad;
    global.fetch = originalFetch;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
