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
assert.match(weeklySource, /api\.saladFleetReservations\.acquire/);
assert.match(weeklySource, /api\.saladFleetReservations\.upgradePriority/);
assert.match(weeklySource, /api\.saladFleetReservations\.release/);
assert.match(weeklySource, /providerStarted = true/);
assert.match(weeklySource, /pre-provider-failure/);

console.log("Salad fleet reservation contract tests passed");
