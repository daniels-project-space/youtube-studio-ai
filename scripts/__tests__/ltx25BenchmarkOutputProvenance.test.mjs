import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLtx25BenchmarkOutputBinding,
  assertLtx25ControllerMediaMatchesWorkerProof,
  createLtx25BenchmarkOutputBinding,
  mediaFactsFromFfprobe,
} from "../lib/ltx25BenchmarkOutputProvenance.mjs";

const ffprobeFixture = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "0.680000" },
  streams: [{
    codec_type: "video",
    codec_name: "h264",
    pix_fmt: "yuv420p",
    width: 2560,
    height: 1408,
    avg_frame_rate: "25/1",
    nb_read_frames: "17",
  }, {
    codec_type: "audio",
    codec_name: "aac",
    channels: 2,
    sample_rate: "48000",
  }],
};

const mediaFacts = mediaFactsFromFfprobe(ffprobeFixture);

test("builds a controller-calculated byte binding with normalized ffprobe facts", async () => {
  const bytes = Buffer.from("offline-ltx25-output-fixture");
  const binding = await createLtx25BenchmarkOutputBinding({
    bytes,
    probeMediaFacts: async (received) => {
      assert.strictEqual(received, bytes);
      return mediaFacts;
    },
  });

  assert.equal(binding.sha256, "fb99a1cfb176868319b144146b25a40fd12880c3449cf1c815ac21b866980ea4");
  assert.equal(binding.sizeBytes, bytes.byteLength);
  assert.deepEqual(binding.media, {
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    durationSeconds: 0.68,
    video: { codec: "h264", pixelFormat: "yuv420p", width: 2560, height: 1408, frameRate: 25, frameCount: 17 },
    audio: { present: true, codec: "aac", channels: 2, sampleRate: 48000 },
  });
});

test("rejects missing immutable output bindings and mismatched worker geometry", () => {
  assert.throws(
    () => assertLtx25BenchmarkOutputBinding({ sha256: "a".repeat(64), sizeBytes: 12, media: { container: "mp4", durationSeconds: 0.68 } }),
    /require a video stream/,
  );
  assert.throws(
    () => assertLtx25ControllerMediaMatchesWorkerProof(
      { sha256: "a".repeat(64), sizeBytes: 12, media: mediaFacts },
      { outputWidth: 2560, outputHeight: 1408, frameRate: 25, frameCount: 16, hasAudio: true },
    ),
    /does not match/,
  );
  assert.throws(
    () => assertLtx25ControllerMediaMatchesWorkerProof(
      { sha256: "a".repeat(64), sizeBytes: 12, media: mediaFacts },
      { outputWidth: 2560, outputHeight: 1408, frameRate: 25, frameCount: 17, hasAudio: false },
    ),
    /does not match/,
  );
});

test("rejects incomplete ffprobe fixtures rather than recording inferred media facts", () => {
  assert.throws(
    () => mediaFactsFromFfprobe({ format: { format_name: "mp4", duration: "0.68" }, streams: [] }),
    /did not find a video stream/,
  );
  assert.throws(
    () => mediaFactsFromFfprobe({
      ...ffprobeFixture,
      streams: [
        { ...ffprobeFixture.streams[0], nb_read_frames: "N/A", nb_frames: "N/A" },
        ffprobeFixture.streams[1],
      ],
    }),
    /frame count/,
  );
  assert.throws(
    () => mediaFactsFromFfprobe({ ...ffprobeFixture, streams: [ffprobeFixture.streams[0]] }),
    /exactly one audio stream/,
  );
});
