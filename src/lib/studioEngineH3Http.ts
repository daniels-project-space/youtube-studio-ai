import { boundedBytes, StudioEngineError } from "./studioRenderEngineClient";
import { STUDIO_ENGINE_API_BASE, STUDIO_ENGINE_PROJECT } from "./studioRenderEngineWorkflows";

export type StudioEngineH3Connection = { baseUrl: string; projectName: string; apiKey: string; fetchImpl?: typeof fetch };
export function validateStudioH3Connection(config: StudioEngineH3Connection) {
  if (config.baseUrl !== STUDIO_ENGINE_API_BASE || config.projectName !== STUDIO_ENGINE_PROJECT || !/^[a-f0-9]{64}$/.test(config.apiKey)) {
    throw new Error("H3 requires Studio's owned public managed API and management credential");
  }
}
export function studioH3Endpoint(config: StudioEngineH3Connection, path: string) {
  validateStudioH3Connection(config);
  const [pathname, query] = path.split("?");
  if (!["/client/workflows", "/client/input-uploads", "/client/studio-batch-admission", "/client/studio-batch-scenes",
    "/client/h3-jobs", "/client/h3-jobs/qualify-input", "/client/jobs", "/client/jobs/output",
    "/client/h3-scene-batches", "/client/h3-scene-batches/output"].includes(pathname)) throw new Error("Unsupported managed H3 operation");
  return `${STUDIO_ENGINE_API_BASE}/${pathname.slice("/client/".length)}${query === undefined ? "" : `?${query}`}`;
}
export async function studioH3Json(config: StudioEngineH3Connection, path: string, body?: unknown, timeoutMs = 20000) {
  const url = studioH3Endpoint(config, path);
  try {
    const response = await (config.fetchImpl ?? fetch)(url, { method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      void response.body?.cancel().catch(() => undefined);
      throw new StudioEngineError(response.status, body !== undefined);
    }
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response, 2000000)));
    return { status: response.status, body: parsed as unknown };
  } catch (error) {
    if (error instanceof StudioEngineError) throw error;
    throw new StudioEngineError(null, body !== undefined);
  }
}
