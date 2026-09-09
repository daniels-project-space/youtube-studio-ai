import assert from "node:assert/strict";
import { metadataTitleArgsForStage } from "../intelligenceBlocks";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { titleInputFingerprint } from "@/lib/metacraft";

globalThis.fetch = async () => { throw new Error("input builder must never perform I/O"); };
const topic = "How tax brackets work";
const narration = "An actual complete account. ".repeat(150) + "This final fact must remain in the source.";
const input = {
  runId: "input-parity-run", params: { language: "de", clickbaitLevel: 0 },
  store: {
    topic, channelName: "Chalk & Compound", niche: "finance", persona: "An approachable chalkboard teacher",
    narrationText: narration, script: { hook: "A question", hookLoop: "An answer later", closingLine: "A closing thought", sections: [{ heading: "Ignored", narration: "Not the full narration" }] },
    plannedTitle: "The Planned Tax Bracket Title", topicBet: { provisionalTitle: "The Bet Tax Bracket Title" },
    styleDNA: { seo: { titleFormula: "Simple and specific", descriptionStructure: "Useful detail first" } },
    clickbaitLevel: 3, competitors: [], nicheIntel: { powerWords: [{ word: "simple", count: 4 }] },
    chapters: "Not source evidence", attributions: ["Not a title input"], bannedWords: ["not title evidence"],
  },
};
const before = JSON.stringify(input);
const result = metadataTitleArgsForStage(input);
const expected = {
  topic, channelName: "Chalk & Compound", niche: "finance", persona: "An approachable chalkboard teacher",
  format: undefined, isMusicNiche: false, language: "de", scriptExcerpt: narration,
  sourceCoverage: { kind: "full_narration" as const, providedChars: narration.length, totalChars: narration.length },
  continuityContext: undefined, coldOpen: "A question", hookLoop: "An answer later", quote: "A closing thought",
  competitorTitles: [], powerWords: ["simple"], titleFormula: "Simple and specific", descriptionStructure: "Useful detail first",
  warmStartTitle: "The Planned Tax Bracket Title", betTitle: "The Bet Tax Bracket Title", clickbaitLevel: 0,
};
assert.deepEqual(result, expected);
assert.equal(titleInputFingerprint(result), titleInputFingerprint(expected), "exact former production argument shape and order");
assert.equal(JSON.stringify(input), before, "builder never changes upstream artifacts");
assert.ok(result.scriptExcerpt?.endsWith("This final fact must remain in the source."));
assert.equal("log" in result, false, "read-only builder does not expose an execution callback");

const fallback = metadataTitleArgsForStage({ runId: input.runId, params: {}, store: {
  topic, narrationText: " \n ", script: { sections: [
    { heading: "First", narration: "Narration takes precedence", text: "ignored", content: "ignored" },
    { heading: "Second", text: "Text fallback" }, { content: "Content fallback" },
  ] },
} });
assert.equal(fallback.scriptExcerpt, "First\n\nNarration takes precedence\n\nSecond\n\nText fallback\n\nContent fallback");
assert.deepEqual(fallback.sourceCoverage, { kind: "script_excerpt", providedChars: fallback.scriptExcerpt!.length, totalChars: null });
const topicOnly = metadataTitleArgsForStage({ runId: input.runId, params: {}, store: { topic } });
assert.deepEqual(topicOnly.sourceCoverage, { kind: "topic_only", providedChars: 0, totalChars: 0 });
assert.equal(topicOnly.competitorTitles, undefined);
assert.notEqual(titleInputFingerprint(topicOnly), titleInputFingerprint({ ...topicOnly, competitorTitles: [] }), "absent evidence is not an authoritative empty feed");

const topVideos = Array.from({ length: 15 }, (_, index) => ({ title: "Feed title " + index, views: index, tags: [] }));
const words = Array.from({ length: 15 }, (_, index) => ({ word: "word" + index, count: index }));
const supplied = { topic, competitors: [{ topVideos }], nicheIntel: { powerWords: words }, clickbaitLevel: 2 };
const suppliedBefore = JSON.stringify(supplied);
const ranked = metadataTitleArgsForStage({ runId: input.runId, params: {}, store: supplied });
assert.deepEqual(ranked.competitorTitles, topVideos.slice().reverse().slice(0, 12).map(({ title, views }) => ({ title, views })));
assert.deepEqual(ranked.powerWords, words.slice(0, 12).map(({ word }) => word));
assert.equal(ranked.clickbaitLevel, 2);
assert.equal(JSON.stringify(supplied), suppliedBefore, "sort and limits must not mutate shared inputs");

for (const [family, niche, expectedMusic] of [
  ["narrated_stock", "Lo-Fi music history", false],
  ["music_loop", "Seaside study", true],
] as const) {
  const brief = createChannelProgramBrief({ family, nicheKey: family === "music_loop" ? "lofi" : "educational", locale: "en", concept: "A repeatable original viewer promise." });
  const channelProgramRoute = channelProgramRouteRunSeed({ route: resolveChannelProgramRoute(brief), programBrief: brief });
  const value = metadataTitleArgsForStage({ runId: input.runId, params: {}, store: { topic, niche, channelProgramRoute } });
  assert.equal(value.format, family); assert.equal(value.isMusicNiche, expectedMusic);
}
for (const [niche, expectedMusic] of [["sleep meditation", false], ["lo fi", true], ["study beats", true]] as const) {
  assert.equal(metadataTitleArgsForStage({ runId: input.runId, params: {}, store: { topic, niche } }).isMusicNiche, expectedMusic);
}
const allowed = new Set(["topic", "serializedProgramEpisodeContext", "channelProgramRoute", "channelName", "niche", "persona", "plannedTitle", "topicBet", "nicheIntel", "competitors", "script", "narrationText", "styleDNA", "clickbaitLevel"]);
const store = new Proxy({ topic } as Record<string, unknown>, { get(target, key) {
  assert.ok(typeof key === "string" && allowed.has(key), "unexpected input read: " + String(key));
  return target[key];
} });
metadataTitleArgsForStage({ runId: input.runId, params: {}, store });
assert.throws(() => metadataTitleArgsForStage({ runId: input.runId, params: {}, store: {} }), /expected non-empty/);
console.log("Metadata input parity: full source, section fallback, topic-only, route-owned music, evidence absence and immutable inputs passed");
