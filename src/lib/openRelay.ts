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

const diagnosticCodes = new Set([
  "FORBIDDEN", "UNAUTHORIZED", "REVOKED_API_KEY", "NOT_FOUND", "not_found",
  "VM_NODE_BUSY", "POD_NODE_BUSY", "POD_NODE_OFFLINE", "POD_NODE_NO_INFINIBAND",
  "POD_STOPPING", "NODE_AT_CAPACITY", "INSUFFICIENT_GPU_CAPACITY",
  "INSUFFICIENT_CPU_CAPACITY", "INSUFFICIENT_HOST_CAPACITY", "INSUFFICIENT_IP_CAPACITY",
]);

async function readErrorDiagnostic(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) return "";
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const { code, requestId } = value as Record<string, unknown>;
    // Free-form provider messages, unknown codes and arbitrary IDs can echo keys.
    return [
      typeof code === "string" && diagnosticCodes.has(code) ? code : "",
      typeof requestId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
        ? `request ${requestId}` : "",
    ].filter(Boolean).join("; ");
  } catch { return ""; }
  finally { void reader.cancel().catch(() => undefined); }
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
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new OpenRelayApiError(operation, 0, "transport unavailable");
    }
    if (!response.ok) {
      const detail = await readErrorDiagnostic(response);
      throw new OpenRelayApiError(operation, response.status, detail);
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new OpenRelayApiError(operation, response.status, "invalid JSON response"); }
    return vmFromUnknown(value);
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
