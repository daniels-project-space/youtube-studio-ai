import { MINIMAX_H3_MANIFEST_SHA256, MINIMAX_H3_PROFILE, MINIMAX_H3_WORKER_CONTRACT } from "@/lib/minimaxH3Admission";
import { miniMaxH3RequestKey, type MiniMaxH3RenderRequest } from "@/lib/minimaxH3";
import { canonicalJson } from "@/lib/canonicalJson";

/** Studio will use only a project-authenticated, exact image-to-video adapter. */
export const RENDER_ENGINE_H3_PROJECT = "youtube-studio" as const;
export const RENDER_ENGINE_H3_CONTRACT = "render-engine-h3-studio-ivt/v1" as const;

/** Immutable order shape for the future Render Engine batch adapter. */
export function buildRenderEngineH3BatchHandoff(args: {
  ownerId: string;
  orderKey: string;
  receiptKey: string;
  jobs: readonly Omit<MiniMaxH3RenderRequest, "provider" | "execution">[];
}) {
  if (!args.ownerId || !args.orderKey || !args.receiptKey.startsWith(`owner/${args.ownerId}/`) ||
      !args.receiptKey.endsWith(".json") || args.jobs.length < 1 || args.jobs.length > 60) {
    throw new Error("Render Engine H3 handoff is not bound to a valid owner order");
  }
  const jobs = args.jobs.map((job) => {
    if (!job.firstFrame.r2Key.startsWith(`owner/${args.ownerId}/`) ||
        !job.output.r2Key.startsWith(`owner/${args.ownerId}/`)) {
      throw new Error("Render Engine H3 handoff job is outside the owner scope");
    }
    return {
      sourceRequestKey: miniMaxH3RequestKey({ ...job, provider: "salad", execution: "weekly-batch" }),
      prompt: job.prompt,
      seed: job.seed,
      firstFrame: job.firstFrame,
      output: job.output,
      maxCostUsd: job.maxCostUsd,
    };
  });
  const handoff = {
    schema: "render-engine-h3-studio-weekly-batch/v1" as const,
    projectName: RENDER_ENGINE_H3_PROJECT,
    ownerId: args.ownerId,
    orderKey: args.orderKey,
    receiptKey: args.receiptKey,
    profile: MINIMAX_H3_PROFILE,
    modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
    workerReceiptSchema: MINIMAX_H3_WORKER_CONTRACT,
    jobs,
  };
  assertRenderEngineH3BatchHandoff(handoff);
  return handoff;
}

/** Reject handoffs that would silently lose the Studio H3 quality or owner binding. */
export function assertRenderEngineH3BatchHandoff(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Render Engine H3 handoff is malformed");
  const record = value as Record<string, unknown>;
  const jobs = record.jobs;
  if (record.schema !== "render-engine-h3-studio-weekly-batch/v1" ||
      record.projectName !== RENDER_ENGINE_H3_PROJECT ||
      typeof record.ownerId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(record.ownerId) ||
      typeof record.orderKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(record.orderKey) ||
      typeof record.receiptKey !== "string" || !record.receiptKey.startsWith(`owner/${record.ownerId}/`) ||
      !record.receiptKey.endsWith(".json") || record.receiptKey.length > 1_000 ||
      record.receiptKey.includes("\\") || /(?:^|\/)\.\.?($|\/)/u.test(record.receiptKey) ||
      canonicalJson(record.profile) !== canonicalJson(MINIMAX_H3_PROFILE) ||
      record.modelManifestSha256 !== MINIMAX_H3_MANIFEST_SHA256 ||
      record.workerReceiptSchema !== MINIMAX_H3_WORKER_CONTRACT ||
      !Array.isArray(jobs) || jobs.length < 1 || jobs.length > 60) {
    throw new Error("Render Engine H3 handoff does not match the frozen Studio profile or order");
  }
  const requestKeys = new Set<string>();
  const outputKeys = new Set<string>();
  for (const item of jobs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Render Engine H3 handoff job is malformed");
    const job = item as Record<string, unknown>;
    const firstFrame = job.firstFrame as Record<string, unknown> | null;
    const output = job.output as Record<string, unknown> | null;
    if (typeof job.prompt !== "string" || typeof job.seed !== "number" ||
        typeof job.maxCostUsd !== "number" ||
        !firstFrame || typeof firstFrame !== "object" || !output || typeof output !== "object" ||
        typeof firstFrame.r2Key !== "string" || typeof output.r2Key !== "string" ||
        !firstFrame.r2Key.startsWith(`owner/${record.ownerId}/`) ||
        !output.r2Key.startsWith(`owner/${record.ownerId}/`) ||
        typeof job.sourceRequestKey !== "string" ||
        job.sourceRequestKey !== miniMaxH3RequestKey({
          prompt: job.prompt, seed: job.seed, firstFrame: { r2Key: firstFrame.r2Key, sha256: firstFrame.sha256 as string },
          output: { r2Key: output.r2Key }, maxCostUsd: job.maxCostUsd,
          provider: "salad", execution: "weekly-batch",
        })) {
      throw new Error("Render Engine H3 handoff job is not bound to its frozen source request");
    }
    if (requestKeys.has(job.sourceRequestKey) || outputKeys.has(output.r2Key)) throw new Error("Render Engine H3 handoff contains duplicate jobs");
    requestKeys.add(job.sourceRequestKey);
    outputKeys.add(output.r2Key);
  }
}

