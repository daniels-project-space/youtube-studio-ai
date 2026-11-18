import http from "node:http";
import { ApiClient, RetrieveRunResponse } from "@trigger.dev/core/v3";
import { privateTriggerApiOrigin } from "./privateTriggerTarget";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class PrivateTriggerStatusError extends Error {
  constructor(message = "Private Trigger status is unavailable.") {
    super(message);
    this.name = "PrivateTriggerStatusError";
  }
}

/** Read one status without proxy, DNS redirection, redirects, or shared SDK configuration. */
export async function retrievePrivateTriggerStatus(
  env: Record<string, string | undefined>, runId: string,
): Promise<{ status: string; output: unknown; error: unknown }> {
  const origin = privateTriggerApiOrigin(env);
  if (!/^run_[A-Za-z0-9_-]{1,200}$/.test(runId) || !env.TRIGGER_SECRET_KEY) {
    throw new PrivateTriggerStatusError();
  }
  const url = new URL(origin);
  const hostname = url.hostname === "localhost" ? "127.0.0.1" : url.hostname === "[::1]" ? "::1" : url.hostname;
  const headers = new ApiClient(origin, env.TRIGGER_SECRET_KEY).getHeaders();
  const body = await new Promise<Buffer>((resolve, reject) => {
    const request = http.request({
      hostname, port: url.port || 80, method: "GET", path: `/api/v3/runs/${runId}`,
      headers: { ...headers, host: url.host }, agent: false,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new PrivateTriggerStatusError());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new PrivateTriggerStatusError());
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(new PrivateTriggerStatusError()));
      response.on("aborted", () => reject(new PrivateTriggerStatusError()));
    });
    request.setTimeout(5000, () => request.destroy(new PrivateTriggerStatusError()));
    request.on("error", () => reject(new PrivateTriggerStatusError()));
    request.end();
  });
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { throw new PrivateTriggerStatusError(); }
  const result = RetrieveRunResponse.safeParse(parsed);
  if (!result.success) throw new PrivateTriggerStatusError();
  if (result.data.outputPresignedUrl !== undefined) {
    throw new PrivateTriggerStatusError("Private Trigger status has separately stored output that cannot be read safely.");
  }
  return { status: result.data.status, output: result.data.output ?? null, error: result.data.error ?? null };
}
