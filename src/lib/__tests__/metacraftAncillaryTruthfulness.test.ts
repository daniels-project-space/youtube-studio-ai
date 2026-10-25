import assert from "node:assert/strict";
import Module from "node:module";

// Verbatim offending chapter/credit block from live06's accepted description.
const observedBlock = "Chapters:\n00:00 Arrival\n02:15 Letting the Day Settle\n06:30 Gentle Stillness\n25:00 Extended Quiet\n\nVoice, composition, and sound design by A Little Room to Rest.";
const title = "Rest is not a prize for finishing chores";
const cleanDescription = "Leave the unfinished chores for a quiet moment of rest.";
let description = `${cleanDescription}\n\n${observedBlock}`;
let packagePrompt = "";
const calls: string[] = [];
const logs: string[] = [];
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith("/creativeText")) return resolved;
  return { ...resolved, hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("description + tags")) {
        calls.push("package");
        packagePrompt = prompt;
        return { description, tagsCsv: "rest,chores,evening,quiet,reflection" };
      }
      if (prompt.startsWith("You are a YouTube CTR strategist")) {
        calls.push("judge");
        return { rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9,
          viewerMotivation: 9, grounding: "supported", reason: "The source offers rest before chores are finished." }] };
      }
      calls.push("generator");
      return { candidates: [{ frame: "calm experience", title }] };
    } };
};

async function main(): Promise<void> {
  try {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /^https:\/\/suggestqueries\.google\.com\//);
      return Response.json(["", []]);
    };
    const { craftMetadata, buildChapters } = await import("../metacraft");
    const craft = () => craftMetadata({
      topic: "Letting unfinished chores wait", channelName: "A Little Room to Rest", niche: "meditation",
      narrationText: "The chores will keep, but this minute is yours. Rest is not a prize for finishing chores. Leave them unfinished and sit quietly.",
      descriptionStructure: "Opening quote; chapters with timestamps; voice, composition and sound design by the channel; subscribe.",
      competitorTitles: [], log: (message) => logs.push(message),
    });
    const rejected = await craft();
    assert.equal(rejected.packageFallback, true, "live06's invented 25:00 chapter must reject the entire generated package");
    assert.doesNotMatch(rejected.description, /25:00|Voice, composition/);
    assert.notEqual(rejected.description, cleanDescription, "do not strip the bad block and silently accept its remainder");
    assert.equal(rejected.judged, true);
    assert.equal(rejected.title, title);
    assert.deepEqual(calls, ["generator", "judge", "package"], "ancillary rejection cannot rebuy title generation or judging");
    assert.ok(logs.some((line) => /generated chapter timestamps/.test(line)), "fallback must record the actual rejecting cause");
    assert.match(packagePrompt, /style and order only, not factual evidence/);
    assert.match(packagePrompt, /Do not generate chapter timestamps/);
    assert.match(packagePrompt, /buildChapters/);
    assert.match(packagePrompt, /precise runtime claims or production credits/);

    for (const chapter of ["25:00 Extended Quiet", "0:00 Arrival", "1:02:03 Extended Quiet",
      "- 25:00 Extended Quiet", "**25:00** Extended Quiet", "[25:00](https://example.org) Extended Quiet"]) {
      description = `${cleanDescription}\n${chapter}`;
      calls.length = 0;
      const result = await craft();
      assert.equal(result.packageFallback, true, chapter);
      assert.equal(result.description, rejected.description, "replace the whole package with the known fallback");
      assert.equal(result.titleDecision.fingerprint, rejected.titleDecision.fingerprint, "the judged decision survives ancillary rejection");
      assert.deepEqual(calls, ["generator", "judge", "package"]);
    }
    for (const prose of [cleanDescription, "At 1:23 a.m., the source describes an unfinished task."]) {
      description = prose;
      const accepted = await craft();
      assert.equal(accepted.packageFallback, false, "ordinary prose and narrative clock references are not chapter lines");
      assert.equal(accepted.description, prose);
      assert.equal(accepted.titleDecision.fingerprint, rejected.titleDecision.fingerprint);
    }

    // uploadDraft appends buildChapters(chapterPlan) after craftMetadata. Its
    // deterministic timestamps must remain available after a rejected package.
    const chapters = buildChapters([
      { kind: "intro", durSec: 5 },
      { kind: "card", durSec: 30, heading: "Arrival" },
      { kind: "card", durSec: 50, heading: "Stillness" },
    ]);
    assert.equal(chapters, "0:00 Intro\n0:05 Arrival\n0:35 Stillness");
    assert.doesNotMatch(rejected.description, /^\d{1,2}:\d{2}\s/m, "fallback leaves the caller's chapter append gate open");
    assert.match(`${rejected.description}\n\nChapters:\n${chapters}`, /0:35 Stillness/);
    console.log("metacraft ancillary truthfulness passed: live06 timestamps rejected, title preserved, deterministic chapters available (offline)");
  } finally {
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
