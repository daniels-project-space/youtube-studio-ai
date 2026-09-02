import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const board = readFileSync(`${here}/DayByDaySchedule.tsx`, "utf8");
const styles = readFileSync(`${here}/schedule.module.css`, "utf8");

assert.match(page, /Array\.from\(\{ length: 14 \}/,
  "the release signal must be derived from fourteen real calendar days");
assert.match(page, /calendar\.flat\.filter/,
  "release rhythm must be derived from the persisted calendar model");
assert.match(page, /summary\.pinned/,
  "the schedule header must distinguish pinned exceptions from cadence projections");
assert.match(page, /api\.contentPlan\.setScheduledAt/,
  "the redesigned exact-date control must remain connected to the scheduling mutation");
assert.match(page, /Open \$\{nextEvent\.title\} production details/,
  "the next scheduled release must open its exact production record");
assert.match(page, /channelHref\(nextEvent\.slug, "week-ahead", nextEvent\.id\)/,
  "the next-release summary must preserve the planned item identity");
assert.match(page, /Seven-day board/);
assert.match(page, /Month map/);
assert.match(page, /Cadence controls/);
assert.match(board, /aspectRatio="16 \/ 9"/,
  "the operational week board must show packaging artwork at a legible video ratio");
assert.match(board, /event\.type === "planned" \? event\.id : undefined/,
  "planned calendar cards must carry the exact plan item into the channel workspace");
assert.match(board, /event\.thumbnailSource === "rendered_video_frame"/,
  "Lo-Fi scheduled cards must show their final-frame state instead of requesting a generic planner image");
assert.match(styles, /prefers-reduced-motion: reduce/,
  "schedule motion must expose a reduced-motion path");
assert.doesNotMatch(page, /<PageHeader/,
  "Schedule must keep its own release-clock composition instead of the generic page header");

console.log("schedule UI contracts passed");
