import assert from "node:assert/strict";
import { readSaladCapacitySnapshot, saladFleetCapacityBlockers } from "@/lib/saladCapacity";

assert.deepEqual(
  saladFleetCapacityBlockers({ occupiedGpuSlots: 2, requiredWorkers: 2, quotaUsed: 10, quotaLimit: 10 }),
  ["global_three_gpu_capacity_insufficient_for_wave", "salad_organization_replica_quota_full"],
  "fleet blockers must describe both the shared GPU fence and quota when a wave cannot fit",
);
assert.deepEqual(
  saladFleetCapacityBlockers({ occupiedGpuSlots: 0, requiredWorkers: 3, quotaUsed: 0, quotaLimit: 3 }),
  [],
  "a complete wave that fits both fleet and quota must not be held",
);
assert.throws(
  () => saladFleetCapacityBlockers({ occupiedGpuSlots: 0, requiredWorkers: 0, quotaUsed: 0, quotaLimit: 3 }),
  /invalid wave or quota counts/,
);

// Keep the fixture corpus deterministic even when a developer shell or CI
// job intentionally disables a production tier. The explicit inheritance
// case below temporarily overrides these defaults and restores them.
const ambientMediumPolicy = process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY;
const ambientHighPolicy = process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK;
process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "1";
process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";

const classes = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "RTX 3090 (24 GB)",
    prices: [{ price: "0.20", priority: "medium" as const }, { price: "0.30", priority: "high" as const }],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "RTX 5090 (32 GB)",
    prices: [{ price: "0.40", priority: "medium" as const }, { price: "0.60", priority: "high" as const }],
  },
];

async function main() {
const snapshot = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async (resources) => resources.gpu_classes[0] === classes[0]!.id
    ? { available_gpu_medium: 4, available_gpu_high: 6 }
    : { available_gpu_medium: 0, available_gpu_high: 3 },
});

assert.equal(snapshot.occupiedGpuSlots, 0);
assert.deepEqual(snapshot.quota, { limit: 10, used: 2 });
assert.equal(snapshot.lanes.find((lane) => lane.id === "ernie-image")?.recommendedPriority, "medium");
assert.equal(snapshot.lanes.find((lane) => lane.id === "music3")?.recommendedPriority, "medium");
const h3 = snapshot.lanes.find((lane) => lane.id === "h3")!;
assert.equal(h3.recommendedPriority, "high");
assert.equal(h3.fallbackUsed, true);
assert.equal(h3.mediumAvailable, 0);
assert.equal(h3.highAvailable, 3);
assert.equal(h3.mediumPriceUsdPerHour, 0.4);
assert.equal(h3.highPriceUsdPerHour, 0.6);
assert.equal(h3.selectedPriceUsdPerHour, 0.6);

const h3MarketQueries: Array<string[] | undefined> = [];
const globalH3Snapshot = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 0 } }),
  getGpuAvailability: async (resources, countryCodes) => {
    if (resources.gpu_classes[0] === classes[1]!.id) {
      h3MarketQueries.push(countryCodes);
      return countryCodes ? { available_gpu_medium: 0, available_gpu_high: 0 } : { available_gpu_medium: 0, available_gpu_high: 2 };
    }
    return { available_gpu_medium: 4, available_gpu_high: 4 };
  },
}, { requiredWorkers: 2 });
const globalH3 = globalH3Snapshot.lanes.find((lane) => lane.id === "h3")!;
assert.equal(globalH3.recommendedPriority, "high",
  "the fleet projection must expose high fallback when only the global H3 market can admit the wave");
assert.equal(globalH3.highAvailable, 2);
assert.equal(globalH3.fallbackUsed, true);
assert.deepEqual(h3MarketQueries, [["cn"], undefined],
  "the fleet projection must make at most one global read after a country-scoped H3 miss");

