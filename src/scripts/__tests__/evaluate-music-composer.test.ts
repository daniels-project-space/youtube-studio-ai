import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordModelUsage } from "@/lib/modelUsage";
import { validateYuE2EvaluationRequest } from "@/lib/yue2Evaluation";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "music-composer-eval-"));
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  const fetch = globalThis.fetch;
  let calls = 0, badScore = false;
  const arrangement = {
    role: "primary_music", requestedDurationSec: 64, form: "continuous", ending: "natural_cadence", playback: "repeat",
    direction: "Synthetic native score fixture, not musical-quality evidence.",
    sections: Array.from({ length: 4 }, (_, i) => ({ id: `section-${i}`, label: `Section ${i}`,
      startFraction: i / 4, endFraction: (i + 1) / 4, energy: 0.2, instruction: "Sustain the quiet fixture tone." })),
  };
  const score = 'X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=60\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n' +
    arrangement.sections.map(s => `% ${s.id}\nV: Vocal\nz32|z32|z32|z32|\nV: Ins\nc32|c32|c32|c32|\n`).join("");
  loader._load = function (id, ...args) {
    const actual = original.call(this, id, ...args);
    if (id !== "@/agents/mastra") return actual;
    return { ...actual as object, agentJson: async (input: { beforeDispatch: () => Promise<void>; schema: { parse: (x: unknown) => unknown } }) => {
      await input.beforeDispatch(); calls++;
      recordModelUsage({ provider: "openrouter", model: "fixture", kind: "text", reportedCostUsd: 0.01 });
      return input.schema.parse({ arrangement, symbolicScore: badScore ? score.replace("c32", "c24") : score, duckDb: -12, bedLufs: -22 });
    } };
  };
  globalThis.fetch = async () => { throw new Error("all network forbidden in composer fixture"); };
  try {
    const load = createRequire(import.meta.url);
    const { evaluateMusicComposer, validateLocalYuE2Score } = load("../evaluate-music-composer") as typeof import("../evaluate-music-composer");
    const input = { ownerId: "fixture-owner", channelId: "fixture-channel", runId: "fixture-run",
      provenance: "Synthetic isolated test", family: "music_loop", musicIntent: { requestedDurationSec: 64 },
      seed: 42, budgetUsd: 1, seedStore: { topic: "Fixture", channelSlug: "fixture", persona: "Synthetic quiet music channel" } };
    assert.equal((await evaluateMusicComposer(input, {})).status, "validated");
    assert.equal(calls, 0);
    await assert.rejects(evaluateMusicComposer({ ...input, budgetUsd: 0.000001 }, {}), /budget/);
    await assert.rejects(evaluateMusicComposer({ ...input, seedStore: { topic: "Missing grounding" } }, {}), /grounding/);
    await assert.rejects(evaluateMusicComposer(input, { submit: true, output: directory }), /local runtime/);
    await assert.rejects(evaluateMusicComposer(input, { submit: true, output: directory, runtime: "/nonexistent-evaluation-runtime" }), /native score/);
    assert.equal(calls, 0, "bad admission and missing parser never purchase text");
    if (process.env.YUE2_TEST_RUNTIME) {
      for (const name of ["before", "after"]) {
        const retained = validateYuE2EvaluationRequest(JSON.parse(await readFile(
          new URL(`../../../test-fixtures/music-composer/seaside-${name}/request.json`, import.meta.url), "utf8")));
        if (name === "before") assert.throws(() => validateLocalYuE2Score(process.env.YUE2_TEST_RUNTIME!, retained.job), /blank T: header/);
        else validateLocalYuE2Score(process.env.YUE2_TEST_RUNTIME!, retained.job);
      }
      const options = { submit: true, output: join(directory, "valid"), runtime: process.env.YUE2_TEST_RUNTIME };
      const result = await evaluateMusicComposer(input, options);
      assert.equal(result.status, "score_validated"); assert.equal(calls, 1);
      const request = JSON.parse(await readFile(join(options.output, "request.json"), "utf8"));
      assert.equal(request.job.abc, score);
      assert.equal(request.acceptedArrangement.symbolicScore, score);
      await assert.rejects(evaluateMusicComposer(input, options), /EEXIST/);
      await assert.rejects(evaluateMusicComposer({ ...input, seed: 43 }, options), /EEXIST/);
      assert.equal(calls, 1, "same or changed input cannot replay a claimed evaluation");
      badScore = true;
      const failed = { ...options, output: join(directory, "invalid") };
      await assert.rejects(evaluateMusicComposer(input, failed), /native score/);
      const evidence = JSON.parse(await readFile(join(failed.output, "failure.json"), "utf8"));
      assert.equal(evidence.usage.costUsd, 0.01); assert.equal(evidence.automaticRetryAllowed, false);
      assert.equal(JSON.parse(await readFile(join(failed.output, "request.json"), "utf8")).job.abc, score.replace("c32", "c24"));
      await assert.rejects(evaluateMusicComposer(input, failed), /EEXIST/);
      assert.equal(calls, 2, "bad native scores retain the purchase and never automatically regenerate");
    }
    console.log("COMPOSER EVALUATION PASS: bounded admission, exact artifacts, native validation and no-replay claims; mocked text only");
  } finally {
    loader._load = original; globalThis.fetch = fetch;
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
