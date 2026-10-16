import assert from "node:assert/strict";
import { registerAllBlocks } from "@/engine/blocks";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import type { Script } from "@/lib/scriptGen";
import { OPENROUTER_MODELS } from "@/lib/openRouter";
import { findChannelBannedWords, readChannelBannedWords } from "@/engine/channelLanguagePolicy";

// Transport fixtures only: the registered script_gen, synthScript, craftHook,
// hook lint/judge, provider decoder and produceAndCritique loop are all real.
const hook = "The locked garden gate held Mira outside until a tiny seed revealed its secret.";
const opening = "Mira found the seed beside a cracked stone in the garden wall. She placed it in a pot and waited near the gate. Each morning she carried water from the well. Nothing changed until a green shoot bent toward the stone. Its roots were following a hidden stream. That small discovery would show her how to open the gate.";
const loop = "Show how Mira discovers the stream and opens the locked garden gate.";
const sections = [
  { heading: "The dry garden", narration: "Mira inspected the wall before touching the rusty latch. The soil beside it was dry and hard. Yet the little shoot stayed green through the afternoon heat. She pressed her fingers into the earth and found a cool patch beneath the stone. Water was moving where she could not see it." },
  { heading: "Following the roots", narration: "She carefully lifted the loose stone and followed the roots. They led toward a narrow channel hidden beneath the path. A fallen branch had blocked its entrance. Mira pulled the branch free, and water began to run again. The stream reached a small wooden wheel beside the gate and slowly turned it." },
  { heading: "The opening", narration: "The wheel raised the latch, and the garden gate swung open. Mira carried her seedling inside and planted it beside the restored stream. She had solved the mystery by following a small living clue. The garden needed its water before its gate could move. She left the channel clear for the next visitor." },
];
const remediation = "Explain how the restored stream turns the wheel and raises the latch.";
const malformed: Array<[string, unknown]> = [
  ["empty object", {}], ["missing verdict", { issues: [] }],
  ["null verdict", { pass: null, issues: [] }], ["string verdict", { pass: "false", issues: [] }],
  ["numeric verdict", { pass: 1, issues: [] }], ["missing issues", { pass: true }],
  ["string issues", { pass: true, issues: "weak structure" }],
  ["non-string issue", { pass: true, issues: [123] }], ["empty issue", { pass: true, issues: ["   "] }],
  ["too many issues", { pass: true, issues: Array(6).fill("weak structure") }],
  ["unbounded issue", { pass: true, issues: ["x".repeat(141)] }],
  ["unexpected schema", { pass: true, issues: [], accepted: false }],
  ["array verdict", []], ["null response", null],
];

interface RecordedRequest { kind: "candidates" | "judge" | "script" | "critic"; prompt: string }

