import { z } from "zod";
import { bootstrapSecrets } from "@/lib/bootstrap";

/** Public API fields verified against Salad's current schema and live discovery. */
export const SALAD_API_BASE = "https://api.salad.com/api/public";
export const SALAD_BULK_PRIORITY = "medium" as const;
export const SALAD_BULK_MAX_GPUS = 3;
export type SaladGpuModel = "RTX 3090" | "RTX 5090";

const resourceName = z.string().regex(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/);
const gpuId = z.string().uuid();
const count = z.number().int().nonnegative();
const priority = z.enum(["high", "medium", "low", "batch"]);
const imageDigest = z.string().max(1024).regex(
  /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/,
);

const gpuClassSchema = z.object({
  id: gpuId,
  name: z.string().min(1),
  prices: z.array(z.object({ price: z.string(), priority })),
  is_high_demand: z.boolean().optional(),
});
export type SaladGpuClass = z.infer<typeof gpuClassSchema>;
export interface SaladGpuSelection {
  id: string;
  model: SaladGpuModel;
  name: string;
  priceUsdPerHour: number;
  priority: typeof SALAD_BULK_PRIORITY;
}

const resourceSchema = z.object({
  cpu: z.number().int().min(1).max(1024),
  memory: z.number().int().min(1024).max(1_073_741_824),
  gpu_classes: z.array(gpuId).min(1).max(1),
  storage_amount: z.number().int().min(1_073_741_824).max(1_125_899_906_842_624),
  shm_size: z.number().int().min(64).optional(),
});
export type SaladResources = z.infer<typeof resourceSchema>;

const queueConnectionSchema = z.object({
  queue_name: resourceName,
  path: z.string().regex(/^\/[a-zA-Z0-9_/-]*$/),
  port: z.number().int().min(1).max(65535),
});

/** Deliberately strips environment variables, commands, logs, registry auth and signed URLs. */
const groupSchema = z.object({
  id: gpuId,
  name: resourceName,
  replicas: count.max(500),
  priority: priority.nullable(),
  pending_change: z.boolean(),
  container: z.object({
    image: z.string(),
    resources: z.object({ cpu: count, memory: count, gpu_classes: z.array(gpuId).nullish() }),
  }),
  current_state: z.object({
    status: z.string(),
    instance_status_counts: z.object({
      allocating_count: count,
      creating_count: count,
      running_count: count,
      stopping_count: count,
    }),
  }),
  queue_connection: queueConnectionSchema.nullish(),
  queue_autoscaler: z.object({ min_replicas: count, max_replicas: count }).nullish(),
  networking: z.object({ dns: z.string().regex(/^[a-z0-9.-]+$/), port: count, auth: z.boolean() }).nullish(),
});
export type SaladContainerGroup = z.infer<typeof groupSchema>;

const instanceSchema = z.object({
  id: gpuId,
  state: z.enum(["allocating", "downloading", "creating", "running", "stopping"]),
  version: count,
  ready: z.boolean().optional(),
  started: z.boolean().optional(),
});
export type SaladContainerInstance = z.infer<typeof instanceSchema>;

const healthProbeSchema = z.object({
  http: z.object({ path: z.string().regex(/^\/[a-zA-Z0-9_/-]*$/), port: z.number().int().min(1).max(65535) }),
  initial_delay_seconds: count,
  period_seconds: z.number().int().positive(),
  timeout_seconds: z.number().int().positive(),
  success_threshold: z.number().int().positive(),
  failure_threshold: z.number().int().positive(),
});

const createSchema = z.object({
  name: resourceName,
  autostart_policy: z.literal(false),
  replicas: count.max(SALAD_BULK_MAX_GPUS),
  restart_policy: z.literal("never"),
  container: z.object({
    image: imageDigest,
    priority: z.literal(SALAD_BULK_PRIORITY),
    image_caching: z.literal(true),
    resources: resourceSchema,
    command: z.array(z.string()).optional(),
    environment_variables: z.record(z.string()).optional(),
    registry_authentication: z.object({
      basic: z.object({ username: z.string().min(1), password: z.string().min(1) }),
    }).optional(),
  }).strict(),
  queue_connection: queueConnectionSchema.optional(),
  networking: z.object({ protocol: z.literal("http"), port: z.number().int().min(1).max(65535), auth: z.literal(true) }).optional(),
  country_codes: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(500).optional(),
  startup_probe: healthProbeSchema,
  readiness_probe: healthProbeSchema,
}).strict();
export type SaladCreateContainerGroup = z.infer<typeof createSchema>;

