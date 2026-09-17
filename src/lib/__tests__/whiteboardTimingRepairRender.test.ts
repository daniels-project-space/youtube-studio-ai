import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  WHITEBOARD_TIMING_REPAIR_VERSION,
  type WhiteboardTimingRepair,
} from "@/lib/whiteboardSync";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

type DrawReceipt = {
  timingRepair?: WhiteboardTimingRepair;
  panels: Array<{
    completionSampleMs: number;
    layers: Array<{ drawStartMs: number; drawEndMs: number; handLingerEndMs: number }>;
  }>;
};

async function render(timingRepair?: WhiteboardTimingRepair): Promise<DrawReceipt> {
  const work = await mkdtemp(join(tmpdir(), "ysa-whiteboard-timing-repair-"));
  try {
    await copyFile(join(ROOT, "src/assets/whiteboard/hand.png"), join(work, "art.png"));
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "18",
      "-c:a", "libmp3lame", join(work, "narration.mp3"),
    ]);
    await writeFile(join(work, "timeline.json"), JSON.stringify({
      title: "TRACE REPAIR PROOF",
      header: "TRACE REPAIR PROOF",
      headerBox: [0.18, 0.04, 0.64, 0.10],
      dir: work,
      audio: "narration.mp3",
      width: 640,
      height: 360,
      prerollSec: 0.1,
      fps: 8,
      audioEndMs: 17_900,
      tailMs: 100,
      boardMode: "white",
      board: "#f3f1eb",
      ink: "#000000",
      accent: "#c0392b",
      ...(timingRepair ? { timingRepair } : {}),
      panels: [{
        idx: 0,
        startMs: 0,
        endMs: 18_000,
        layers: [{ kind: "art", art: "art.png", box: [0.20, 0.25, 0.52, 0.52], cueStartMs: 1_000 }],
      }],
    }), "utf8");
    const out = join(work, "proof.mp4");
    await execFileAsync("python3", [
      "scripts/wb_scribe_sync.py", join(work, "timeline.json"), out, "src/assets/whiteboard/hand.png",
    ], { cwd: ROOT });
    assert.ok((await readFile(out)).byteLength > 20_000, "renderer must output a real MP4");
    return JSON.parse(await readFile(`${out}.draw-receipt.json`, "utf8")) as DrawReceipt;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const repair: WhiteboardTimingRepair = {
    version: WHITEBOARD_TIMING_REPAIR_VERSION,
    mode: "strengthen_draw_trace",
    targetStartMs: 0,
    targetEndMs: 12_000,
    drawMultiplier: 1.25,
    handLingerMultiplier: 1.25,
    panelHoldMultiplier: 1.25,
  };
  const normal = await render();
  const repaired = await render(repair);
  const normalPanel = normal.panels[0]!;
  const repairedPanel = repaired.panels[0]!;
  const normalLayer = normalPanel.layers[0]!;
  const repairedLayer = repairedPanel.layers[0]!;

  assert.deepEqual(repaired.timingRepair, repair, "the renderer receipt must bind the requested repair contract");
  assert.ok(
    repairedLayer.drawEndMs - repairedLayer.drawStartMs > normalLayer.drawEndMs - normalLayer.drawStartMs,
    "a targeted repair must visibly lengthen the actual hand-draw interval",
  );
  assert.ok(
    repairedLayer.handLingerEndMs - repairedLayer.drawEndMs > normalLayer.handLingerEndMs - normalLayer.drawEndMs,
    "a targeted repair must visibly lengthen the hand linger",
  );
  assert.ok(
    repairedPanel.completionSampleMs > normalPanel.completionSampleMs,
    "a targeted repair must move the completed-board proof later rather than replay the original schedule",
  );
  console.log("whiteboard timing repair renderer proof: PASS");
}

void main();
