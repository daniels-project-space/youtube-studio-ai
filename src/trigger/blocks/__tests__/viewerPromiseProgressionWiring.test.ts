import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const [source, contracts] = await Promise.all([
    readFile(fileURLToPath(new URL("../narratedBlocks.ts", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../../../engine/moduleContracts.ts", import.meta.url)), "utf8"),
  ]);
  const qaStart = source.indexOf("export const qaVisual: Block = {");
  const finalByteStart = source.indexOf("const finalMasterByteLength =", qaStart);
  const progressionStart = source.indexOf("deriveViewerPromiseProgression({", finalByteStart);
  const sequenceStart = source.indexOf("const rawVisualSequenceArtifactManifest =", progressionStart);
  const certificateStart = source.indexOf("const persistedFinalMasterReleaseCertificate =", sequenceStart);
  const qaReportStart = source.indexOf("qaReport:", certificateStart);

  assert(qaStart >= 0, "qa_visual must remain the shared final-QA integration");
  assert(finalByteStart > qaStart, "the observation must bind the final-master byte/review stage");
  assert(progressionStart > finalByteStart, "the observation must happen after existing release evidence");
  assert(sequenceStart > progressionStart, "sequence provenance may coexist after progression observation");
  assert(certificateStart > progressionStart, "the observation must be ready before certificate construction");
  assert.equal(
    (source.match(/deriveViewerPromiseProgression\(/g) ?? []).length,
    1,
    "the generic observer must be integrated once, not copied into family pipelines",
  );

  const progressionRegion = source.slice(progressionStart, sequenceStart);
  assert(
    progressionRegion.includes("finalMasterNarration") &&
      progressionRegion.includes("narrationCueTiming") &&
      progressionRegion.includes("sentenceTimings"),
    "progressive observations must bind existing narration and timing receipts",
  );
  assert(
    progressionRegion.includes("no release or readiness decision changed"),
    "an unavailable optional observation must be reported without becoming a gate",
  );
  assert(
    !progressionRegion.includes("visionLocal(") &&
      !progressionRegion.includes("renderVideo(") &&
      !progressionRegion.includes("getObjectBytes(") &&
      !progressionRegion.includes("putObject("),
    "progression derivation must not issue a model, render, or storage operation",
  );
  const certificateRegion = source.slice(certificateStart, certificateStart + 3_000);
  assert(
    certificateRegion.includes("viewerPromiseProgression") &&
      certificateRegion.includes("viewerPromiseProgressionOmission") &&
      certificateRegion.includes("viewerPromiseProgressionRoute"),
    "certificate attachment must retain the optional observation or omission with its sealed route",
  );
  const qaReportRegion = source.slice(qaReportStart, qaReportStart + 1_800);
  assert(
    qaReportRegion.includes("viewerPromiseProgression") &&
      qaReportRegion.includes("viewerPromiseProgressionOmission"),
    "qaReport must mirror the bounded optional evidence for resume/UI use",
  );
  const qaContractStart = contracts.indexOf("qa_visual: contract(");
  const qaContractRegion = contracts.slice(qaContractStart, qaContractStart + 5_000);
  for (const artifact of [
    "timedScript",
    "continuityLedger",
    "dpVisualSpecs",
    "editorEdl",
    "episodeGraph",
  ]) {
    assert(
      qaContractRegion.includes(`\"${artifact}\"`),
      `qa_visual must declare optional ${artifact} input before reading it`,
    );
  }

  console.log("Viewer Promise Progression QA wiring tests passed");
}

void main();
