import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareInceptionScheduleUpdate } from "../inceptionScheduleUpdate";
import { channelScheduleWriteFence } from "../channelScheduleWriteFence";

const existing = { frequency: "weekly", days: [1], enabled: false, timezone: "Europe/London", localTime: "10:30", approvalMode: "manual" as const, dailyQuota: 2 };
const prepared = prepareInceptionScheduleUpdate(existing, { frequency: "daily" });
assert.deepEqual(prepared.schedule, { ...existing, frequency: "daily" });
assert.equal(prepared.expectedScheduleFence, channelScheduleWriteFence(existing));
assert.deepEqual(prepareInceptionScheduleUpdate(undefined, { frequency: "weekly", days: [2] }).schedule, { frequency: "weekly", days: [2] });
assert.notEqual(prepared.expectedScheduleFence, channelScheduleWriteFence({ ...existing, enabled: true }));
const workflow = readFileSync("src/trigger/designChannelInception.ts", "utf8");
assert.equal((workflow.match(/await updateInceptionSchedule\(convex, channelId,/g) ?? []).length, 2);
console.log("Inception schedule changes preserve settings and bind both writes to the original schedule");
