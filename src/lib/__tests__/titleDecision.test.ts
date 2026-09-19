import assert from "node:assert/strict";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import {
  assertTitleDecision, craftMetadata, judgeTitleCandidates, lintTitle, selectTitle, validateTitleRankings,
  type MetaCraftArgs, type TitleRuntime,
} from "@/lib/metacraft";

const honest = "47 Engineers Died in the Bridge Collapse";
const contradicted = "47 Engineers Survived the Bridge Collapse";
const source = "The bridge collapse killed 47 engineers. No engineers survived.";
const args: MetaCraftArgs = {
  topic: "Bridge collapse", channelName: "Field Notes", niche: "History", persona: "Sourced engineering history",
  scriptExcerpt: source, suggestions: [], competitorTitles: [], warmStartTitle: contradicted,
  sourceCoverage: { kind: "full_narration", providedChars: source.length, totalChars: source.length },
};
const row = (idx: number) => ({ idx, clickScore: 9, direct: 9, identityFit: 9, grounding: "supported", reason: "Explicit in source" });
function fixture(options: { judge?: (prompt: string) => unknown; packageFailures?: number; failure?: Error; commentFailure?: Error; commentValue?: unknown } = {}) {
  const prompts: string[] = [];
  const calls = { generator: 0, judge: 0, package: 0, comment: 0, research: 0 };
  const runtime: TitleRuntime = {
    suggest: async () => { calls.research++; return []; },
    competitors: async () => { calls.research++; return []; },
    json: async <T>({ prompt }: { prompt: string }): Promise<T> => {
      prompts.push(prompt);
      if (prompt.startsWith("Write SEVEN")) { calls.generator++; return { candidates: [{ frame: "direct_verdict", title: honest }, { frame: "duplicate", title: honest.toUpperCase() }] } as T; }
      if (prompt.startsWith("You are a YouTube CTR strategist")) {
        calls.judge++;
        if (options.failure) throw options.failure;
        return (options.judge ? options.judge(prompt) : { rankings: [
          { ...row(0), clickScore: 10, grounding: "contradicted", reason: "Source says none survived" }, row(1),
        ] }) as T;
      }
      if (prompt.startsWith("Write the YouTube description")) {
        calls.package++;
        return (calls.package <= (options.packageFailures ?? 0) ? {} : {
          title: "UNAUTHORIZED REPLACEMENT", description: "The engineering failure explained.", tagsCsv: "bridge,engineers,collapse,history,design",
        }) as T;
      }
      calls.comment++;
      if (options.commentFailure) throw options.commentFailure;
      return { comment: options.commentValue ?? "Which safety decision mattered most?" } as T;
    },
  };
  return { runtime, calls, prompts };
}
async function main() {
  // This is semantic ambiguity, not something lexical lint can prove away.
  assert.equal(lintTitle(honest, { grounding: source }).pass, true);
  assert.equal(lintTitle(contradicted, { grounding: source }).pass, true);
  const f = fixture({ packageFailures: 1 });
  const result = await craftMetadata(args, f.runtime);
  assert.equal(result.title, honest);
  assert.equal(result.titleAlternate, "", "contradicted high-click candidate must never become alternate");
  assert.equal(result.titleDecision.candidates.length, 2, "normalized generated duplicates do not crowd the pool");
  assert.deepEqual(f.calls, { generator: 1, judge: 1, package: 2, comment: 1, research: 0 });
  assertTitleDecision(args, result.titleDecision);
  for (const mutate of [
    (d: typeof result.titleDecision) => { d.sourceCoverage.providedChars = 99999; },
    (d: typeof result.titleDecision) => { d.evidence.suggestions = "fetched"; },
    (d: typeof result.titleDecision) => { d.candidates[d.winnerIndex].title = contradicted; d.title = contradicted; },
  ]) {
    const altered = structuredClone(result.titleDecision); mutate(altered);
    assert.throws(() => assertTitleDecision(args, altered), /decision/);
  }
  const generator = f.prompts.find((p) => p.startsWith("Write SEVEN"))!;
  const judge = f.prompts.find((p) => p.startsWith("You are"))!;
  const packet = (p: string) => p.split("SHARED SOURCE AND CHANNEL PACKET.")[1].split("\n\nFACT GROUNDING:")[0];
  assert.equal(packet(generator), packet(judge), "generator and judge see the same complete source and identity");
  assert.ok(judge.includes(source));
  assert.throws(() => assertTitleDecision({ ...args, scriptExcerpt: source.replace("killed", "saved") }, result.titleDecision));
  for (const field of ["clickScore", "direct", "identityFit"] as const) {
    for (const value of [undefined, null, "9", NaN, Infinity, -1, 11]) {
      assert.throws(() => validateTitleRankings({ rankings: [{ ...row(0), [field]: value }] }, 1));
    }
  }
  for (const idx of [-1, 1, 0.5, NaN, Infinity, "0", null]) {
    assert.throws(() => validateTitleRankings({ rankings: [{ ...row(0), idx }] }, 1));
  }
  assert.throws(() => validateTitleRankings({ rankings: [row(0), row(0)] }, 2));
  assert.throws(() => validateTitleRankings({ rankings: [row(0)] }, 2));
  for (const badRow of [{ ...row(0), direct: 6 }, { ...row(0), identityFit: 6 }, { ...row(0), grounding: "insufficient" }]) {
    const bad = fixture({ judge: () => ({ rankings: [badRow, { ...badRow, idx: 1 }] }) });
    await assert.rejects(() => craftMetadata(args, bad.runtime), /both title attempts failed/);
    assert.equal(bad.calls.generator, 2);
    assert.equal(bad.calls.package + bad.calls.comment, 0, "no ancillary spend before admission");
  }
  const unknown = fixture({ failure: new OpenRouterGenerationOutcomeUnknownError("response lost") });
  await assert.rejects(() => selectTitle(args, unknown.runtime), /response lost/);
  assert.equal(unknown.calls.generator, 1);
  assert.equal(unknown.calls.judge, 1, "unknown paid judge is not retried");
  const missing = fixture();
  await selectTitle({ ...args, suggestions: undefined, competitorTitles: undefined }, missing.runtime);
  assert.equal(missing.calls.research, 2, "missing and frozen empty evidence are distinct");
  const calibrated = fixture({ judge: () => ({ rankings: [row(0)] }) });
  const rankings = await judgeTitleCandidates(args, [{ frame: "oracle", title: honest }], calibrated.runtime);
  assert.equal(rankings[0].grounding, "supported");
  assert.equal(calibrated.calls.generator, 0);
  const shadowed = fixture({ judge: () => ({ rankings: [row(0)] }) });
  const valid = await selectTitle({ ...args, warmStartTitle: honest.replace("Engineers ", "Engineers " + " ".repeat(70)) }, shadowed.runtime);
  assert.equal(valid.title, honest, "invalid whitespace variant cannot suppress a lint-valid generated candidate");
  assert.equal(shadowed.calls.generator, 1);
  const commentLogs: string[] = [];
  const rejectedComment = fixture({ commentValue: " " });
  const withoutComment = await craftMetadata({ ...args, log: (message) => commentLogs.push(message) }, rejectedComment.runtime);
  assert.equal(withoutComment.title, honest);
  assert.equal(withoutComment.pinnedComment, "");
  assert.deepEqual(rejectedComment.calls, { generator: 1, judge: 1, package: 1, comment: 1, research: 0 });
  assert.equal(commentLogs.filter((line) => /optional pinned comment unavailable.*invalid optional comment response/.test(line)).length, 1,
    "known optional rejection is observable without purchasing metadata again");
  const lostComment = fixture({ commentFailure: new OpenRouterGenerationOutcomeUnknownError("comment response lost") });
  await assert.rejects(() => craftMetadata(args, lostComment.runtime), /comment response lost/);
  assert.deepEqual(lostComment.calls, { generator: 1, judge: 1, package: 1, comment: 1, research: 0 },
    "unknown optional paid outcome neither degrades silently nor rebuys packaging");
  console.log("Title decision behavioral contracts passed (stubbed transport; not a semantic model quality claim)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
