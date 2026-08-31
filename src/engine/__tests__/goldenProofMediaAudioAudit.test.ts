import assert from "node:assert/strict";
import { join } from "node:path";
import { goldenProofMediaEntry } from "@/engine/goldenProofMedia";
import { measureAudio } from "@/lib/ffmpeg";

function mediaPath(id: string): string {
  const entry = goldenProofMediaEntry(id);
  assert.equal(entry.kind, "video", `${id} must name a Golden video fixture`);
  return join(process.cwd(), "public", entry.path);
}

async function mustMeasure(id: string): Promise<number> {
  const meters = await measureAudio(mediaPath(id));
  assert.notEqual(meters.integratedLufs, null, `${id} must expose a measurable audio stream`);
  return meters.integratedLufs!;
}

async function main(): Promise<void> {
  for (const id of ["quiz-flag-video", "quiz-trivia-video"] as const) {
    const quietQuiz = goldenProofMediaEntry(id);
    assert.equal(quietQuiz.status, "context", `${id} must not be Golden release reference evidence while its mix misses the production floor`);
    assert.ok(
      await mustMeasure(id) < -30,
      `${id} must stay demonstrably too quiet for the production loudness gate until a real mixed replacement is audited`,
    );
  }

  for (const id of ["whiteboard-chiquita-video", "documotion-robbery-video"] as const) {
    assert.ok(
      await mustMeasure(id) >= -30,
      `${id} is presented as a narrated Golden reference and must remain within the production loudness floor`,
    );
  }

  const cinematicShot = goldenProofMediaEntry("novita-shot001-video");
  assert.equal(cinematicShot.status, "reference");
  assert.match(
    cinematicShot.family,
    /novita-render-farm/,
    "the silent motion-only fixture is a bounded render-farm reference, not evidence of an audible episode mix",
  );
}

void main().then(
  () => console.log("golden proof media audio audit tests passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
