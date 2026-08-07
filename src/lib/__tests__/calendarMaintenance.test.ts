import assert from "node:assert/strict";
import {
  materializeCalendarScheduleDefaults,
  orphanReadyCancellationPatch,
  orphanReadyRowsForMaintenance,
} from "../calendarMaintenance";

assert.deepEqual(
  orphanReadyRowsForMaintenance(
    [
      { id: "kept", channelId: "channel-a" },
      { id: "cancelled", channelId: "deleted-channel" },
    ],
    ["channel-a"],
  ).map((row) => row.id),
  ["cancelled"],
);
assert.deepEqual(orphanReadyCancellationPatch(), {
  status: "cancelled",
  scheduledFailure:
    "Cancelled by operational calendar maintenance: channel no longer exists.",
});

assert.deepEqual(materializeCalendarScheduleDefaults({}), {
  changed: true,
  fields: ["frequency", "timezone", "localTime", "enabled", "days"],
  schedule: {
    frequency: "weekly",
    timezone: "UTC",
    localTime: "09:00",
    enabled: true,
    days: [1],
  },
});

assert.deepEqual(
  materializeCalendarScheduleDefaults({ identity: { cadence: "daily" } }),
  {
    changed: true,
    fields: ["frequency", "timezone", "localTime", "enabled"],
    schedule: {
      frequency: "daily",
      timezone: "UTC",
      localTime: "09:00",
      enabled: true,
    },
  },
  "materializing defaults must preserve a supported identity cadence",
);

assert.deepEqual(
  materializeCalendarScheduleDefaults({
    identity: { cadence: "daily" },
    schedule: {
      frequency: "biweekly",
      days: [3],
      timezone: "Europe/London",
      localTime: "14:30",
      enabled: false,
      approvalMode: "private_auto",
      dailyQuota: 2,
    },
  }),
  {
    changed: false,
    fields: [],
    schedule: {
      frequency: "biweekly",
      days: [3],
      timezone: "Europe/London",
      localTime: "14:30",
      enabled: false,
      approvalMode: "private_auto",
      dailyQuota: 2,
    },
  },
  "explicit cadence, weekday, timezone and safety settings remain untouched",
);

assert.deepEqual(
  materializeCalendarScheduleDefaults({ identity: { cadence: "three times a week" } }).schedule,
  {
    frequency: "weekly",
    timezone: "UTC",
    localTime: "09:00",
    enabled: true,
    days: [1],
  },
  "unsupported legacy cadence text already behaved as the weekly Monday fallback",
);

console.log("calendar maintenance tests passed");
