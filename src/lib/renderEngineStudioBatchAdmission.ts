const PROJECT_NAME = "youtube-studio-ai";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RESPONSE_LIMIT = 20_000;

export type StudioBatchAdmission = {
  batchId: string;
  handoffSha256: string;
  state: "awaiting-scene-artifacts";
  itemCount: number;
  admittedAt: number;
  reused: boolean;
};

export type StudioBatchAdmissionResult =
  | { state: "admitted"; admission: StudioBatchAdmission }
  | { state: "not-ready" };

type Environment = Record<string, string | undefined>;

function identifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Render Engine Studio ${label} is invalid`);
  return value;
}

function origin(env: Environment): string {
  const configured = env.RENDER_ENGINE_CONVEX_SITE_URL;
  if (!configured) throw new Error("Render Engine Studio endpoint is not configured");
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("Render Engine Studio endpoint is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== configured || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Render Engine Studio endpoint must be an HTTPS origin");
  }
  return parsed.origin;
}

function accessToken(env: Environment): string {
  const token = env.RENDER_ENGINE_PROJECT_TOKEN;
  if (!token || !SHA256.test(token)) throw new Error("Render Engine Studio capability is not configured");
  return token;
}

function admission(value: unknown, expectedBatchId: string): StudioBatchAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Render Engine returned an invalid Studio admission");
  const response = value as Record<string, unknown>;
  if (Object.keys(response).sort().join("\0") !== ["admittedAt", "batchId", "handoffSha256", "itemCount", "reused", "state"].join("\0") ||
      response.batchId !== expectedBatchId || typeof response.handoffSha256 !== "string" || !SHA256.test(response.handoffSha256) ||
      response.state !== "awaiting-scene-artifacts" || typeof response.itemCount !== "number" || !Number.isInteger(response.itemCount) || response.itemCount < 1 ||
      typeof response.admittedAt !== "number" || !Number.isFinite(response.admittedAt) || response.admittedAt <= 0 ||
      typeof response.reused !== "boolean") {
    throw new Error("Render Engine returned an invalid Studio admission");
  }
  return response as StudioBatchAdmission;
}

/**
 * Stores only Studio's frozen handoff identity in Render Engine. The Engine
 * endpoint does not create jobs, reserve a GPU, or authorize publication.
 */
export async function admitStudioBatchToRenderEngine(args: {
  ownerId: string;
  batchId: string;
  env?: Environment;
  request?: typeof fetch;
}): Promise<StudioBatchAdmissionResult> {
  const ownerId = identifier(args.ownerId, "owner ID");
  const batchId = identifier(args.batchId, "batch ID");
  const env = args.env ?? process.env;
  const endpoint = new URL("/client/studio-batch-admission", origin(env));
  const response = await (args.request ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken(env)}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectName: PROJECT_NAME, ownerId, batchId }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { state: "not-ready" };
  if (response.status !== 202) throw new Error(`Render Engine Studio admission refused (HTTP ${response.status})`);
  if ((Number(response.headers.get("content-length")) || 0) > RESPONSE_LIMIT) {
    throw new Error("Render Engine Studio admission response is oversized");
  }
  const body = await response.text();
  if (body.length > RESPONSE_LIMIT) throw new Error("Render Engine Studio admission response is oversized");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Render Engine returned an invalid Studio admission");
  }
  return { state: "admitted", admission: admission(parsed, batchId) };
}