async function main(): Promise<void> {
  const normalizedBans = readChannelBannedWords(["  forbidden   phrase ", "FORBIDDEN PHRASE"]);
  assert.deepEqual(normalizedBans, ["forbidden phrase"]);
  assert.deepEqual(findChannelBannedWords("A FORBIDDEN\n phrase appeared.", normalizedBans), ["forbidden phrase"]);
  assert.deepEqual(findChannelBannedWords("Secrets are not the singular word.", ["secret"]), [],
    "literal policy does not reject partial-word matches");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let requests: RecordedRequest[] = [];
  let verdicts: unknown[] = [];
  let currentLabel = "";
  try {
    process.env.OPENROUTER_API_KEY = "fixture-only-never-sent";
    registerAllBlocks();
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "no other provider, storage or database traffic");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, OPENROUTER_MODELS.creative, "preserve the code-owned pinned model");
      assert.equal(init?.method, "POST");
      const prompt = body.messages.at(-1).content;
      assert.equal(typeof prompt, "string");
      let kind: RecordedRequest["kind"];
      let value: unknown;
      if (prompt.startsWith("You are the cold-open director.")) {
        kind = "candidates";
        if (currentLabel === "banned-word-retry") assert.match(prompt, /forbidden phrase/);
        assert.equal(body.max_tokens, 3200);
        value = { candidates: ["cold_open_scene", "curiosity_gap", "result_first", "problem_agitation"].map((device) => ({ device, hook, opening, loop })) };
      } else if (prompt.startsWith("You are a brutal YouTube retention judge.")) {
        kind = "judge";
        assert.equal(body.max_tokens, 1400);
        // Four provider candidates intentionally collapse to one unique
        // survivor before judging; return exactly one verdict for the actual
        // candidate list so the strict hook admission contract is exercised
        // without manufacturing scores for removed candidates.
        value = { verdicts: Array.from({ length: 1 }, () => ({ punch: 9, specificity: 9, curiosity: 9,
          voiceMatch: 9, promise: 9, honest: true, note: "Concrete fictional garden mystery." })), best: 0 };
      } else if (prompt.startsWith("Write a YouTube narration script about:")) {
        kind = "script";
        assert.equal(body.max_tokens, 13000);
        if (currentLabel === "banned-word-retry") assert.match(prompt, /forbidden phrase/);
        const attempt = requests.filter((request) => request.kind === "script").length + 1;
        const overlong = currentLabel.startsWith("duration-overlong") &&
          (currentLabel.endsWith("exhausted") || attempt === 1);
        const excessWords = overlong ? ` ${Array.from({ length: 180 }, (_, index) => `extra${index}`).join(" ")}` : "";
        value = { sections: sections.map((section) => ({ ...section,
          narration: `${section.narration}${currentLabel === "banned-word-retry" && attempt === 1 ? " This forbidden phrase must be removed." : ""}${excessWords}${attempt > 1 ? " Clear water kept the wooden wheel moving." : ""}` })),
          closing_line:
            currentLabel === "closing-line-exhausted" || (currentLabel === "closing-line-retry" && attempt === 1)
              ? "Carry the seed through the garden gate to find the hidden stream"
              : currentLabel === "closing-line-length-retry" && attempt === 1
                ? "A".repeat(81)
              : "Follow the warm stone to the truth." };
      } else if (prompt.startsWith("Critique this YouTube narration draft for quality")) {
        kind = "critic";
        assert.equal(body.max_tokens, 2500, "critic budget is not lowered");
        assert.equal(body.temperature, 0.3, "critic temperature is not changed");
        const index = requests.filter((request) => request.kind === "critic").length;
        assert.ok(index < verdicts.length, `${currentLabel}: no unplanned critic retry`);
        value = verdicts[index];
      } else {
        throw new Error(`Unexpected provider request in ${currentLabel}: ${prompt.slice(0, 120)}`);
      }
      requests.push({ kind, prompt });
      return Response.json({ id: `fixture-generation-${currentLabel}-${requests.length}`, model: body.model,
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.003 } });
    };

    async function run(label: string, values: unknown[], bannedWords: string[] = []) {
      currentLabel = label; verdicts = values; requests = [];
      const stages: Array<{ block: string; status: string }> = [];
      const logs: string[] = [];
      const result = await runPipeline(validatePipeline([{ block: "script_gen", params: { maxSeconds: 75, style: "shorts" } }], ["topic", "niche"]), {
        ownerId: "owner-generation-test", channelId: "channel-generation-test", runId: "run-generation-test",
        keyPrefix: "owners/owner-generation-test/", budgetUsd: 1, defaultRetries: 2,
        seedStore: { topic: "Mira and the locked garden gate", niche: "original fantasy fiction", bannedWords },
        sink: { async upsert(row) { stages.push({ block: row.block, status: row.status }); } },
        log: (message) => { logs.push(message); },
      });
      assert.equal(requests.filter((request) => request.kind === "candidates").length, 1, `${label}: hook candidates generated exactly once`);
      assert.equal(requests.filter((request) => request.kind === "judge").length, 1, `${label}: hook judge runs exactly once`);
      assert.ok(logs.some((line) => /4 generated, 1 unique, 1 pass lint/.test(line)), "real deterministic hook lint ran before duplicate candidates were judged");
      assert.equal(Object.hasOwn(result.store, "scriptApproved"), false, "generation never substitutes for independent qa_script approval");
      return { result, stages, logs };
    }

    const good = await run("valid-pass", [{ pass: true, issues: [] }]);
    assert.equal(good.result.ok, true, good.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic"]);
    const script = good.result.store.script as Script;
    assert.equal(script.crafted?.verdict.judged, true, "the actual hook judge admitted this fixture");
    assert.equal(script.crafted.hook, hook);
    assert.ok(script.hook.startsWith(hook));
    assert.ok(script.hook.includes(opening));
    assert.ok(script.narrationText.includes(sections[2].narration));
    assert.equal(good.result.store.narrationText, script.narrationText);
    assert.ok(good.logs.some((line) => /1 iter, accepted/.test(line)));

    const bannedRetry = await run("banned-word-retry", [{ pass: true, issues: [] }], ["forbidden phrase"]);
    assert.equal(bannedRetry.result.ok, true, bannedRetry.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "script", "critic"],
      "deterministic policy catches the first draft before critic spend and retries once");
    assert.doesNotMatch((bannedRetry.result.store.script as Script).narrationText, /forbidden phrase/i);

    const closingLineRetry = await run("closing-line-retry", [{ pass: true, issues: [] }]);
    assert.equal(closingLineRetry.result.ok, true, closingLineRetry.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "script", "critic"],
      "overlong outro copy is rejected before critic spend and gets the existing single retry");
    assert.ok(requests.filter((request) => request.kind === "script")[1].prompt.includes(
      "script closing line must be 10 or fewer spoken words",
    ), "closing-line contract issue reaches the retry prompt");
    assert.equal((closingLineRetry.result.store.script as Script).closingLine, "Follow the warm stone to the truth.");

    const closingLineLengthRetry = await run("closing-line-length-retry", [{ pass: true, issues: [] }]);
    assert.equal(closingLineLengthRetry.result.ok, true, closingLineLengthRetry.result.error);
    assert.ok(requests.filter((request) => request.kind === "script")[1].prompt.includes(
      "script closing line exceeds 80 characters",
    ), "the character ceiling independently reaches the retry prompt");
    assert.equal((closingLineLengthRetry.result.store.script as Script).closingLine, "Follow the warm stone to the truth.");

    const durationRetry = await run("duration-overlong-retry", [{ pass: true, issues: [] }]);
    assert.equal(durationRetry.result.ok, true, durationRetry.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "script", "critic"],
      "overlong narration is caught before critic spend and receives one informed retry");
    assert.match(requests.filter((request) => request.kind === "script")[1].prompt, /exceeds the .* ceiling/,
      "duration remediation reaches the regeneration prompt");
    assert.ok((durationRetry.result.store.script as Script).estDurationSec <= 75 * 1.12,
      "the accepted retry must meet the measured duration ceiling");
    assert.ok((durationRetry.result.store.script as Script).narrationText.includes(sections[2].narration),
      "duration correction preserves the decisive ending rather than trimming it off");

    const durationExhausted = await run("duration-overlong-exhausted", []);
    assert.equal(durationExhausted.result.ok, false);
    assert.match(durationExhausted.result.error ?? "", /duration remained above the .* ceiling after the informed retry/);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "script"],
      "repeated overlong narration fails before paid critique and downstream work");
    assert.equal(Object.hasOwn(durationExhausted.result.store, "narrationText"), false);

    const closingLineExhausted = await run("closing-line-exhausted", []);
    assert.equal(closingLineExhausted.result.ok, false);
    assert.match(closingLineExhausted.result.error ?? "", /independent narrative critique did not clear the quality bar/);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "script"],
      "an invalid closing line after the one retry never reaches paid critique or publication");
    assert.equal(Object.hasOwn(closingLineExhausted.result.store, "script"), false);
    assert.equal(Object.hasOwn(closingLineExhausted.result.store, "narrationText"), false);

    const repaired = await run("false-then-true", [{ pass: false, issues: [remediation] }, { pass: true, issues: [] }]);
    assert.equal(repaired.result.ok, true, repaired.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic", "script", "critic"]);
    const scriptPrompts = requests.filter((request) => request.kind === "script").map((request) => request.prompt);
    assert.equal(scriptPrompts[0].includes(remediation), false);
    assert.ok(scriptPrompts[1].includes(remediation), "actual rejected-critic issues reach the next producer prompt");
    const revisedScript = repaired.result.store.script as Script;
    assert.equal(revisedScript.hook, script.hook, "regeneration retains the already-judged hook");
    assert.ok(revisedScript.narrationText.includes("Clear water kept the wooden wheel moving."), "the accepted second draft is returned");
    assert.ok(repaired.logs.some((line) => /2 iter, accepted/.test(line)));

    const contradictory = await run("pass-with-findings", [
      { pass: true, issues: [remediation] },
      { pass: true, issues: [] },
    ]);
    assert.equal(contradictory.result.ok, true, contradictory.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic", "script", "critic"],
      "a passing flag with findings is treated as a rejection and uses the existing single-retry path");
    assert.ok(requests.filter((request) => request.kind === "script")[1].prompt.includes(remediation),
      "findings from a contradictory critic response reach the script repair prompt");

    const withoutIssues = await run("false-without-issues", [{ pass: false, issues: [] }, { pass: true, issues: [] }]);
    assert.equal(withoutIssues.result.ok, true, withoutIssues.result.error);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic", "script", "critic"]);
    assert.ok(requests.filter((request) => request.kind === "script")[1].prompt.includes(
      "independent narrative critic rejected the draft without usable remediation",
    ), "an explicit negative verdict is not converted into a pass when findings are empty");

    const exhausted = await run("false-then-false", [{ pass: false, issues: [remediation] }, { pass: false, issues: [remediation] }]);
    assert.equal(exhausted.result.ok, false);
    assert.match(exhausted.result.error ?? "", /independent narrative critique did not clear the quality bar/);
    assert.equal(requests.filter((request) => request.kind === "script").length, 2, "one informed narration retry at most");
    assert.equal(requests.filter((request) => request.kind === "critic").length, 2);
    assert.equal(Object.hasOwn(exhausted.result.store, "script"), false);
    assert.equal(Object.hasOwn(exhausted.result.store, "narrationText"), false);

    for (const [label, value] of malformed) {
      const failed = await run(label, [value]);
      assert.equal(failed.result.ok, false, `${label}: malformed verdict must not admit script_gen`);
      assert.match(failed.result.error ?? "", /script_gen FAILED: independent narrative critic unavailable.*malformed script critique/, label);
      assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic"], `${label}: fail before any regeneration`);
      assert.equal(Object.hasOwn(failed.result.store, "script"), false);
      assert.equal(Object.hasOwn(failed.result.store, "narrationText"), false);
      assert.equal(failed.stages.some((stage) => stage.status === "ok"), false);
      assert.ok(failed.result.costTotal > 0, "fixture provider charge remains accounted on failed admission");
    }
    const malformedRetry = await run("malformed-second-critique", [{ pass: false, issues: [remediation] }, {}]);
    assert.equal(malformedRetry.result.ok, false);
    assert.match(malformedRetry.result.error ?? "", /independent narrative critic unavailable.*malformed script critique/);
    assert.deepEqual(requests.map((request) => request.kind), ["candidates", "judge", "script", "critic", "script", "critic"]);
    assert.equal(Object.hasOwn(malformedRetry.result.store, "script"), false, "no best-effort return after a malformed second critique");
    console.log(`script_gen critic response PASS: ${malformed.length} malformed verdicts stop before regeneration; real first-pass and one informed retry preserve hook and approval boundary`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
