import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SALAD_FLEET_MAX_GPU_SLOTS,
  SALAD_FLEET_RESERVATION_LEASE_MS,
  saladFleetReservationExpiry,
  saladFleetReservationIdentity,
} from "@/lib/saladFleetReservation";

const input = {
  ownerId: "owner-a",
  orderKey: "week-2026-09-14",
  requestKeys: ["a", "b"],
  requestedGpuCount: 3,
  priority: "medium" as const,
};
const first = saladFleetReservationIdentity(input);
const replay = saladFleetReservationIdentity({ ...input, requestKeys: [...input.requestKeys] });
assert.deepEqual(replay, first, "retries must reuse one deterministic fleet key");
assert.match(first.reservationKey, /^h3-weekly:[a-f0-9]{64}$/);
assert.equal(saladFleetReservationExpiry(1_000), 1_000 + SALAD_FLEET_RESERVATION_LEASE_MS);
assert.throws(() => saladFleetReservationIdentity({ ...input, requestedGpuCount: SALAD_FLEET_MAX_GPU_SLOTS + 1 }), /GPU count/);
assert.throws(() => saladFleetReservationIdentity({ ...input, ownerId: "../other" }), /owner id/);
assert.throws(() => saladFleetReservationExpiry(0), /timestamp/);

const weeklySource = readFileSync(resolve(process.cwd(), "src/trigger/minimaxH3WeeklyBatch.ts"), "utf8");
const convexSource = readFileSync(resolve(process.cwd(), "convex/saladFleetReservations.ts"), "utf8");
assert.match(weeklySource, /api\.saladFleetReservations\.acquire/);
assert.match(weeklySource, /api\.saladFleetReservations\.upgradePriority/);
assert.match(weeklySource, /api\.saladFleetReservations\.release/);
assert.match(weeklySource, /SALAD_FLEET_RESERVATION_ENABLED !== "0"/,
  "the organization-wide fleet fence must be enabled by default and only explicitly disabled");
assert.match(weeklySource, /providerStarted = true/);
assert.match(weeklySource, /pre-provider-failure/);
assert.match(convexSource, /export const upgradePriority = mutation/);
assert.match(convexSource, /priority: v\.literal\("high"\)/);
assert.match(convexSource, /row\.leaseToken !== args\.leaseToken/);
assert.match(convexSource, /row\.priority !== "medium"/);
assert.match(convexSource, /existing\.releaseReason !== "pre-provider-failure"/,
  "only a no-spend pre-provider release may be reacquired by a frozen retry");
assert.match(convexSource, /state: "held"[\s\S]*leaseToken: args\.leaseToken/,
  "a no-spend retry must renew the same logical fence with a fresh lease token");

console.log("Salad fleet reservation contract tests passed");
