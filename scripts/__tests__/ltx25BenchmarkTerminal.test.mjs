import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  createLtx25BenchmarkTerminal,
  sha256,
} from "../lib/ltx25BenchmarkTerminal.mjs";

const contract = "ltx-2.5-rtx4090-benchmark/v1";

function completeReport() {
  return {
    contract,
    ok: true,
    nonce: "nonce",
    outputs: [{
      id: "clip",
      key: "run/video/clip.mp4",
      controllerProof: {
        sha256: "a".repeat(64),
        sizeBytes: 12,
        media: {
          container: "mov,mp4,m4a,3gp,3g2,mj2",
          durationSeconds: 0.68,
          video: { codec: "h264", pixelFormat: "yuv420p", width: 2560, height: 1408, frameRate: 25, frameCount: 17 },
          audio: { present: true, codec: "aac", channels: 2, sampleRate: 48000 },
        },
      },
    }],
  };
}

function createR2Double({ interruptWhileWritingReport = false, corruptHead = false } = {}) {
  const objects = new Map();
  let terminal;
  const putJson = async (key, value, metadata = {}) => {
    if (interruptWhileWritingReport && key === "run/report.json") {
      await terminal.markIncomplete({ signal: "SIGTERM" });
    }
    objects.set(key, { value, metadata, contentLength: Buffer.byteLength(JSON.stringify(value)) });
  };
  const headObject = async (key) => {
    const item = objects.get(key);
    return corruptHead
      ? { ContentLength: item.contentLength - 1, Metadata: item.metadata }
      : { ContentLength: item.contentLength, Metadata: item.metadata };
  };
  terminal = createLtx25BenchmarkTerminal({
    contract,
    reportKey: "run/report.json",
    incompleteKey: "run/incomplete.json",
    nonce: "nonce",
    ltxModelManifestKey: "novita/model-manifests/ltx-2.5-test.json",
    putJson,
    headObject,
  });
  return { terminal, objects };
}

test("seals a complete report with deterministic content and verified R2 metadata", async () => {
  const { terminal, objects } = createR2Double();
  const unsigned = completeReport();
  const report = await terminal.sealSuccess(unsigned);

  const core = { ...unsigned, status: "complete" };
  assert.equal(report.reportSha256, sha256(canonicalJson(core)));
  assert.equal(terminal.state(), "complete");
  assert.equal(objects.get("run/report.json").metadata["terminal-status"], "complete");
  await terminal.markIncomplete({ error: new Error("late cleanup error") });
  assert.equal(objects.has("run/incomplete.json"), false);
});

test("a failed seal cannot become a completed benchmark and receives an incomplete receipt", async () => {
  const { terminal, objects } = createR2Double({ corruptHead: true });
  await assert.rejects(terminal.sealSuccess(completeReport()), /could not be sealed/);
  await terminal.markIncomplete({ error: new Error("R2 verification failed") });

  assert.equal(terminal.state(), "incomplete");
  assert.equal(objects.get("run/incomplete.json").value.status, "incomplete");
});

test("an interruption during an in-flight report write makes the incomplete receipt win", async () => {
  const { terminal, objects } = createR2Double({ interruptWhileWritingReport: true });
  await assert.rejects(terminal.sealSuccess(completeReport()), /interrupted while sealing/);

  assert.equal(terminal.state(), "incomplete");
  assert.equal(objects.get("run/incomplete.json").value.signal, "SIGTERM");
});

test("refuses a complete report whose output is not controller-bound", async () => {
  const { terminal, objects } = createR2Double();
  const unsigned = completeReport();
  delete unsigned.outputs[0].controllerProof;

  await assert.rejects(terminal.sealSuccess(unsigned), /controller output proof requires a SHA-256/);
  assert.equal(terminal.state(), "running");
  assert.equal(objects.has("run/report.json"), false);
});

test("refuses a controller proof that omits independently probed audio", async () => {
  const { terminal, objects } = createR2Double();
  const unsigned = completeReport();
  delete unsigned.outputs[0].controllerProof.media.audio;

  await assert.rejects(terminal.sealSuccess(unsigned), /require an audio stream/);
  assert.equal(terminal.state(), "running");
  assert.equal(objects.has("run/report.json"), false);
});
