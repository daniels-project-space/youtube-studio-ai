import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  buildShotSpecs,
  normalizeDocuPlan,
  removeChromaBackground,
} from "@/lib/documotion";

const renderBlockSource = readFileSync(
  new URL("../../trigger/render-block.ts", import.meta.url),
  "utf8",
);
const documotionSource = readFileSync(new URL("../documotion.ts", import.meta.url), "utf8");
const runPipelineSource = readFileSync(
  new URL("../../trigger/runPipeline.ts", import.meta.url),
  "utf8",
);

function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(-500)}`));
    });
  });
}

// A heavy remote child can contain paid TTS and image work. A crash/OOM is an
// ambiguous post-spend failure until durable per-operation resume exists;
// Trigger must not replay the whole child automatically.
assert.match(renderBlockSource, /retry:\s*\{\s*maxAttempts:\s*1,/);
assert.match(renderBlockSource, /must reconcile rather than make\s*\n\s*\/\/ Trigger replay the entire child attempt/i);
assert.match(runPipelineSource, /blockId === "documotion_short"/);
assert.match(runPipelineSource, /provider cost is UNKNOWN and automatic replay\/heal is forbidden/);
assert.match(runPipelineSource, /let childDispatchStarted = false/);
assert.match(runPipelineSource, /childDispatchStarted = true/);
assert.match(runPipelineSource, /result\.error\?\.includes\(PAID_STAGE_RECONCILIATION_MARKER\)/);

// The renderer must own no secret paid image sub-routes. Its only generated
// pixels arrive through the injected attested generator; cutout and camera
// depth are local operations over those already-approved bytes.
assert.doesNotMatch(
  documotionSource,
  /fal-ai\/birefnet|fal-ai\/imageutils\/marigold-depth|getDepthMap|REPLICATE_API_TOKEN|generateBananaImage|generateFalImage/,
);
assert.match(documotionSource, /an explicit attested image generator is required/);
assert.match(documotionSource, /flat solid chroma green #00FF00 background/);
assert.match(documotionSource, /hidden paid depth extraction is disabled/);
assert.match(
  documotionSource,
  /local chroma isolation failed[\s\S]{0,300}using the approved full plate/,
  "a local isolation failure may degrade to the approved plate without buying replacement pixels",
);

async function localChromaProducesRealAlpha(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "documotion-chroma-"));
  try {
    const source = join(dir, "source.png");
    const cutout = join(dir, "cutout.png");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi",
      "-i", "color=c=0x00FF00:s=64x64:d=1,drawbox=x=20:y=20:w=24:h=24:color=red:t=fill",
      "-frames:v", "1",
      source,
    ]);
    await removeChromaBackground(source, cutout);
    const rgba = await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", cutout,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "pipe:1",
    ]);
    assert.equal(rgba.length, 64 * 64 * 4, "the keyed PNG must retain the source geometry");
    let transparent = 0;
    let opaque = 0;
    for (let index = 3; index < rgba.length; index += 4) {
      if (rgba[index] <= 8) transparent += 1;
      if (rgba[index] >= 247) opaque += 1;
    }
    assert.ok(transparent > 2_500, `expected a transparent green field, saw ${transparent} pixels`);
    assert.ok(opaque > 400, `expected the red subject to remain opaque, saw ${opaque} pixels`);

    const migrated = normalizeDocuPlan({
      title: "Depth proof",
      styleId: "archival_collage",
      shots: [{
        kind: "depth_parallax",
        narration: "The subject steps through the reconstructed room.",
        scale: "wide",
        beat: "camera crosses the room",
        durationSec: 4,
        camera: { move: "push_in", intensity: "medium" },
        assets: [{ id: "legacy-plate", role: "image", brief: "the room and its subject", source: "generate" }],
      }],
    });
    assert.deepEqual(migrated.shots[0]?.assets.map((asset) => asset.role), ["bg", "fg"]);
    assert.equal(migrated.shots[0]?.assets[0]?.id, "legacy-plate", "legacy evidence ids must stay on the base plate");
    assert.equal(migrated.shots[0]?.assets[1]?.id, "legacy-plate-near");
    const specs = await buildShotSpecs(migrated, [
      { shotIdx: 0, id: "legacy-plate", role: "bg", path: source, approvalSha256: "a".repeat(64) },
      { shotIdx: 0, id: "legacy-plate-near", role: "fg", path: cutout, approvalSha256: "b".repeat(64) },
    ], 4);
    assert.equal(specs[0]?.images?.length, 2, "depth shots must reach Remotion as base + keyed near plane");
    assert.match(specs[0]?.images?.[0] ?? "", /^data:image\/png;base64,/);
    assert.match(specs[0]?.images?.[1] ?? "", /^data:image\/png;base64,/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void localChromaProducesRealAlpha().then(() => {
  console.log("DocuMotion paid-route and real-pixel local compositing tests passed");
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
