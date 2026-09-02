import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

type ScheduledLayer = {
  layerIdx: number;
  kind: "art" | "label";
  cueStartMs: number;
  drawStartMs: number;
  drawEndMs: number;
  handLingerEndMs: number;
  handSampleMs: number;
};

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "ysa-whiteboard-full-panel-"));
  try {
    // Use isolated copies so this is a genuine five-layer renderer proof, not
    // a schedule-only fixture or a cache hit. The hand sprite is valid opaque
    // line art with enough ink for production's 3.0–4.5 second trace window.
    await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      await copyFile(join(ROOT, "src/assets/whiteboard/hand.png"), join(work, `art-${index}.png`));
    }));
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "28.0",
      "-c:a", "libmp3lame", join(work, "narration.mp3"),
    ]);

    const timeline = {
      title: "FULL PANEL DRAW PROOF",
      header: "FULL PANEL DRAW PROOF",
      headerBox: [0.18, 0.04, 0.64, 0.10],
      dir: work,
      audio: "narration.mp3",
      width: 640,
      height: 360,
      prerollSec: 0.1,
      fps: 8,
      audioEndMs: 27_900,
      tailMs: 100,
      boardMode: "white",
      board: "#f3f1eb",
      ink: "#000000",
      accent: "#c0392b",
      panels: [{
        idx: 0,
        startMs: 0,
        endMs: 28_000,
        layers: [
          { kind: "art", art: "art-0.png", box: [0.08, 0.22, 0.36, 0.38], cueStartMs: 0 },
          { kind: "art", art: "art-1.png", box: [0.52, 0.22, 0.18, 0.22], cueStartMs: 4_700 },
          { kind: "art", art: "art-2.png", box: [0.74, 0.22, 0.18, 0.22], cueStartMs: 9_400 },
          { kind: "art", art: "art-3.png", box: [0.55, 0.53, 0.22, 0.18], cueStartMs: 14_100 },
          { kind: "label", text: "EVERY LAYER", color: "#c0392b", box: [0.10, 0.77, 0.34, 0.09], cueStartMs: 18_800 },
        ],
      }],
    };
    await writeFile(join(work, "timeline.json"), JSON.stringify(timeline), "utf8");

    const out = join(work, "proof.mp4");
    await execFileAsync("python3", [
      "scripts/wb_scribe_sync.py",
      join(work, "timeline.json"),
      out,
      "src/assets/whiteboard/hand.png",
    ], { cwd: ROOT });

    const receipt = JSON.parse(await readFile(`${out}.draw-receipt.json`, "utf8")) as {
      version: string;
      narrationStartSec: number;
      panels: Array<{ completionSampleMs: number; endMs: number; layers: ScheduledLayer[] }>;
    };
    const panel = receipt.panels[0];
    assert.equal(receipt.version, "whiteboard-render-schedule/v1");
    assert.equal(receipt.narrationStartSec, timeline.prerollSec);
    assert.ok(panel, "the production renderer must emit its one authored panel");
    assert.deepEqual(
      panel.layers.map((layer) => layer.layerIdx),
      [0, 1, 2, 3, 4],
      "every late art and label layer must have a renderer-issued trace, not only the first board assets",
    );
    assert.deepEqual(
      panel.layers.map((layer) => layer.kind),
      ["art", "art", "art", "art", "label"],
      "the renderer must retain both visual drawings and native handwritten labels",
    );
    for (const [index, layer] of panel.layers.entries()) {
      assert.ok(layer.drawEndMs > layer.drawStartMs, `layer ${index} must have a non-zero visible trace`);
      assert.ok(
        layer.handSampleMs > layer.drawStartMs && layer.handSampleMs < layer.drawEndMs,
        `layer ${index} must expose a reviewable in-progress hand frame`,
      );
      if (layer.kind === "art") {
        assert.ok(
          layer.drawEndMs - layer.drawStartMs >= 3_000,
          `art layer ${index} must retain production's minimum three-second hand-draw duration`,
        );
        assert.ok(
          layer.handLingerEndMs - layer.drawEndMs >= 1_000,
          `art layer ${index} must retain the hand after its final stroke`,
        );
      }
      if (index > 0) {
        assert.ok(
          layer.drawStartMs >= panel.layers[index - 1]!.handLingerEndMs,
          `layer ${index} must wait for the preceding trace instead of popping in or using a second hand`,
        );
      }
    }
    assert.ok(
      panel.completionSampleMs > panel.layers.at(-1)!.handLingerEndMs && panel.completionSampleMs < panel.endMs,
      "the completed board must be sampled after every layer, before its narration window ends",
    );

    // A finished MP4 plus renderer-authored samples proves this path executed
    // frame generation rather than returning a fabricated schedule. Inspect a
    // late trace and the cumulative completed-board frame: both must contain
    // the required visual evidence, including the final handwritten label.
    const late = panel.layers[3]!;
    const completionFrame = Math.floor((receipt.narrationStartSec + panel.completionSampleMs / 1_000) * timeline.fps);
    const lateFrame = Math.floor((receipt.narrationStartSec + late.handSampleMs / 1_000) * timeline.fps);
    const inspection = await execFileAsync("python3", [
      "-c",
      [
        "from PIL import Image; import sys",
        "def count(path):",
        " im=Image.open(path).convert('RGB')",
        " return sum(1 for pixel in im.getdata() if pixel != (243,241,235))",
        "def red(path):",
        " im=Image.open(path).convert('RGB')",
        " return sum(1 for r,g,b in im.getdata() if r > 120 and g < 105 and b < 105)",
        "print(count(sys.argv[1]), red(sys.argv[2]))",
      ].join("\n"),
      `${out}_frames/${String(lateFrame).padStart(5, "0")}.png`,
      `${out}_frames/${String(completionFrame).padStart(5, "0")}.png`,
    ]);
    const [latePixels, completedLabelPixels] = inspection.stdout.trim().split(/\s+/).map(Number);
    assert.ok(latePixels > 6_000, "a later fourth drawing must visibly render, not be absent after early layers");
    assert.ok(completedLabelPixels > 100, "the finished panel must retain its native handwritten label cumulatively");
    assert.ok((await readFile(out)).byteLength > 30_000, "the full production-timing MP4 must exist");
    console.log("whiteboard full-panel production render: PASS");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
