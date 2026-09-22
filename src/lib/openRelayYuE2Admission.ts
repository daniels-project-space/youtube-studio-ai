import { z } from "zod";
import { OPENRELAY_API_BASE_URL } from "@/lib/openRelay";

export const YUE2_OPENRELAY_SHAPE = {
  name: "yt-yue2-3090-evaluation", gpuModelName: "RTX 3090", vramGb: 24,
  gpuCount: 1, guestMemMb: 28 * 1024, diskSizeGb: 60,
  tier: "community", public: false, allowFallback: false,
} as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resources = z.object({ diskGb: integer, ramMb: integer, vcpu: integer });
const offer = z.object({ free: resources, perGpu: resources, unitSizes: z.array(integer).nullable() });
const availability = z.object({ gpuModelId: z.string().uuid(), name: z.string(), vramGb: integer,
  vm: z.object({ freeGpus: integer, minDiskGb: integer, placeableGpuCounts: z.array(integer).optional(),
    offers: z.array(offer).optional() }) });
const price = z.object({ gpuModelId: z.string().uuid(), gpuModelName: z.string(), vramGb: integer,
  tier: z.string(), pricePerHourCents: integer });

/** A current capacity plan, never proof of placement, available guest RAM or authorization to spend. */
export function planYuE2OpenRelayAdmission(input: {
  availability: unknown; pricing: unknown; maximumHourlyCents: number;
}) {
  const maximumHourlyCents = integer.min(1).parse(input.maximumHourlyCents);
  const raw = z.array(z.unknown()).parse(input.availability);
  const matches = raw.filter(value => value && typeof value === "object" &&
    (value as { name?: unknown }).name === YUE2_OPENRELAY_SHAPE.gpuModelName);
  if (matches.length !== 1) throw new Error("Expected exactly one RTX 3090 availability record");
  const gpu = availability.parse(matches[0]);
  if (gpu.vramGb !== 24 || gpu.vm.freeGpus < 1 || !gpu.vm.placeableGpuCounts?.includes(1) ||
      gpu.vm.minDiskGb > YUE2_OPENRELAY_SHAPE.diskSizeGb) throw new Error("Exact RTX 3090 VM shape is unavailable");
  const compatible = (gpu.vm.offers ?? []).filter(row =>
    row.unitSizes?.includes(1) && row.perGpu.ramMb >= YUE2_OPENRELAY_SHAPE.guestMemMb &&
    row.free.ramMb >= YUE2_OPENRELAY_SHAPE.guestMemMb &&
    row.perGpu.diskGb >= YUE2_OPENRELAY_SHAPE.diskSizeGb && row.free.diskGb >= YUE2_OPENRELAY_SHAPE.diskSizeGb &&
    row.perGpu.vcpu >= 2 && row.free.vcpu >= 2);
  if (!compatible.length) throw new Error("No single RTX 3090 offer has the required free RAM, disk and CPU together");
  const rates = z.object({ gpu: z.array(price) }).parse(input.pricing).gpu.filter(row =>
    row.gpuModelId === gpu.gpuModelId && row.gpuModelName === gpu.name && row.vramGb === 24 &&
    row.tier === YUE2_OPENRELAY_SHAPE.tier);
  if (rates.length !== 1 || rates[0]!.pricePerHourCents < 1 || rates[0]!.pricePerHourCents > maximumHourlyCents) {
    throw new Error("RTX 3090 hourly rate is missing, ambiguous or above the operator ceiling");
  }
  const { gpuModelName, vramGb, ...shape } = YUE2_OPENRELAY_SHAPE;
  return {
    schema: "youtube-studio-yue2-openrelay-admission/v1" as const,
    gpuModelName, vramGb, shape: { ...shape, gpuModelId: gpu.gpuModelId },
    pricePerHourCents: rates[0]!.pricePerHourCents, compatibleOfferCount: compatible.length,
    minimumAvailableGuestRamBytes: 24 * 2 ** 30,
    storagePriceVerified: false as const, authorizedToCreate: false as const,
    placementVerified: false as const, gpuQualified: false as const,
  };
}

