import assert from "node:assert/strict";
import { FAMILY_KEYS } from "../../../engine/families";
import {
  estimatedWrappedLineCount,
  preflightQuizYearPortraitProof,
  QUIZ_YEAR_PORTRAIT_ASPECT,
  QUIZ_YEAR_PORTRAIT_HEIGHT,
  QUIZ_YEAR_PORTRAIT_OCR_SAFE_REGIONS,
  QUIZ_YEAR_PORTRAIT_SAFE_AREA,
  QUIZ_YEAR_PORTRAIT_WIDTH,
} from "../portraitLayout";
import {
  QUIZ_YEAR_PORTRAIT_WORST_CASE_DURATION_FRAMES,
  QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE,
} from "../portraitProofFixture";

function main(): void {
  const report = preflightQuizYearPortraitProof(QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE);
  assert.equal(report.aspect, QUIZ_YEAR_PORTRAIT_ASPECT);
  assert.equal(report.width, QUIZ_YEAR_PORTRAIT_WIDTH);
  assert.equal(report.height, QUIZ_YEAR_PORTRAIT_HEIGHT);
  assert.equal(report.durationFrames, QUIZ_YEAR_PORTRAIT_WORST_CASE_DURATION_FRAMES);
  assert.equal(report.durationSeconds, 44);
  assert.ok(report.durationSeconds >= 35 && report.durationSeconds <= 60);
  // A renderer proof must never smuggle a new automatic lane into creation.
  assert.equal((FAMILY_KEYS as readonly string[]).includes("quiz_short"), false);
  assert.equal(report.ocrSafeRegions.length, QUIZ_YEAR_PORTRAIT_OCR_SAFE_REGIONS.length);
  for (const region of report.ocrSafeRegions) {
    assert.ok(region.x >= QUIZ_YEAR_PORTRAIT_SAFE_AREA.x, `${region.id} exceeds left safe margin`);
    assert.ok(region.y >= QUIZ_YEAR_PORTRAIT_SAFE_AREA.y, `${region.id} exceeds top safe margin`);
    assert.ok(
      region.x + region.width <= QUIZ_YEAR_PORTRAIT_SAFE_AREA.x + QUIZ_YEAR_PORTRAIT_SAFE_AREA.width,
      `${region.id} exceeds right safe margin`
    );
    assert.ok(
      region.y + region.height <= QUIZ_YEAR_PORTRAIT_SAFE_AREA.y + QUIZ_YEAR_PORTRAIT_SAFE_AREA.height,
      `${region.id} exceeds bottom safe margin`
    );
  }
  assert.ok(estimatedWrappedLineCount("A deliberate long but valid sample sentence", 42, 500) >= 1);

  assert.throws(
    () => preflightQuizYearPortraitProof({ ...QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE, width: 1920, height: 1080 }),
    /1080x1920/
  );
  assert.throws(
    () =>
      preflightQuizYearPortraitProof({
        ...QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE,
        rounds: [
          ...(QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.rounds ?? []),
          {
            ...(QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.rounds?.[0] ?? {}),
            questionText: "Q".repeat(700),
          },
        ] as typeof QUIZ_YEAR_PORTRAIT_WORST_CASE_FIXTURE.rounds,
      }),
    /OCR-safe region/
  );

  console.log("QuizYear portrait proof geometry, OCR-safe regions, duration, and 9:16 preflight checks passed");
}

main();
