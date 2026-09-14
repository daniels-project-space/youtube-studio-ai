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
