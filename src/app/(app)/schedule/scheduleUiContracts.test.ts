import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const board = readFileSync(`${here}/DayByDaySchedule.tsx`, "utf8");
const styles = readFileSync(`${here}/schedule.module.css`, "utf8");
const bulkPlanner = readFileSync(`${here}/WeekBulkPlanner.tsx`, "utf8");

assert.match(page, /Array\.from\(\{ length: 14 \}/,
  "the release signal must be derived from fourteen real calendar days");
assert.match(page, /calendar\.flat\.filter/,
  "release rhythm must be derived from the persisted calendar model");
assert.match(page, /summary\.pinned/,
  "the schedule header must distinguish pinned exceptions from cadence projections");
assert.match(page, /api\.contentPlan\.setScheduledAt/,
  "the redesigned exact-date control must remain connected to the scheduling mutation");
assert.match(page, /useOperationsAccess/,
  "schedule edits must read the shared owner capability before mutating");
assert.match(page, /if \(operationsAccess !== "owner"\)/,
  "schedule mutations must open contextual owner verification instead of failing silently");
assert.match(page, /canEdit=\{operationsAccess === "owner"\}/,
  "schedule controls must expose their current edit capability");
assert.match(page, /Open \$\{nextEvent\.title\} production details/,
  "the next scheduled release must open its exact production record");
assert.match(page, /channelHref\(nextEvent\.slug, "week-ahead", nextEvent\.id\)/,
  "the next-release summary must preserve the planned item identity");
assert.match(page, /Seven-day board/);
assert.match(page, /Month map/);
assert.match(page, /Cadence controls/);
assert.match(board, /aspectRatio="16 \/ 9"/,
  "the operational week board must show packaging artwork at a legible video ratio");
assert.match(board, /prioritizedPreviews < 3/,
  "the first scheduled artwork cards must load promptly without eager-loading the whole calendar");
assert.match(board, /event\.type === "planned" \? event\.id : undefined/,
  "planned calendar cards must carry the exact plan item into the channel workspace");
assert.match(board, /event\.thumbnailSource === "rendered_video_frame"/,
  "Lo-Fi scheduled cards must show their final-frame state instead of requesting a generic planner image");
assert.match(styles, /prefers-reduced-motion: reduce/,
  "schedule motion must expose a reduced-motion path");
const queue = readFileSync(`${here}/ScheduleQueue.tsx`, "utf8");
assert.match(queue, /Verify owner to save date changes/,
  "exact-date controls must explain the owner boundary in place");
const cadence = readFileSync(`${here}/ChannelScheduleEditor.tsx`, "utf8");
assert.match(cadence, /onRequestOwner/);
assert.match(cadence, /Verify owner to save/);
assert.doesNotMatch(page, /<PageHeader/,
  "Schedule must keep its own release-clock composition instead of the generic page header");
assert.match(page, /<WeekBulkPlanner/,
  "the weekly batch planner must be available from the existing schedule surface");
assert.match(bulkPlanner, /fetch\("\/api\/plan-week\/bulk"/,
  "the batch planner must use the real bulk planning route");
assert.match(bulkPlanner, /api\/plan-week\/bulk\?fingerprint=/,
  "the batch planner must poll the persisted receipt rather than inventing progress");
assert.match(bulkPlanner, /credentials: "same-origin"/,
  "bulk planning must preserve the authenticated owner session");
assert.match(bulkPlanner, /onRequestOwner/,
  "paid weekly planning must preserve the shared owner boundary");

console.log("schedule UI contracts passed");
