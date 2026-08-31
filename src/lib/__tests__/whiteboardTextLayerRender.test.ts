import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "ysa-whiteboard-text-"));
  try {
    const rendererSource = await readFile(join(ROOT, "scripts/wb_scribe_sync.py"), "utf8");
    assert.match(
      rendererSource,
      /if L\["kind"\] == "label" and prog >= 1\.0:/,
      "only completed labels may reserve hand-safe space; the active handwritten label must retain its hand",
    );
    assert.match(
      rendererSource,
      /raise RuntimeError\(f"whiteboard layer could not rasterize:/,
      "a planned but unrasterizable layer must hard-fail instead of silently disappearing",
    );
    assert.match(
      rendererSource,
      /MIN_DRAW = float\(os\.environ\.get\("WB_MIN_DRAW", 3\.0\)\)/,
      "production art beats must reserve a visible hand trace rather than an icon-like pop-in",
    );
    assert.match(
      rendererSource,
      /ART_HAND_LINGER = float\(os\.environ\.get\("WB_ART_HAND_LINGER", 1\.0\)\)/,
      "every approved art beat must retain a visible finishing hand, not just the final board visual",
    );
    assert.match(
      rendererSource,
      /FINAL_ART_HAND_LINGER = float\(os\.environ\.get\("WB_FINAL_ART_HAND_LINGER", 2\.4\)\)/,
      "the last board visual must retain its hand at the finishing point instead of becoming a silent pop-in",
    );
    assert.match(
      rendererSource,
      /hand_obscures_label = not hand_is_actively_finishing and any\(/,
      "a hand actively finishing a drawing must remain visible even when it crosses a completed footer label",
    );
    assert.match(
      rendererSource,
      /cannot fit \{len\(layers\)\} cue-aligned visible hand-drawing events/,
      "an overcrowded board must fail upstream instead of silently advancing a later drawing before its cue",
    );
    await copyFile(join(ROOT, "src/assets/whiteboard/hand.png"), join(work, "art.png"));
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "8.0",
      "-c:a", "libmp3lame", join(work, "narration.mp3"),
    ]);
    const timeline = {
      title: "TEXT LAYER PROOF",
      header: "TEXT LAYER PROOF",
      headerBox: [0.20, 0.04, 0.60, 0.10],
      dir: work,
      audio: "narration.mp3",
      width: 640,
      height: 360,
      prerollSec: 0.1,
      fps: 10,
      audioEndMs: 8_000,
      tailMs: 100,
      boardMode: "white",
      board: "#f3f1eb",
      ink: "#000000",
      accent: "#c0392b",
      panels: [{
        idx: 0,
        startMs: 0,
        endMs: 8_100,
        // `text` is the canonical TypeScript storyboard value. The renderer
        // must not require the old internal `label` spelling, or allow the
        // art auto-layout to push a planned footer label into the frame edge.
        layers: [
          {
            kind: "art",
            art: "art.png",
            box: [0.18, 0.18, 0.64, 0.62],
            cueStartMs: 0,
          },
          {
            kind: "text",
            text: "TEXT LAYER PASSED",
            color: "#c0392b",
            box: [0.18, 0.84, 0.64, 0.08],
            cueStartMs: 0,
          },
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
    ], {
      cwd: ROOT,
      // This narrow pixel-layout fixture tests text/hand composition, not the
      // production pacing contract. Keep its synthetic 1.1s panel executable
      // while production retains the non-compressible visible draw timings.
      env: {
        ...process.env,
        WB_MIN_DRAW: "0.1",
        WB_MAX_DRAW: "0.2",
        WB_HOLD: "0.01",
        WB_FINAL_ART_HAND_LINGER: "0.01",
      },
    });
    const frame = await readFile(`${out}_frames/00079.png`);
    const inspection = await execFileAsync("python3", [
      "-c",
      "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGB'); ys=[y for y in range(im.height) for x in range(im.width) if (lambda c: c[0] > 120 and c[1] < 100 and c[2] < 100)(im.getpixel((x,y)))]; print(len(ys), max(ys) if ys else -1)",
      `${out}_frames/00079.png`,
    ]);
    assert.ok(frame.byteLength > 1_000, "renderer must retain an actual final frame");
    assert.ok(
      Number(inspection.stdout.trim().split(/\s+/)[0]) > 100,
      "a canonical text layer with the channel accent must produce visible accent pixels in the final frame",
    );
    assert.ok(
      Number(inspection.stdout.trim().split(/\s+/)[1]) < 340,
      "a planned footer label must retain a visible bottom safe margin after artwork layout",
    );
    console.log("whiteboard text-layer pixel render: PASS");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