/** Only GETs; provider keys and raw provider error bodies never enter results. */
export async function inspectYuE2OpenRelayAdmission(options: {
  apiKey: string; expectedOrganizationId: string; maximumHourlyCents: number; fetchImpl?: typeof fetch;
  /** Inspect this retained Studio VM instead of planning a new allocation. */
  existingVmId?: string;
}) {
  if (options.apiKey.trim().length < 32) throw new Error("OpenRelay key unavailable");
  const organizationId = z.string().uuid().parse(options.expectedOrganizationId);
  integer.min(1).parse(options.maximumHourlyCents);
  const existingVmId = z.string().uuid().optional().parse(options.existingVmId);
  const fetchImpl = options.fetchImpl ?? fetch;
  async function read(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${OPENRELAY_API_BASE_URL}${path}`, {
        method: "GET", headers: { authorization: `Bearer ${options.apiKey.trim()}` },
        cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error",
      });
    } catch { throw new Error("OpenRelay read-only preflight transport unavailable"); }
    if (!response.ok) throw new Error(`OpenRelay read-only preflight returned HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new Error("OpenRelay read-only preflight returned invalid JSON evidence"); }
  }
  const identity = z.object({ organizationId: z.literal(organizationId), scopes: z.array(z.string()) })
    .parse(await read("/v1/whoami"));
  // Scope labels are advisory: cluster-scoped keys can currently read VM APIs.
  // Let the authenticated endpoints enforce access instead of guessing from
  // labels. Successful reads never establish write authority or spend consent.
  if (existingVmId !== undefined) {
    // A retained disk is tied to its VM/node. Global free capacity and the
    // default provisioning name cannot establish whether that VM can resume.
    const vm = z.object({
      id: z.literal(existingVmId), organizationId: z.literal(organizationId),
      name: z.string().min(1), status: z.enum(["stopped", "running"]),
      gpuModelId: z.string().uuid(), gpuCount: z.literal(1),
      gpuInfo: z.object({ name: z.literal("RTX 3090"), vramGb: z.literal(24) }),
      guestMemMb: integer.min(YUE2_OPENRELAY_SHAPE.guestMemMb),
      diskSizeGb: integer.min(YUE2_OPENRELAY_SHAPE.diskSizeGb),
      public: z.literal(false), tier: z.literal(YUE2_OPENRELAY_SHAPE.tier),
    }).parse(await read(`/v1/vms/${existingVmId}/detail`));
    const burn = z.object({ vmId: z.literal(existingVmId), gpuCount: z.literal(1),
      pricePerHourCents: integer.min(1).max(options.maximumHourlyCents), diskBilled: z.literal(false),
    }).parse(await read(`/v1/vms/${existingVmId}/burn`));
    return {
      schema: "youtube-studio-yue2-openrelay-admission/v1" as const,
      admissionMode: "retained_vm" as const,
      gpuModelName: vm.gpuInfo.name, vramGb: vm.gpuInfo.vramGb,
      shape: { name: vm.name, gpuModelId: vm.gpuModelId, gpuCount: vm.gpuCount,
        guestMemMb: vm.guestMemMb, diskSizeGb: vm.diskSizeGb, public: vm.public,
        tier: vm.tier, allowFallback: false as const },
      pricePerHourCents: burn.pricePerHourCents, compatibleOfferCount: null,
      minimumAvailableGuestRamBytes: 24 * 2 ** 30,
      storagePriceVerified: true as const, authorizedToCreate: false as const,
      authorizedToRestart: false as const, restartCapacityVerified: false as const,
      placementVerified: false as const, gpuQualified: false as const,
      organizationId, reportedScopes: identity.scopes, readAccessVerified: true as const,
      observedAt: new Date().toISOString(), existingVm: { id: vm.id, name: vm.name, status: vm.status },
    };
  }
  const liveAvailability = await read("/v1/gpu-availability");
  const pricing = await read("/v1/pricing");
  const plan = planYuE2OpenRelayAdmission({ availability: liveAvailability, pricing,
    maximumHourlyCents: options.maximumHourlyCents });
  const pageSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), name: z.string(), status: z.string() })),
    nextCursor: z.string().max(2048).optional() });
  const vms: z.infer<typeof pageSchema>["items"] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < 5; index++) {
    const query = new URLSearchParams({ limit: "100", activeOnly: "true", ...(cursor ? { cursor } : {}) });
    const page = pageSchema.parse(await read(`/v1/orgs/${organizationId}/vms?${query}`));
    vms.push(...page.items);
    cursor = page.nextCursor || undefined;
    if (!cursor) break;
    if (seenCursors.has(cursor) || index === 4) throw new Error("OpenRelay VM inventory is incomplete; reconcile before admission");
    seenCursors.add(cursor);
  }
  const existing = vms.filter(vm => vm.name === plan.shape.name);
  if (existing.length > 1) throw new Error("Multiple Studio YuE2 VMs require reconciliation");
  return { ...plan, admissionMode: "new_vm" as const, organizationId, reportedScopes: identity.scopes, readAccessVerified: true as const,
    observedAt: new Date().toISOString(), existingVm: existing[0] ?? null };
}
