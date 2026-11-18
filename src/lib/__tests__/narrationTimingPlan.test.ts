import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { concatAudioWithGaps, probe } from "@/lib/ffmpeg";
import { deriveNarrationSectionBoundaryIndices, evaluateNarrationCadence, planNarrationCadence } from "@/lib/narrationPerformance";
import { bindScriptNarrationTiming, narrationParamsFromFrozenPipeline, resolveScriptNarrationTiming, splitNarrationSentences, weeklyScriptNarrationTiming, type ScriptNarrationTiming } from "@/lib/narrationTimingPlan";

assert.deepEqual(splitNarrationSentences("Primero. ¿Cómo estás? ¡Bien!"), ["Primero.", "¿Cómo estás?", "¡Bien!"]);
assert.deepEqual(splitNarrationSentences("Первая. Вторая."), ["Первая.", "Вторая."]);
assert.deepEqual(splitNarrationSentences("一。二。三。"), ["一。", "二。", "三。"]);
assert.deepEqual(splitNarrationSentences('"Breathe in." Then rest.'), ['"Breathe in."', "Then rest."]);
import { assertPlanWeekPreparedScriptBinding, planWeekPreparationManifestSha256, type PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";
import { chapterItemSpeech, narrationChapterCadence, narrationChapterItems, narrationChapterTimeline } from "@/lib/narrationChapterPlan";

async function main() {
  const pipeline = [
    { block: "script_gen", params: { maxSeconds: 1200, genre: "meditation" } },
    { block: "narration_tts", params: { sentenceGapSec: 0.85 } },
  ];
  const original = canonicalJson(pipeline);
  const bound = bindScriptNarrationTiming(pipeline);
  assert.equal(canonicalJson(pipeline), original, "freezing does not mutate the source pipeline");
  const frozen = bound[1].params!.scriptNarrationTiming as ScriptNarrationTiming;
  assert.equal(resolveScriptNarrationTiming(frozen, "history", undefined).restBudgetSec, 120);
  assert.equal(resolveScriptNarrationTiming(frozen, "history", undefined).profile, "quiet_listening");
  assert.deepEqual(weeklyScriptNarrationTiming({ pipeline, moduleConfig: {} }), frozen, "weekly and ordinary runs bind the same script timing");
  assert.deepEqual(snapshotParamsByBlock(bound).narration_tts.scriptNarrationTiming, frozen, "timing is part of the frozen narration parameters");
  const legacySnapshot = structuredClone(pipeline);
  const restored = narrationParamsFromFrozenPipeline({ params: legacySnapshot[1].params, entries: legacySnapshot, preparedScriptPresent: false });
  assert.deepEqual(restored.scriptNarrationTiming, frozen, "old snapshots derive the same timing without being rewritten");
  assert.equal(canonicalJson(legacySnapshot), original);
  assert.equal(narrationParamsFromFrozenPipeline({ params: legacySnapshot[1].params, entries: legacySnapshot, preparedScriptPresent: true }).preparedScriptRequiresTimingProof, true);
  assert.throws(() => narrationParamsFromFrozenPipeline({ params: { scriptNarrationTiming: { ...frozen, targetSeconds: 240 } }, entries: legacySnapshot, preparedScriptPresent: false }), /differs/);
  assert.throws(() => resolveScriptNarrationTiming({ version: "script-narration-timing/v1" }, undefined, undefined), /invalid/);
  assert.throws(() => bindScriptNarrationTiming([...pipeline, pipeline[0]]), /unique/);

  const sections = Array.from({ length: 8 }, (_, index) => ({ heading: `Part ${index}`, narration: `Breathe gently through section ${index}.` }));
  const hook = "Settle into this moment.";
  const script = { hook, sections, narrationText: [hook, ...sections.map(section => section.narration)].join(" "), estDurationSec: 1080 };
  const sentences = splitNarrationSentences(script.narrationText);
  const boundaries = deriveNarrationSectionBoundaryIndices({ sentences, openingSentences: splitNarrationSentences(hook),
    sectionSentences: sections.map(section => splitNarrationSentences(section.narration)) });
  assert.ok(boundaries);
  const set = new Set(boundaries);
  const resolved = resolveScriptNarrationTiming(frozen, "history", undefined);
  const cadence = planNarrationCadence({ sentences, baseGapSec: 0.85, jitterSec: 0.2,
    sectionBoundaryAfter: sentences.map((_, index) => set.has(index)), profile: resolved.profile, maxQuietRestBudgetSec: resolved.restBudgetSec });
  const { buildWeeklyNarrationCadence, requirePreparedScriptTiming } = await import("@/trigger/planWeekPreparedNarration");
  assert.deepEqual(buildWeeklyNarrationCadence({ script, narrationTiming: frozen, niche: "history", baseGapSec: 0.85, jitterSec: 0.2 }).cadence,
    cadence, "the actual weekly planner matches ordinary narration's pause plan");
  assert.throws(() => buildWeeklyNarrationCadence({ script: { ...script, narrationText: `${script.narrationText} An unbound ending.` },
    narrationTiming: frozen, niche: "history", baseGapSec: 0.85, jitterSec: 0.2 }), /boundaries/);
  const chapterWeekly = buildWeeklyNarrationCadence({ script, narrationTiming: frozen, niche: "history", baseGapSec: 0.85,
    jitterSec: 0.2, chapterCards: true, preSec: 3, postSec: 3 });
  const chapterItems = narrationChapterItems(script);
  assert.deepEqual(chapterWeekly.sentences, chapterItems.map(chapterItemSpeech));
  assert.deepEqual(chapterWeekly.cadence, narrationChapterCadence({ items: chapterItems, baseGapSec: 0.85, jitterSec: 0.2,
    profile: "quiet_listening", restBudgetSec: 120, preSec: 3, postSec: 3 }));
  assert.equal(chapterWeekly.cadence.gapsSec.filter((_, index) => chapterWeekly.cadence.purposes[index] === "section").reduce((sum, gap) => sum + gap, 0), 120);
  const chapterTimeline = narrationChapterTimeline(chapterItems, chapterItems.map(() => 1), chapterWeekly.cadence.gapsSec, 3, 3);
  assert.ok(chapterTimeline.chapterPlan.some(item => item.kind === "card"));
  assert.equal(chapterTimeline.sentenceTimings.length, sentences.length, "spoken chapter headings do not appear as body sentence cues");
  assert.ok(Math.abs(chapterTimeline.chapterPlan.reduce((sum, item) => sum + item.durSec, 0) - chapterTimeline.durationSec) < 0.001);
  assert.throws(() => narrationChapterCadence({ items: chapterItems, baseGapSec: 0.85, jitterSec: 0.2,
    profile: "quiet_listening", restBudgetSec: 120, preSec: 16, postSec: 3 }), /pre-roll/);
  const rests = cadence.gapsSec.filter(gap => gap >= 15);
  assert.ok(rests.length >= 2 && rests.every(gap => gap <= 30));
  assert.equal(rests.reduce((a, b) => a + b, 0), 120, "the generated rest plan uses the exact time reserved by the writer");
  assert.throws(() => planNarrationCadence({ sentences: ["One.", "Two."], baseGapSec: 0.85, jitterSec: 0.2,
    sectionBoundaryAfter: [true, false], profile: "quiet_listening", maxQuietRestBudgetSec: 120 }), /requires at least 4/);
  let cursor = 0;
  const timings = sentences.map((_, index) => { const start = cursor; const end = start + 1; cursor = end + cadence.gapsSec[index]; return { start, end }; });
  assert.doesNotThrow(() => evaluateNarrationCadence({ sentences, sentenceTimings: timings, plan: cadence }));
  const altered = timings.map(timing => ({ ...timing }));
  altered[1].start += 1;
  assert.throws(() => evaluateNarrationCadence({ sentences, sentenceTimings: altered, plan: cadence }), /pause/);

  const manifest = { ownerId: "owner", channelId: "channel", batchId: "batch", itemId: "item", requestKey: "request",
    plan: { topic: "A synthetic topic" }, prompts: { script: "Synthetic brief" }, execution: { pipeline, moduleConfig: {}, seedStore: {} } } as unknown as PlanWeekPreparationManifest;
  const { buildWeeklyScriptRequest } = await import("@/trigger/planWeekPreparedScript");
  const payload = { maxCostUsd: 1 } as Parameters<typeof buildWeeklyScriptRequest>[1];
  const request = buildWeeklyScriptRequest(manifest, payload);
  assert.equal(request.maxSeconds, 1200);
  assert.equal(request.genre, "meditation");
  assert.throws(() => buildWeeklyScriptRequest(manifest, { ...payload, maxSeconds: 240 }), /differs from the frozen pipeline/);
  assert.throws(() => buildWeeklyScriptRequest(manifest, { ...payload, style: "different" }), /differs from the frozen pipeline/);
  const receipt = { version: "plan-week-prepared-script/v1", manifestSha256: planWeekPreparationManifestSha256(manifest),
    ownerId: "owner", channelId: "channel", batchId: "batch", itemId: "item", requestKey: "request", topic: manifest.plan.topic,
    script, scriptSha256: sha256Hex(canonicalJson(script)), createdAt: 1 };
  const previousHash = receipt.scriptSha256;
  const legacyReceipt = assertPlanWeekPreparedScriptBinding({ prepared: receipt, manifest });
  assert.equal(legacyReceipt.scriptSha256, previousHash, "legacy receipts remain readable");
  assert.throws(() => requirePreparedScriptTiming(legacyReceipt), /lacks frozen narration timing evidence/);
  const withTiming = { ...receipt, narrationTiming: frozen };
  const provenReceipt = assertPlanWeekPreparedScriptBinding({ prepared: withTiming, manifest });
  assert.equal(provenReceipt.scriptSha256, previousHash, "timing evidence does not change the script hash");
  assert.deepEqual(requirePreparedScriptTiming(provenReceipt), frozen);
  assert.throws(() => assertPlanWeekPreparedScriptBinding({ prepared: { ...withTiming, narrationTiming: { ...frozen, targetSeconds: 240 } }, manifest }), /binding mismatch/);

  const directory = await mkdtemp(join(tmpdir(), "narration-timing-test-"));
  const measuredRests: number[] = [];
  try {
    const tone = join(directory, "tone.wav");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", tone], { stdio: "ignore" });
    for (const gap of [15, 20, 24, 25, 30]) {
      const output = join(directory, `gap-${gap}.mp3`);
      await concatAudioWithGaps([tone, tone], [gap, 0], output);
      const result = spawnSync("ffmpeg", ["-hide_banner", "-i", output, "-af", "silencedetect=noise=-45dB:d=1", "-f", "null", "-"], { encoding: "utf8" });
      assert.equal(result.status, 0);
      const measured = Number(result.stderr.match(/silence_duration:\s*([\d.]+)/)?.[1]);
      assert.ok(Math.abs(measured - gap) < 0.08, `planned ${gap}s rest measured ${measured}s`);
      measuredRests.push(measured);
    }
    const chapterAudio = join(directory, "chapter-narration.mp3");
    await concatAudioWithGaps(chapterItems.map(() => tone), chapterWeekly.cadence.gapsSec, chapterAudio);
    const measuredChapter = await probe(chapterAudio);
    assert.ok(Math.abs(measuredChapter.durationSec - chapterTimeline.durationSec) < 0.1, "chapter audio and card timeline agree");
    const chapterSilence = spawnSync("ffmpeg", ["-hide_banner", "-i", chapterAudio, "-af", "silencedetect=noise=-45dB:d=1", "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(chapterSilence.status, 0);
    const longRests = [...chapterSilence.stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map(match => Number(match[1])).filter(value => value >= 15);
    const plannedRests = chapterWeekly.cadence.gapsSec.filter((_, index) => chapterWeekly.cadence.purposes[index] === "section");
    assert.equal(longRests.length, plannedRests.length);
    assert.ok(longRests.every((rest, index) => Math.abs(rest - plannedRests[index]) < 0.08), "measured chapter rests match the planned pauses");
  } finally { await rm(directory, { recursive: true, force: true }); }
  console.log(`Frozen timing and immutable script receipt passed; measured rests: ${measuredRests.join(", ")}s`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
