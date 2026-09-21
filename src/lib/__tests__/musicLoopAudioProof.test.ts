import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("independent loop audio oracle detects missing fades and changed output gain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-audio-proof-"));
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  const reference = join(directory, "loop.wav");
  try {
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=21.25",
      "-ac", "2", "-c:a", "pcm_f32le", reference], { timeout: 120_000 });
    for (const [name, filters, expected] of [
      ["complete", "afade=t=in:st=0:d=2,afade=t=out:st=60:d=4", undefined],
      ["missing-intro", "afade=t=out:st=60:d=4", /fade_in:/],
      ["missing-ending", "afade=t=in:st=0:d=2", /fade_out:/],
      ["wrong-gain", "afade=t=in:st=0:d=2,afade=t=out:st=60:d=4,volume=0.5", /unexpected gain/],
    ] as const) {
      const master = join(directory, `${name}.m4a`);
      execFileSync(ffmpeg, ["-v", "error", "-stream_loop", "-1", "-i", reference, "-t", "64",
        "-af", filters, "-c:a", "aac", "-b:a", "384k", master], { timeout: 120_000 });
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-yue2-assembly-audio.ts", reference, master], {
        encoding: "utf8", timeout: 30_000,
      });
      assert.equal(result.error, undefined);
      if (expected) {
        assert.equal(result.status, 1, `${name} must be rejected`);
        assert.match(result.stderr, expected);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const evidence = JSON.parse(result.stdout);
        assert.equal(evidence.version, "yue2-assembly-audio-alignment/v3");
        assert.deepEqual(new Set(evidence.results.map((window: { kind: string }) => window.kind)),
          new Set(["body", "wrap", "fade_in", "fade_out"]));
        assert.ok(evidence.results.some((window: { kind: string; seconds: number }) => window.kind === "fade_out" && window.seconds === 63),
          "the final window crosses the 63.75-second source wrap while fading");
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
