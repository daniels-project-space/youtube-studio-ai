/**
 * Opt-in real-VLM proof for the visual-review module. It deliberately does not
 * run in normal CI: it makes managed vision calls and therefore requires an
 * explicitly configured provider plus VISUAL_REVIEW_LIVE=1.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { reviewRender, type VisualReviewIntent } from "@/lib/visualReview";

// Match Next/Trigger's local development environment when this proof is run
// directly through tsx. This loads variable names and values into process.env
// without printing or copying any secret.
loadEnvConfig(process.cwd());

if (process.env.VISUAL_REVIEW_LIVE !== "1") {
  console.log("visual-review live proof skipped (set VISUAL_REVIEW_LIVE=1 with a configured vision provider)");
  process.exit(0);
}

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const poster = join(process.cwd(), "public", "golden", "comic", "comic3d.jpg");

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "ysa-visual-live-"));
  try {
    // Render a clean, real comic-panel video from the Golden comic artwork.
    // The source MP4 deliberately shows a hand progressively drawing blank
    // shapes, which is itself a valid animation but makes a clean-placement
    // control ambiguous to a vision model. The finished Golden panel is the
    // appropriate baseline for testing only injected overlay placement.
    const clean = join(work, "clean-comic.mp4");
    const cleanRendered = spawnSync(
      FFMPEG,
      [
        "-y", "-loop", "1", "-framerate", "30", "-i", poster, "-t", "18",
        "-vf",
        "scale=2304:1296,zoompan=z='min(zoom+0.00008,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,format=yuv420p",
        "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", clean,
      ],
      { encoding: "utf8", maxBuffer: 1 << 26 },
    );
    assert.equal(cleanRendered.status, 0, cleanRendered.stderr?.slice(-1200));
    const faulty = join(work, "bad-comic.mp4");
    const rendered = spawnSync(
      FFMPEG,
      [
        "-y", "-i", clean,
        "-vf",
        [
          "drawbox=x=650:y=190:w=560:h=360:color=white@1:t=fill:enable='between(t,6,10)'",
          "drawbox=x=650:y=190:w=560:h=360:color=black@1:t=7:enable='between(t,6,10)'",
          "drawbox=x=1810:y=640:w=280:h=200:color=white@1:t=fill:enable='between(t,6,10)'",
          "drawbox=x=1810:y=640:w=280:h=200:color=black@1:t=7:enable='between(t,6,10)'",
        ].join(","),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", faulty,
      ],
      { encoding: "utf8", maxBuffer: 1 << 26 },
    );
    assert.equal(rendered.status, 0, rendered.stderr?.slice(-1200));
    const intent: VisualReviewIntent = {
      title: "The Silent Night — known bad comic overlay fixture",
      topic: "Comic-book review validation",
      // This fixture is a finished comic-panel video. It has no
      // narration/title/outro requirement: the live reviewer should judge
      // visible overlay placement, not invent a different editorial format.
      expectedStructure:
        "A completed comic panel with a slow intentional camera move. There is no required title card, outro card, or narration. " +
        "A legitimate speech bubble may appear in the safe upper part of the panel, " +
        "but they must stay in-frame and must not cover the main character's face or artwork.",
      expectTitleCard: false,
      expectOutroCard: false,
      allowedVisualConditions: [
        "The completed original speech bubble above the main character is intentional when it remains inside the panel and leaves the face visible.",
        "The camera intentionally crops the surrounding comic page at the bottom and right edges; partial adjacent panels or page borders are not an off-canvas overlay defect.",
        "The deliberate slow camera move may hold the same finished panel for the full test clip; do not call that frozen or repeated footage.",
      ],
      overlays: [
        { id: "p0-b0", kind: "comic_bubble", startSec: 6, endSec: 10 },
        { id: "p0-b1", kind: "comic_bubble", startSec: 6, endSec: 10 },
      ],
    };
    const failed = await reviewRender(faulty, 18, intent, {
      runId: `visual-live-${Date.now()}`,
      keyPrefix: "validation/",
      required: true,
      persistEvidence: false,
      maxFrames: 40,
      maxFocusFrames: 24,
      log: console.log,
    });
    const visualFault = failed.defects.find((defect) =>
      defect.source === "vision" &&
      ["overlay_off_canvas", "overlay_occlusion", "overlay_collision", "caption_cutoff", "caption_unreadable"].includes(defect.category) &&
      defect.startSec >= 4 && defect.startSec <= 12,
    );
    assert(visualFault, `live VLM failed to identify the known bad overlay/position issue: ${JSON.stringify(failed.defects)}`);

    const repaired = await reviewRender(clean, 18, {
      ...intent,
      focusWindows: [{ startSec: 4.8, endSec: 11.2, reason: "repair" }],
      overlays: [],
    }, {
      runId: `visual-live-repaired-${Date.now()}`,
      keyPrefix: "validation/",
      required: true,
      persistEvidence: false,
      maxFrames: 40,
      maxFocusFrames: 24,
      log: console.log,
    });
    const remaining = repaired.defects.filter((defect) =>
      defect.source === "vision" && defect.severity !== "minor" &&
      ["overlay_off_canvas", "overlay_occlusion", "overlay_collision", "caption_cutoff", "caption_unreadable"].includes(defect.category),
    );
    assert.equal(remaining.length, 0, `repaired comic still has blocking overlay defects: ${JSON.stringify(remaining)}`);
    assert.equal(repaired.verdict, "pass", `repaired comic must clear the complete focused re-review: ${JSON.stringify(repaired.defects)}`);
    console.log("visual-review live comic proof passed", { failed: visualFault, repairedFrames: repaired.evidence.frames.length });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