const mediumDisabled = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async (resources) => resources.gpu_classes[0] === classes[1]!.id
    ? { available_gpu_medium: 3, available_gpu_high: 3 }
    : { available_gpu_medium: 3, available_gpu_high: 3 },
}, { mediumPriorityEnabled: false, allowHighPriorityFallback: true });
assert.ok(mediumDisabled.lanes.every((lane) => lane.recommendedPriority === "high"),
  "the fleet snapshot must escalate when medium is disabled, even if medium slots are visible");
assert.ok(mediumDisabled.lanes.every((lane) => lane.fallbackUsed),
  "a disabled medium tier must be marked as an explicit high fallback");

const highOnlyPrice = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes.map((gpu) => gpu.name === "RTX 5090 (32 GB)"
    ? { ...gpu, prices: [{ price: "0.60", priority: "high" as const }] }
    : gpu),
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async (resources) => resources.gpu_classes[0] === classes[1]!.id
    ? { available_gpu_medium: 0, available_gpu_high: 3 }
    : { available_gpu_medium: 3, available_gpu_high: 3 },
}, { requiredWorkers: 2, allowHighPriorityFallback: true });
const highOnlyH3 = highOnlyPrice.lanes.find((lane) => lane.id === "h3")!;
assert.equal(highOnlyH3.recommendedPriority, "high",
  "a priced high tier must unlock the H3 wave when Salad has no medium price");
assert.equal(highOnlyH3.fallbackUsed, true);
assert.equal(highOnlyH3.mediumPriceUsdPerHour, null);
assert.equal(highOnlyH3.highPriceUsdPerHour, 0.6);
assert.equal(highOnlyH3.selectedPriceUsdPerHour, 0.6);

const fallbackDisabled = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async (resources) => resources.gpu_classes[0] === classes[1]!.id
    ? { available_gpu_medium: 0, available_gpu_high: 3 }
    : { available_gpu_medium: 4, available_gpu_high: 6 },
}, { allowHighPriorityFallback: false });
const disabledH3 = fallbackDisabled.lanes.find((lane) => lane.id === "h3")!;
assert.equal(disabledH3.recommendedPriority, null);
assert.equal(disabledH3.fallbackUsed, false);
assert.ok(disabledH3.blockers.includes("high_priority_fallback_disabled"));

const threeWorkerWave = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async (resources) => resources.gpu_classes[0] === classes[0]!.id
    ? { available_gpu_medium: 2, available_gpu_high: 0 }
    : { available_gpu_medium: 0, available_gpu_high: 3 },
}, { requiredWorkers: 3 });
const waveH3 = threeWorkerWave.lanes.find((lane) => lane.id === "h3")!;
assert.equal(waveH3.requiredWorkers, 3);
assert.equal(waveH3.recommendedPriority, "high", "high fallback must be evaluated against the full requested wave");
assert.equal(threeWorkerWave.lanes.find((lane) => lane.id === "ernie-image")?.recommendedPriority, null,
  "a medium 3090 count below the requested wave must not be reported as admitted");
await assert.rejects(() => readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 0 } }),
  getGpuAvailability: async () => ({ available_gpu_medium: 1 }),
}, { requiredWorkers: 4 }), /requires 1..3 workers/);

const quotaHeld = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 2, container_replicas_used: 2 } }),
  getGpuAvailability: async () => ({ available_gpu_medium: 4, available_gpu_high: 4 }),
});
assert.ok(quotaHeld.lanes.every((lane) => lane.recommendedPriority === null));
assert.ok(quotaHeld.lanes.every((lane) => lane.blockers.includes("salad_organization_replica_quota_full")));

