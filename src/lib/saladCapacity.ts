import {
  SALAD_BULK_MAX_GPUS,
  SALAD_HIGH_FALLBACK_PRIORITY,
  type SaladBulkPriority,
  type SaladCloudClient,
  type SaladGpuModel,
  type SaladResources,
  saladCloudClientFromVault,
  saladOccupiedGpuSlots,
  selectSaladGpuAtPriority,
} from "@/lib/saladCloud";

/**
 * Exact worker requirements used by the three Salad production lanes.  This
 * is intentionally a read-only capacity view; it is not a container-group
 * definition and cannot be used to mutate the fleet.
 */
export const SALAD_CAPACITY_LANES = Object.freeze([
  {
    id: "ernie-image" as const,
    label: "ERNIE image",
    model: "RTX 3090" as SaladGpuModel,
    resources: { cpu: 4, memory: 32_768, storage_amount: 48 * 1024 ** 3 },
  },
  {
    id: "music3" as const,
    label: "MiniMax Music 3",
    model: "RTX 3090" as SaladGpuModel,
    resources: { cpu: 8, memory: 65_536, storage_amount: 80 * 1024 ** 3 },
  },
  {
    id: "h3" as const,
    label: "MiniMax H3",
    model: "RTX 5090" as SaladGpuModel,
    resources: { cpu: 8, memory: 131_072, storage_amount: 100 * 1024 ** 3 },
    countryCodes: ["cn"] as const,
  },
] as const);

export type SaladCapacityLaneId = (typeof SALAD_CAPACITY_LANES)[number]["id"];

export interface SaladCapacityLaneSnapshot {
  id: SaladCapacityLaneId;
  label: string;
  model: SaladGpuModel;
  requiredWorkers: number;
  mediumAvailable: number;
  highAvailable: number;
  recommendedPriority: SaladBulkPriority | null;
  fallbackUsed: boolean;
  gpuClassId?: string;
  blockers: string[];
}

export interface SaladCapacitySnapshot {
  observedAt: number;
  occupiedGpuSlots: number;
  globalGpuLimit: typeof SALAD_BULK_MAX_GPUS;
  quota: { limit: number; used: number };
  lanes: SaladCapacityLaneSnapshot[];
}

export interface SaladCapacitySnapshotOptions {
  /** Number of replicas the next wave needs; capped by the shared fleet limit. */
  requiredWorkers?: number;
}

type CapacityClient = Pick<SaladCloudClient, "listGpuClasses" | "listContainerGroups" | "listContainerInstances" | "getQuotas" | "getGpuAvailability">;

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Read the exact class, live market counts, account lease and quota once for
 * every production lane. Medium is always recommended first; high is only a
 * recommendation when medium has no capacity, matching the H3 dispatcher.
 */
export async function readSaladCapacitySnapshot(
  client?: CapacityClient,
  options: SaladCapacitySnapshotOptions = {},
): Promise<SaladCapacitySnapshot> {
  const requiredWorkers = options.requiredWorkers ?? 1;
  if (!Number.isSafeInteger(requiredWorkers) || requiredWorkers < 1 || requiredWorkers > SALAD_BULK_MAX_GPUS) {
    throw new Error(`Salad capacity snapshot requires 1..${SALAD_BULK_MAX_GPUS} workers`);
  }
  const salad = client ?? await saladCloudClientFromVault();
  const [classes, groups, quotas] = await Promise.all([
    salad.listGpuClasses(),
    salad.listContainerGroups(),
    salad.getQuotas(),
  ]);
  const instances = new Map(await Promise.all(
    groups.map(async (group) => [group.name, await salad.listContainerInstances(group.name)] as const),
  ));
  const occupiedGpuSlots = saladOccupiedGpuSlots(groups, instances);
  const quota = quotas.container_groups_quotas;

  const observedLanes = await Promise.all(SALAD_CAPACITY_LANES.map(async (lane): Promise<SaladCapacityLaneSnapshot> => {
    const blockers: string[] = [];
    let mediumClass: ReturnType<typeof selectSaladGpuAtPriority> | undefined;
    try {
      mediumClass = selectSaladGpuAtPriority(classes, lane.model, "medium");
    } catch {
      blockers.push("exact_medium_gpu_class_or_price_unavailable");
    }
    let highClass: ReturnType<typeof selectSaladGpuAtPriority> | undefined;
    try {
      highClass = selectSaladGpuAtPriority(classes, lane.model, SALAD_HIGH_FALLBACK_PRIORITY);
    } catch {
      blockers.push("exact_high_gpu_class_or_price_unavailable");
    }
    const selectedClass = mediumClass ?? highClass;
    if (!selectedClass) {
      return {
        id: lane.id,
        label: lane.label,
        model: lane.model,
        requiredWorkers: 1,
        mediumAvailable: 0,
        highAvailable: 0,
        recommendedPriority: null,
        fallbackUsed: false,
        blockers,
      };
    }
    let availability: { available_gpu_medium?: number; available_gpu_high?: number };
    try {
      const resources: SaladResources = { ...lane.resources, gpu_classes: [selectedClass.id] };
      availability = await salad.getGpuAvailability(resources, "countryCodes" in lane ? [...lane.countryCodes] : undefined);
    } catch {
      blockers.push("availability_read_failed");
      availability = {};
    }
    const mediumAvailable = safeCount(availability.available_gpu_medium);
    const highAvailable = safeCount(availability.available_gpu_high);
    const recommendedPriority: SaladBulkPriority | null = mediumAvailable >= requiredWorkers
      ? "medium"
      : highAvailable >= requiredWorkers && highClass
        ? SALAD_HIGH_FALLBACK_PRIORITY
        : null;
    if (!recommendedPriority) blockers.push("no_current_capacity");
    return {
      id: lane.id,
      label: lane.label,
      model: lane.model,
      requiredWorkers,
      mediumAvailable,
      highAvailable,
      recommendedPriority,
      fallbackUsed: recommendedPriority === SALAD_HIGH_FALLBACK_PRIORITY,
      gpuClassId: selectedClass.id,
      blockers,
    };
  }));
  const fleetBlockers = [
    ...(occupiedGpuSlots >= SALAD_BULK_MAX_GPUS ? ["global_three_gpu_capacity_full"] : []),
    ...(safeCount(quota.container_replicas_quota) <= safeCount(quota.container_replicas_used)
      ? ["salad_organization_replica_quota_full"]
      : []),
  ];
  const lanes = fleetBlockers.length
    ? observedLanes.map((lane) => ({
      ...lane,
      recommendedPriority: null,
      fallbackUsed: false,
      blockers: [...new Set([...lane.blockers, ...fleetBlockers])],
    }))
    : observedLanes;
  return {
    observedAt: Date.now(),
    occupiedGpuSlots,
    globalGpuLimit: SALAD_BULK_MAX_GPUS,
    quota: {
      limit: safeCount(quota.container_replicas_quota),
      used: safeCount(quota.container_replicas_used),
    },
    lanes,
  };
}