export function selectSaladGpu(classes: readonly SaladGpuClass[], model: SaladGpuModel): SaladGpuSelection {
  const exactName = model === "RTX 3090" ? "RTX 3090 (24 GB)" : "RTX 5090 (32 GB)";
  const matches = classes.filter((gpu) => gpu.name === exactName);
  if (matches.length !== 1) throw new Error(`Salad discovery must return one exact ${model} desktop GPU class`);
  const gpu = matches[0];
  gpuId.parse(gpu.id);
  const prices = gpu.prices.filter((row) => row.priority === SALAD_BULK_PRIORITY);
  const priceUsdPerHour = Number(prices[0]?.price);
  if (prices.length !== 1 || !Number.isFinite(priceUsdPerHour) || priceUsdPerHour <= 0) {
    throw new Error("Salad medium priority price is absent or invalid");
  }
  return { id: gpu.id, name: gpu.name, model, priceUsdPerHour, priority: SALAD_BULK_PRIORITY };
}

/** Capacity remains reserved during allocation and stopping, until the provider confirms zero. */
export function saladOccupiedGpuSlots(
  groups: readonly SaladContainerGroup[],
  instancesByGroup?: ReadonlyMap<string, readonly SaladContainerInstance[]>,
): number {
  return groups.reduce((sum, group) => {
    if (!group.container.resources.gpu_classes?.length) return sum;
    const counts = group.current_state.instance_status_counts;
    const instances = instancesByGroup?.get(group.name);
    const observed = Math.max(instances?.length ?? 0,
      counts.allocating_count + counts.creating_count + counts.running_count + counts.stopping_count);
    if (group.current_state.status === "stopped" && observed === 0 && !group.pending_change && instances?.length === 0) return sum;
    // The group summary omits downloading, and can precede node termination.
    // Missing instance evidence must never release the last reserved GPU slot.
    return sum + Math.max(1, observed, group.replicas, group.queue_autoscaler?.max_replicas ?? 0);
  }, 0);
}

export function isSaladGroupStopped(group: SaladContainerGroup, instances: readonly SaladContainerInstance[]): boolean {
  return group.current_state.status === "stopped" && !group.pending_change
    && Object.values(group.current_state.instance_status_counts).every((value) => value === 0)
    && instances.length === 0;
}

export function buildSaladContainerGroup(input: {
  name: string;
  image: string;
  gpu: SaladGpuSelection;
  replicas: number;
  cpu: number;
  memoryMb: number;
  storageBytes: number;
  port?: number;
  command?: string[];
  environmentVariables?: Record<string, string>;
  registryAuthentication?: { username: string; password: string };
  queueName?: string;
  queuePath?: string;
  countryCodes?: string[];
}): SaladCreateContainerGroup {
  const port = input.port ?? 8080;
  if (input.gpu.priority !== SALAD_BULK_PRIORITY) throw new Error("Salad bulk work requires medium priority");
  if (input.queueName && !input.queuePath) throw new Error("Salad queue workers require their implemented HTTP path");
  // Prevent accidental distribution of provider/account credentials to interruptible workers.
  for (const key of Object.keys(input.environmentVariables ?? {})) {
    if (/^(?:SALAD_API_KEY|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|VAULT_.*)$/.test(key)) {
      throw new Error("Salad workers must use scoped job credentials and object URLs");
    }
  }
  return createSchema.parse({
    name: input.name,
    autostart_policy: false,
    replicas: input.replicas,
    restart_policy: "never",
    container: {
      image: input.image,
      priority: SALAD_BULK_PRIORITY,
      image_caching: true,
      resources: {
        cpu: input.cpu, memory: input.memoryMb, storage_amount: input.storageBytes,
        gpu_classes: [input.gpu.id],
      },
      ...(input.command ? { command: input.command } : {}),
      ...(input.environmentVariables ? { environment_variables: input.environmentVariables } : {}),
      ...(input.registryAuthentication ? { registry_authentication: { basic: input.registryAuthentication } } : {}),
    },
    ...(input.queueName
      ? { queue_connection: { queue_name: input.queueName, path: input.queuePath!, port } }
      : { networking: { protocol: "http", auth: true, port } }),
    ...(input.countryCodes ? { country_codes: input.countryCodes } : {}),
    startup_probe: {
      http: { path: "/healthz", port }, initial_delay_seconds: 0, period_seconds: 10,
      timeout_seconds: 5, success_threshold: 1, failure_threshold: 180,
    },
    readiness_probe: {
      http: { path: "/healthz", port }, initial_delay_seconds: 0, period_seconds: 10,
      timeout_seconds: 5, success_threshold: 1, failure_threshold: 3,
    },
  });
}

