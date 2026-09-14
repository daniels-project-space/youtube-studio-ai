import assert from "node:assert/strict";
import { readSaladCapacitySnapshot } from "@/lib/saladCapacity";

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

console.log("Salad capacity snapshot contracts passed");
}

void main();