export type RenderEngineH3ContractRead =
  | { contractMatched: true; endpoint: string; workflowId: string }
  | { contractMatched: false; reason: string };

export function exactRenderEngineH3Contract(value: unknown): value is {
  schema: typeof RENDER_ENGINE_H3_CONTRACT;
  projectName: typeof RENDER_ENGINE_H3_PROJECT;
  workflowId: string;
  profile: typeof MINIMAX_H3_PROFILE;
  modelManifestSha256: typeof MINIMAX_H3_MANIFEST_SHA256;
  workerReceiptSchema: typeof MINIMAX_H3_WORKER_CONTRACT;
  firstFrameSourceBucket: "youtube-studio-ai";
  outputBucket: "youtube-studio-ai";
  openingMotionQa: "minimax-h3-opening-motion-qa/v1";
  qualifiedHyper: true;
  paidDispatchEnabled: true;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === RENDER_ENGINE_H3_CONTRACT &&
    record.projectName === RENDER_ENGINE_H3_PROJECT &&
    typeof record.workflowId === "string" && /^[a-z0-9]{32}$/u.test(record.workflowId) &&
    canonicalJson(record.profile) === canonicalJson(MINIMAX_H3_PROFILE) &&
    record.modelManifestSha256 === MINIMAX_H3_MANIFEST_SHA256 &&
    record.workerReceiptSchema === MINIMAX_H3_WORKER_CONTRACT &&
    record.firstFrameSourceBucket === "youtube-studio-ai" &&
    record.outputBucket === "youtube-studio-ai" &&
    record.openingMotionQa === "minimax-h3-opening-motion-qa/v1" &&
    record.qualifiedHyper === true && record.paidDispatchEnabled === true;
}

/** Read-only project capability probe. An absent route or a weaker profile is a hard gate. */
export async function readRenderEngineH3Contract(options: {
  env?: Readonly<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
} = {}): Promise<RenderEngineH3ContractRead> {
  const env = options.env ?? process.env;
  if (env.MINIMAX_H3_HYPER_EMERGENCY !== "1") return { contractMatched: false, reason: "Hyper emergency route is disabled" };
  const token = env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? "";
  const rawEndpoint = env.RENDER_ENGINE_CONVEX_SITE_URL?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(token)) return { contractMatched: false, reason: "Render Engine project capability is unavailable" };
  let endpoint: URL;
  try { endpoint = new URL(rawEndpoint); } catch { return { contractMatched: false, reason: "Render Engine endpoint is unavailable" }; }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    return { contractMatched: false, reason: "Render Engine endpoint must be a credential-free HTTPS origin" };
  }
  const contractUrl = new URL("/client/h3-contract", endpoint);
  contractUrl.searchParams.set("projectName", RENDER_ENGINE_H3_PROJECT);
  try {
    const response = await (options.fetcher ?? fetch)(contractUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { contractMatched: false, reason: `Render Engine exact H3 contract unavailable (HTTP ${response.status})` };
    const contract: unknown = await response.json();
    if (!exactRenderEngineH3Contract(contract)) return { contractMatched: false, reason: "Render Engine has no qualified exact Studio H3 image-to-video adapter" };
    return { contractMatched: true, endpoint: endpoint.origin, workflowId: contract.workflowId };
  } catch {
    return { contractMatched: false, reason: "Render Engine exact H3 contract probe failed" };
  }
}

/** Persist a frozen weekly order in the Engine's project ledger. Staging is not a render. */
export async function stageRenderEngineH3BatchHandoff(
  handoff: ReturnType<typeof buildRenderEngineH3BatchHandoff>,
  options: { env?: Readonly<Record<string, string | undefined>>; fetcher?: typeof fetch } = {},
): Promise<{ batchId: string; state: "staged-unqualified"; acceptedJobs: number; dispatchEnabled: false }> {
  assertRenderEngineH3BatchHandoff(handoff);
  const env = options.env ?? process.env;
  const token = env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? "";
  const rawEndpoint = env.RENDER_ENGINE_CONVEX_SITE_URL?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error("Render Engine project capability is unavailable");
  let endpoint: URL;
  try { endpoint = new URL(rawEndpoint); } catch { throw new Error("Render Engine endpoint is unavailable"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("Render Engine endpoint must be a credential-free HTTPS origin");
  }
  const response = await (options.fetcher ?? fetch)(new URL("/client/studio-h3-weekly-batches", endpoint), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(handoff),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 202) throw new Error(`Render Engine weekly H3 staging failed (HTTP ${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Render Engine weekly H3 staging response is malformed");
  const record = result as Record<string, unknown>;
  if (typeof record.batchId !== "string" || !record.batchId || record.state !== "staged-unqualified" ||
      record.dispatchEnabled !== false || record.acceptedJobs !== handoff.jobs.length) {
    throw new Error("Render Engine weekly H3 staging response does not match the frozen order");
  }
  return { batchId: record.batchId, state: "staged-unqualified", acceptedJobs: handoff.jobs.length, dispatchEnabled: false };
}
