/**
 * Minimal OpenRelay VM control-plane client.
 *
 * This lives outside every GPU container: workers never receive the account
 * key that can create, stop, or delete paid infrastructure.  Callers must
 * hydrate OPENRELAY_API_KEY from the server-side vault before construction.
 */
export const OPENRELAY_API_BASE_URL = "https://api.openrelay.inc" as const;

export interface OpenRelayVm {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  statusReason?: string;
  endpointUrl: string;
  public: boolean;
  gpuModelId: string;
  gpuModelName: string;
  gpuCount: number;
  diskSizeGb: number;
  pricePerHourCents: number;
  imageUrl: string;
}

export class OpenRelayApiError extends Error {
  constructor(readonly operation: string, readonly status: number, detail = "") {
    super(`OpenRelay ${operation} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "OpenRelayApiError";
  }
}

function requireApiKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (key.length < 32) throw new Error("OPENRELAY_API_KEY is missing or too short");
  return key;
}

function requireVmId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("OpenRelay VM id is invalid");
  return value;
}

function vmFromUnknown(value: unknown): OpenRelayVm {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenRelay returned a non-object VM response");
  }
  const vm = value as Record<string, unknown>;
  const strings = ["id", "organizationId", "name", "status", "endpointUrl", "gpuModelId", "gpuModelName", "imageUrl"] as const;
  for (const key of strings) {
    if (typeof vm[key] !== "string" || !vm[key]) throw new Error(`OpenRelay VM ${key} is missing`);
  }
  if (typeof vm.public !== "boolean") throw new Error("OpenRelay VM public flag is missing");
  for (const key of ["gpuCount", "diskSizeGb", "pricePerHourCents"] as const) {
    if (typeof vm[key] !== "number" || !Number.isFinite(vm[key]) || vm[key] < 0) {
      throw new Error(`OpenRelay VM ${key} is invalid`);
    }
  }
  return vm as unknown as OpenRelayVm;
}

export class OpenRelayVmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(args: { apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = requireApiKey(args.apiKey);
    this.baseUrl = (args.baseUrl ?? OPENRELAY_API_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = args.fetchImpl ?? fetch;
  }

  private async requestVm(operation: string, path: string, init?: RequestInit): Promise<OpenRelayVm> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.apiKey}`, ...init?.headers },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new OpenRelayApiError(operation, 0, error instanceof Error ? error.name : "network error");
    }
    if (!response.ok) {
      // Provider error bodies can contain internal placement data. Preserve a
      // short diagnostic without copying arbitrary content into task logs.
      const detail = (await response.text().catch(() => "")).replace(/[\u0000-\u001f]/g, " ").slice(0, 220);
      throw new OpenRelayApiError(operation, response.status, detail);
    }
    return vmFromUnknown(await response.json());
  }

  getVm(vmId: string): Promise<OpenRelayVm> {
    return this.requestVm("get VM", `/v1/vms/${requireVmId(vmId)}`);
  }

  stopVm(vmId: string): Promise<OpenRelayVm> {
    return this.requestVm("stop VM", `/v1/vms/${requireVmId(vmId)}/stop`, { method: "POST" });
  }

  restartVm(vmId: string): Promise<OpenRelayVm> {
    return this.requestVm("restart VM", `/v1/vms/${requireVmId(vmId)}/restart`, { method: "POST" });
  }
}
