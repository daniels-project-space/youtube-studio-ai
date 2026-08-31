import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const source = await readFile(
    fileURLToPath(new URL("../narratedBlocks.ts", import.meta.url)),
    "utf8",
  );
  const qaStart = source.indexOf('export const qaVisual: Block = {');
  const byteLengthStart = source.indexOf(
    "const finalMasterByteLength =",
    qaStart,
  );
  const ledgerStart = source.indexOf(
    "const rawVisualSequenceArtifactManifest =",
    byteLengthStart,
  );
  const certificateStart = source.indexOf(
    "const persistedFinalMasterReleaseCertificate =",
    ledgerStart,
  );
  const ledgerEnd = source.indexOf(
    "// Re-read the immutable selected-input manifest immediately before the",
    ledgerStart,
  );
  assert(qaStart >= 0, "qa_visual must remain the live final-QA block");
  assert(byteLengthStart > qaStart, "ledger creation needs the actual local final-master byte receipt");
  assert(ledgerStart > byteLengthStart, "visual-sequence evidence must be derived after final-master byte capture");
  assert(ledgerEnd > ledgerStart, "visual-sequence derivation must finish before independent certificate sidecars");
  assert(certificateStart > ledgerStart, "ledger must be ready before certificate construction");

  const ledgerRegion = source.slice(ledgerStart, ledgerEnd);
  const certificateRegion = source.slice(certificateStart, certificateStart + 2_500);
  assert(
    ledgerRegion.includes("deriveVisualSequenceEvidenceLedger"),
    "final QA must derive the shared sequence ledger from existing receipts",
  );
  assert(
    ledgerRegion.includes("assertVisualSequenceArtifactManifest") &&
      ledgerRegion.includes("artifactManifest.source !== visualSequenceAdapter") &&
      ledgerRegion.includes("classifyVisualSequenceEvidenceRejection") &&
      ledgerRegion.includes("createVisualSequenceEvidenceOmission") &&
      ledgerRegion.includes("visual-sequence evidence omitted") &&
      ledgerRegion.includes("no release or readiness decision changed"),
    "unsupported, invalid, and mismatched inputs must produce bounded omissions, not gates",
  );
  assert(
    !ledgerRegion.includes("visionLocal(") &&
      !ledgerRegion.includes("renderVideo(") &&
      !ledgerRegion.includes("getObjectBytes(") &&
      !ledgerRegion.includes("getObjectIntegrity("),
    "certificate ledger derivation must not trigger a new model, render, or R2 read",
  );
  assert(
    certificateRegion.includes("...(visualSequenceEvidence ? { visualSequenceEvidence } : {})"),
    "certificate attachment must stay optional for legacy and unsupported lanes",
  );
  assert(
    certificateRegion.includes("visualSequenceEvidenceOmission"),
    "certificate must persist a fingerprinted omission when no ledger is attached",
  );
  const qaReportStart = source.indexOf("qaReport:", certificateStart);
  const qaReportRegion = source.slice(qaReportStart, qaReportStart + 1_500);
  assert(
    qaReportRegion.includes("visualSequenceEvidenceOmission"),
    "the bounded certificate omission must also be surfaced in qaReport",
  );

  console.log("Visual sequence certificate wiring tests passed");
}

void main();