export class SaladCloudError extends Error {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    readonly status: number | undefined,
    readonly outcomeUnknown: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Salad ${operation} ${status ? `returned HTTP ${status}` : "could not be verified"}${outcomeUnknown ? "; reconcile provider state before another mutation" : ""}`);
    this.name = "SaladCloudError";
  }
}

/** No automatic retries. A controller must reconcile uncertain writes using the same group name. */
export class SaladCloudClient {
  readonly organization: string;
  readonly project: string;
  #apiKey: string;
  #fetch: typeof fetch;
  #timeoutMs: number;

  constructor(options: { apiKey: string; organization: string; project: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.organization = resourceName.parse(options.organization);
    this.project = resourceName.parse(options.project);
    if (!options.apiKey.trim()) throw new Error("Salad API key is missing");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60_000) throw new Error("Invalid Salad request timeout");
  }

  private orgPath() { return `/organizations/${this.organization}`; }
  private projectPath() { return `${this.orgPath()}/projects/${this.project}`; }
  private groupPath(name: string) { return `${this.projectPath()}/containers/${resourceName.parse(name)}`; }

  private async request<T>(operation: string, method: string, path: string, schema: z.ZodType<T>, body?: unknown, readOnly = false): Promise<T> {
    const mutation = method !== "GET" && !readOnly;
    let response: Response;
    try {
      response = await this.#fetch(`${SALAD_API_BASE}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {
          "Salad-Api-Key": this.#apiKey, Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": method === "PATCH" ? "application/merge-patch+json" : "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Never retain a transport cause: it may contain request headers or a signed URL.
      throw new SaladCloudError(operation, undefined, mutation);
    }
    if (!response.ok) {
      const rawRetryAfter = response.headers.get("Retry-After");
      const retrySeconds = rawRetryAfter && /^\d+$/.test(rawRetryAfter) ? Number(rawRetryAfter) : undefined;
      await response.body?.cancel().catch(() => {});
      throw new SaladCloudError(operation, response.status, mutation && (response.status >= 500 || response.status === 408), retrySeconds);
    }
    try {
      const value = response.status === 202 || response.status === 204 ? undefined : await response.json();
      return schema.parse(value);
    } catch {
      throw new SaladCloudError(operation, response.status, mutation);
    }
  }

  async listGpuClasses(): Promise<SaladGpuClass[]> {
    return (await this.request("list GPU classes", "GET", `${this.orgPath()}/gpu-classes`, z.object({ items: z.array(gpuClassSchema) }))).items;
  }
  async listContainerGroups(): Promise<SaladContainerGroup[]> {
    return (await this.request("list groups", "GET", `${this.projectPath()}/containers`, z.object({ items: z.array(groupSchema) }))).items;
  }
  getContainerGroup(name: string): Promise<SaladContainerGroup> {
    return this.request("get group", "GET", this.groupPath(name), groupSchema);
  }
  async listContainerInstances(name: string): Promise<SaladContainerInstance[]> {
    return (await this.request("list instances", "GET", `${this.groupPath(name)}/instances`, z.object({ instances: z.array(instanceSchema) }))).instances;
  }
  getQuotas() {
    return this.request("get quotas", "GET", `${this.orgPath()}/quotas`, z.object({
      container_groups_quotas: z.object({ container_replicas_quota: count, container_replicas_used: count }),
    }));
  }
  getGpuAvailability(resources: SaladResources, countryCodes?: string[]) {
    return this.request("get GPU availability", "POST", `${this.orgPath()}/availability/sce-gpu-availability`, z.object({
      available_gpu_high: count.optional(), available_gpu_medium: count.optional(),
      available_gpu_low: count.optional(), available_gpu_batch: count.optional(), on_call_gpu: count.optional(),
    }), {
      ...resourceSchema.omit({ shm_size: true }).parse(resources),
      ...(countryCodes ? { country_codes: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).parse(countryCodes) } : {}),
    }, true);
  }
  createContainerGroup(request: SaladCreateContainerGroup): Promise<SaladContainerGroup> {
    return this.request("create group", "POST", `${this.projectPath()}/containers`, groupSchema, createSchema.parse(request));
  }
  startContainerGroup(name: string): Promise<void> {
    return this.request("start group", "POST", `${this.groupPath(name)}/start`, z.undefined());
  }
  stopContainerGroup(name: string): Promise<void> {
    return this.request("stop group", "POST", `${this.groupPath(name)}/stop`, z.undefined());
  }
  /** Caller holds the shared fleet capacity lease; this per-group limit is an additional bound. */
  updateReplicas(name: string, replicas: number): Promise<SaladContainerGroup> {
    return this.request("scale group", "PATCH", this.groupPath(name), groupSchema, { replicas: count.max(SALAD_BULK_MAX_GPUS).parse(replicas) });
  }
}

/** Loads only Salad's vault namespace; no render or cloud mutation is performed. */
export async function saladCloudClientFromVault(): Promise<SaladCloudClient> {
  await bootstrapSecrets(undefined, { services: ["salad"], required: ["SALAD_API_KEY", "SALAD_ORG", "SALAD_PROJECT"] });
  return new SaladCloudClient({
    apiKey: process.env.SALAD_API_KEY!, organization: process.env.SALAD_ORG!, project: process.env.SALAD_PROJECT!,
  });
}
