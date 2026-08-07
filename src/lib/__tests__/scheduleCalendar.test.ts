import assert from "node:assert/strict";
import {
  civilDayKey,
  formatZonedScheduleTimestamp,
  isScheduledCivilDate,
  isoDayForTimestamp,
  planReadiness,
  nextProjectedPlanItem,
  projectPlanSchedule,
  projectScheduleDates,
  scheduledTimestampForDay,
} from "../scheduleCalendar";

const thursday = new Date(2026, 7, 6);
assert.deepEqual(
  projectScheduleDates("weekly", [1, 4], 4, thursday).map(civilDayKey),
  ["2026-08-10", "2026-08-13", "2026-08-17", "2026-08-20"],
);
assert.deepEqual(
  projectScheduleDates("biweekly", [1], 3, thursday).map(civilDayKey),
  ["2026-08-10", "2026-08-24", "2026-09-07"],
);
assert.deepEqual(
  projectScheduleDates("biweekly", [1], 2, new Date(2026, 7, 11)).map(civilDayKey),
  ["2026-08-24", "2026-09-07"],
  "biweekly parity must not shift with the calendar viewport",
);
assert.deepEqual(
  projectScheduleDates("monthly", undefined, 2, thursday).map(civilDayKey),
  ["2026-09-07", "2026-10-05"],
);
assert.deepEqual(
  projectScheduleDates("monthly", [1, 3], 2, thursday).map(civilDayKey),
  ["2026-09-02", "2026-10-05"],
  "monthly schedules use the first configured weekday in each month",
);
assert.equal(isScheduledCivilDate("weekly", undefined, new Date(2026, 7, 10)), true);
assert.equal(isScheduledCivilDate("weekly", undefined, new Date(2026, 7, 11)), false);
assert.match(
  formatZonedScheduleTimestamp(
    Date.parse("2026-08-10T13:30:00.000Z"),
    "America/New_York",
    { weekday: true },
  ),
  /Mon.*10 Aug.*09:30.*(?:EDT|GMT-4)/,
);

const nyMorning = scheduledTimestampForDay("2026-03-08", "09:30", "America/New_York");
assert.ok(nyMorning);
assert.equal(isoDayForTimestamp(nyMorning!, "America/New_York"), "2026-03-08");
assert.equal(
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(nyMorning!),
  "09:30",
);
assert.equal(
  scheduledTimestampForDay("2026-03-08", "02:30", "America/New_York"),
  null,
  "nonexistent DST wall times must fail closed",
);

assert.equal(planReadiness("ready", "thumbs/a.jpg"), "ready");
assert.equal(planReadiness("ready", undefined), "attention");
assert.equal(planReadiness("generating", undefined), "building");
assert.equal(planReadiness("failed", undefined), "attention");

const queue = [
  { id: "later", order: 2 },
  { id: "first", order: 1 },
];
const queueProjection = projectPlanSchedule({
  items: queue,
  schedule: {
    frequency: "weekly",
    days: [1],
    timezone: "America/New_York",
    localTime: "09:30",
  },
  fromTimestamp: Date.parse("2026-08-06T12:00:00.000Z"),
});
assert.deepEqual(queueProjection.map((projection) => projection.item.id), ["first", "later"]);
assert.deepEqual(queueProjection.map((projection) => civilDayKey(projection.date)), ["2026-08-10", "2026-08-17"]);
assert.equal(queueProjection[0]?.usesScheduleDefaults, false);
assert.equal(
  nextProjectedPlanItem({
    items: queue,
    schedule: {
      frequency: "weekly",
      days: [1],
      timezone: "America/New_York",
      localTime: "09:30",
    },
    fromTimestamp: Date.parse("2026-08-06T12:00:00.000Z"),
  })?.item.id,
  "first",
  "cards and the calendar share one queue-order cadence projection",
);
assert.equal(
  projectPlanSchedule({
    items: [{ id: "defaulted", order: 0 }],
    schedule: { frequency: "weekly" },
    fromTimestamp: Date.parse("2026-08-06T12:00:00.000Z"),
  })[0]?.usesScheduleDefaults,
  true,
);

console.log("schedule calendar tests passed");
