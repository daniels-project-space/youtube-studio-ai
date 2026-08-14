import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { proveOnScreenText, sha256OnScreenTextSource } from "@/lib/onScreenTextProof";

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "on-screen-text-proof-test-"));
  const videoPath = join(tempDir, "master.mp4");
  const bytes = Buffer.from("synthetic final master");
  writeFileSync(videoPath, bytes);
  const sourceSha256 = await sha256OnScreenTextSource(videoPath);
  assert.equal(sourceSha256, createHash("sha256").update(bytes).digest("hex"));

  let ocrCalls = 0;
  const proof = await proveOnScreenText({
    videoPath,
    sourceSha256,
    cues: [{ id: "round-01", sampleSec: 1, expectedText: "Which city is the capital of France Paris London Rome Madrid", minTokenCoverage: 0.8 }],
    frameExtractor: async (_video, _second, out) => { writeFileSync(out, "frame"); return out; },
    runner: (_command, args) => {
      if (args[0] === "--version") return { status: 0, stdout: "tesseract 5.3.4\n", stderr: "" };
      ocrCalls += 1;
      return { status: 0, stdout: "Which city is the capital of France? Paris London Rome Madrid", stderr: "" };
    },
  });
  assert.equal(ocrCalls, 1);
  assert.equal(proof.passed, true);
  assert.equal(proof.cues[0]?.tokenCoverage, 1);

  const failed = await proveOnScreenText({
    videoPath,
    sourceSha256,
    cues: [{ id: "round-02", sampleSec: 2, expectedText: "Question answer alpha beta", minTokenCoverage: 0.8 }],
    frameExtractor: async (_video, _second, out) => { writeFileSync(out, "frame"); return out; },
    runner: (_command, args) => args[0] === "--version"
      ? { status: 0, stdout: "tesseract 5.3.4\n", stderr: "" }
      : { status: 0, stdout: "Question alpha", stderr: "" },
  });
  assert.equal(failed.passed, false, "missing display words must be visible in the receipt, not treated as a pass");
  await assert.rejects(
    () => proveOnScreenText({
      videoPath,
      sourceSha256: "a".repeat(64),
      cues: [{ id: "wrong-master", sampleSec: 1, expectedText: "Question answer alpha beta", minTokenCoverage: 0.8 }],
    }),
    /does not match the final-master bytes/,
    "OCR evidence must bind to the exact master, not only a caller-provided digest",
  );
  await assert.rejects(
    () => proveOnScreenText({
      videoPath,
      sourceSha256,
      cues: [{ id: "short", sampleSec: 0, expectedText: "one", minTokenCoverage: 1 }],
    }),
    /at least two readable tokens/,
  );
  console.log("on-screen text proof tests passed");
}

void main();