const waveHeldByExistingFleet = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [{
    id: "33333333-3333-4333-8333-333333333333",
    name: "existing-h3-wave",
    replicas: 2,
    priority: "medium" as const,
    pending_change: false,
    container: { image: "registry.example/h3@sha256:" + "a".repeat(64), resources: { cpu: 8, memory: 131072, gpu_classes: [classes[1]!.id] } },
    current_state: { status: "running", instance_status_counts: { allocating_count: 0, creating_count: 0, running_count: 2, stopping_count: 0 } },
  }],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 2 } }),
  getGpuAvailability: async () => ({ available_gpu_medium: 4, available_gpu_high: 4 }),
}, { requiredWorkers: 2 });
assert.equal(waveHeldByExistingFleet.occupiedGpuSlots, 2);
assert.ok(waveHeldByExistingFleet.lanes.every((lane) => lane.recommendedPriority === null));
assert.ok(waveHeldByExistingFleet.lanes.every((lane) => lane.blockers.includes("global_three_gpu_capacity_insufficient_for_wave")));

const logicalLeaseHeld = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 3, container_replicas_used: 0 } }),
  getGpuAvailability: async () => ({ available_gpu_medium: 3, available_gpu_high: 3 }),
}, {
  requiredWorkers: 2,
  readLogicalOccupiedGpuSlots: async () => 2,
});
assert.equal(logicalLeaseHeld.occupiedGpuSlots, 2,
  "fleet snapshots must include durable logical lease occupancy");
assert.ok(logicalLeaseHeld.lanes.every((lane) => lane.recommendedPriority === null));
assert.ok(logicalLeaseHeld.lanes.every((lane) => lane.blockers.includes("global_three_gpu_capacity_insufficient_for_wave")));
await assert.rejects(
  () => readSaladCapacitySnapshot({
    listGpuClasses: async () => classes,
    listContainerGroups: async () => [],
    listContainerInstances: async () => [],
    getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 3, container_replicas_used: 0 } }),
    getGpuAvailability: async () => ({ available_gpu_medium: 3, available_gpu_high: 3 }),
  }, { readLogicalOccupiedGpuSlots: async () => 99 }),
  /invalid logical fleet lease occupancy/,
  "malformed logical lease data must fail closed instead of looking like an empty fleet",
);

const waveHeldByQuota = await readSaladCapacitySnapshot({
  listGpuClasses: async () => classes,
  listContainerGroups: async () => [],
  listContainerInstances: async () => [],
  getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 3, container_replicas_used: 2 } }),
  getGpuAvailability: async () => ({ available_gpu_medium: 4, available_gpu_high: 4 }),
}, { requiredWorkers: 2 });
assert.ok(waveHeldByQuota.lanes.every((lane) => lane.recommendedPriority === null));
assert.ok(waveHeldByQuota.lanes.every((lane) => lane.blockers.includes("salad_organization_replica_quota_insufficient_for_wave")));

// Omitted helper options must use the same deployment policy as the paid
// dispatcher; otherwise a direct fleet caller could advertise medium after
// an operator disabled it for maintenance.
const savedMediumPolicy = process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY;
const savedHighPolicy = process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK;
try {
  process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = "0";
  process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = "1";
  const envDriven = await readSaladCapacitySnapshot({
    listGpuClasses: async () => classes,
    listContainerGroups: async () => [],
    listContainerInstances: async () => [],
    getQuotas: async () => ({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 0 } }),
    getGpuAvailability: async () => ({ available_gpu_medium: 3, available_gpu_high: 3 }),
  });
  assert.ok(envDriven.lanes.every((lane) => lane.recommendedPriority === "high"),
    "direct fleet snapshots must inherit the disabled-medium/high-fallback policy");
  assert.ok(envDriven.lanes.every((lane) => lane.fallbackUsed),
    "policy-driven high recommendations must be marked as fallback");
} finally {
  if (savedMediumPolicy === undefined) delete process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY;
  else process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = savedMediumPolicy;
  if (savedHighPolicy === undefined) delete process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK;
  else process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = savedHighPolicy;
}

console.log("Salad capacity snapshot contracts passed");
}

void main().finally(() => {
  if (ambientMediumPolicy === undefined) delete process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY;
  else process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY = ambientMediumPolicy;
  if (ambientHighPolicy === undefined) delete process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK;
  else process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK = ambientHighPolicy;
});
