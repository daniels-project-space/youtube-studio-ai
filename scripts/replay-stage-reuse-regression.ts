/** Reproduce the original unsafe admission against frozen and current runners. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { runPipeline } from "@/engine/runner";
import { register, _clear } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { rehydrateOutputsWithStorage } from "@/lib/rehydrate";
import { qaScript, narrationTts } from "@/trigger/blocks/narratedBlocks";

const baselineRevision = "f2a345b";
const baselineSource = execFileSync("git", ["show", `${baselineRevision}:src/engine/runner.ts`], { encoding: "utf8" });
const localRequire = createRequire(resolve("src/engine/runner.ts"));
const baselineModule = { exports: {} as { runPipeline?: typeof runPipeline } };
new Function("require", "module", "exports", ts.transpileModule(baselineSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(localRequire, baselineModule, baselineModule.exports);

async function attempt(runner: typeof runPipeline) {
  _clear();
  let providerEntries = 0, storageHeads = 0, lineageWrites = 0;
  // Real registered production ABIs, with their execution entry replaced by a
  // hard no-provider sentinel. The behavior under test is cached adoption.
  for (const block of [qaScript, narrationTts]) register({ ...block, run: async () => {
    providerEntries++; throw new Error("provider entry forbidden in recovery regression");
  } });
  const requestedText = "White moves the pawn from e2 to e4.";
  const oldText = "Black castles on the opposite side.";
  const seedStore = { narrationText: requestedText, script: { narrationText: requestedText } };
  const rows = [{ block: "qa_script", cost: 0.01, outputs: { scriptApproved: true } }, {
    block: "narration_tts", cost: 0.2, outputs: {
      narrationKey: "owners/reuse-regression/runs/replay/narration.mp3",
      narrationLocalPath: "/missing-reuse-regression/narration.mp3", narrationDurationSec: 3,
      narrationTranscriptText: oldText, sentenceTimings: [{ text: oldText, start: 0, end: 3 }], chapterPlan: [],
      narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg",
        durationSec: 3, wordCount: 6, wordsPerSec: 2, integratedLufs: -18, windowMeanDb: -20 },
    },
  }];
  const result = await runner(validatePipeline([{ block: "qa_script" }, { block: "narration_tts" }], Object.keys(seedStore)), {
    ownerId: "reuse-regression-owner", channelId: "reuse-regression-channel", runId: "replay",
    keyPrefix: "owners/reuse-regression/", budgetUsd: 10, defaultRetries: 0, seedStore,
    sink: { async upsert() {}, async getCompleted() { return structuredClone(rows); },
      async upsertArtifacts() { lineageWrites++; } },
    rehydrate: (block, outputs, request) => rehydrateOutputsWithStorage(block, outputs, "replay", request, {
      async getObjectToFile() { throw new Error("unexpected media download"); },
      async headObjectMetadata() { storageHeads++; return { contentLength: 1, metadata: {} }; },
    }),
  });
  return { ok: result.ok, requestedText, restoredTranscript: result.store.narrationTranscriptText ?? null,
    error: result.error ?? null, costTotal: result.costTotal, providerEntries, storageHeads, lineageWrites };
}

async function main() {
  const before = await attempt(baselineModule.exports.runPipeline!);
  const after = await attempt(runPipeline);
  assert.equal(before.ok, true, "frozen original really accepts the stale transcript");
  assert.notEqual(before.restoredTranscript, before.requestedText);
  assert.equal(before.lineageWrites, 2, "original re-stamps both cached stages");
  assert.equal(after.ok, false);
  assert.match(after.error ?? "", /STAGE_REUSE_RECONCILIATION_REQUIRED/);
  assert.equal(after.restoredTranscript, null);
  assert.equal(after.lineageWrites, 0);
  assert.equal(after.storageHeads, 0);
  assert.equal(before.providerEntries + after.providerEntries, 0);
  assert.equal(after.costTotal, before.costTotal);
  console.log(JSON.stringify({ baselineRevision,
    baselineRunnerSha256: createHash("sha256").update(baselineSource).digest("hex"),
    scope: "actual runners, production block ABIs and rehydrator; provider entry and storage transport isolated",
    before, after }, null, 2));
}
void main();
