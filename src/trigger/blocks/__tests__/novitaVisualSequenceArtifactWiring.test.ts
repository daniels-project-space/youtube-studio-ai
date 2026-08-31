import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const source = await readFile(
    fileURLToPath(new URL("../novitaRenderBlocks.ts", import.meta.url)),
    "utf8",
  );
  const qaStart = source.indexOf('export const qaShots: Block = {');
  const captureStart = source.indexOf(
    "const visualSequenceArtifactManifest =",
    qaStart,
  );
  const captureEnd = source.indexOf("\n    return {", captureStart);
  assert(qaStart >= 0, "qa_shots must remain a real production block");
  assert(captureStart > qaStart, "qa_shots must capture accepted raw artifact bytes");
  assert(captureEnd > captureStart, "artifact capture must run before qa_shots returns");

  const qaHeader = source.slice(qaStart, captureStart);
  const capture = source.slice(captureStart, captureEnd);
  assert(
    qaHeader.includes('"visualSequenceArtifactManifest"'),
    "qa_shots must expose the durable byte artifact manifest to downstream QA",
  );
  assert(
    capture.includes("captureLocalVisualSequenceArtifactManifest"),
    "capture must use the generic local-only artifact utility",
  );
  assert(
    capture.includes("getLocalFileIntegrity: localVisualSequenceArtifactIntegrity"),
    "capture must hash the accepted local files rather than infer bytes from keys",
  );
  assert(
    !capture.includes("getObjectBytes(") &&
      !capture.includes("getObjectIntegrity(") &&
      !capture.includes("renderVideo(") &&
      !capture.includes("visionLocal("),
    "post-QA byte capture must add no R2 download, provider request, render, or review call",
  );

  console.log("Novita visual-sequence artifact wiring tests passed");
}

void main();
