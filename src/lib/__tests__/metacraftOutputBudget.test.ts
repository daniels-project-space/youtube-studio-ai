import assert from "node:assert/strict";
import Module from "node:module";

// Offline request/contract regression. The 20261025-02 provider receipts show
// title generation used 2,397 reasoning tokens and packaging used 1,340;
// both ended with finishReason=length. This is not a live quality proof.
const title = "Roman Aqueducts Moved Water Across Mountains";
type Mode = "valid" | "bad-generator" | "bad-judge" | "bad-package";
let mode: Mode = "valid";
const calls: string[] = [];
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;

loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return {
    ...resolved,
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt, maxTokens }: { prompt: string; maxTokens: number }) => {
      if (prompt.includes("description + tags")) {
        calls.push("package");
        assert.equal(maxTokens, 2500, "package must budget for reasoning plus the concise two-field answer");
        if (mode === "bad-package") return { description: "Incomplete package." };
        return { description: "Roman aqueducts moved water across mountains.", tagsCsv: "roman,aqueduct,water,engineering,history" };
      }
      if (prompt.startsWith("You are a YouTube CTR strategist")) {
        calls.push("judge");
        assert.equal(maxTokens, 2500, "the successful judge budget stays unchanged");
        if (mode === "bad-judge") return { rankings: [] };
        return { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9,
          viewerMotivation: 9, grounding: "supported", reason: "The source describes water crossing mountains." }] };
      }
      calls.push("generator");
      assert.equal(maxTokens, 4000, "title generation needs answer headroom beyond the measured 2,397 reasoning tokens");
      if (mode === "bad-generator") throw new SyntaxError("Unterminated JSON string");
      return { candidates: [{ frame: "mechanism", title }] };
    },
  };
};

async function main(): Promise<void> {
  try {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /^https:\/\/suggestqueries\.google\.com\//);
      return Response.json(["", []]);
    };
    const { craftMetadata } = await import("../metacraft");
    const craft = () => craftMetadata({
      topic: "Roman aqueduct engineering", narrationText: "Roman aqueducts moved water across mountains.",
      competitorTitles: [],
    });
    const output = await craft();
    assert.deepEqual(calls, ["generator", "judge", "package"], "adequate budgets require no repair calls");
    assert.equal(output.packageFallback, false);
    assert.equal(output.judged, true);
    assert.equal(output.titleDecision.attempts, 1);

    mode = "bad-generator";
    calls.length = 0;
    await assert.rejects(craft, /both attempts failed the gate/);
    assert.deepEqual(calls, ["generator", "generator"], "truncated generation cannot reach judging or packaging");

    mode = "bad-judge";
    calls.length = 0;
    await assert.rejects(craft, /both attempts failed the gate/);
    assert.deepEqual(calls, ["generator", "judge", "generator", "judge"], "missing rankings cannot be shipped");

    mode = "bad-package";
    calls.length = 0;
    const fallback = await craft();
    assert.equal(fallback.packageFallback, true, "invalid packaging must remain explicitly degraded");
    assert.equal(fallback.judged, true);
    assert.equal(fallback.title, output.title);
    assert.equal(fallback.titleDecision.fingerprint, output.titleDecision.fingerprint);
    assert.deepEqual(calls, ["generator", "judge", "package"], "package failure cannot restart title selection");
    console.log("metacraft output budgets and rejecting contracts passed (offline)");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
