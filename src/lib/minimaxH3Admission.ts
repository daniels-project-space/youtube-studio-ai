import {
  SALAD_BULK_PRIORITY,
  SALAD_HIGH_FALLBACK_PRIORITY,
  saladPriorityPolicyFromEnv,
} from "@/lib/saladCloud";

/**
 * The pure admission half of the MiniMax H3 contract.
 *
 * Keep this separate from request dispatch and R2 signing so creator/runtime
 * preflight can remain provider-free and lightweight. The dispatch module
 * re-exports this surface as its public ABI.
 */
export const MINIMAX_H3_WORKER_CONTRACT = "minimax-h3-worker/v1" as const;
export const MINIMAX_H3_MODEL = "Comfy-Org/MiniMax-H3" as const;
export const MINIMAX_H3_MODEL_REVISION = "4cc1d817b6184899b41293954329f576cb5ae86b" as const;
export const MINIMAX_H3_RUNTIME_ID = "minimax-h3-turbo8-5090-v1" as const;
export const MINIMAX_H3_MANIFEST_SHA256 = "eca7ade81afd2edd4b912275a8657b9504cab71ca7e538aed7ce12f27acc90c9" as const;
export const MINIMAX_H3_SALAD_CAPACITY_MODE = SALAD_BULK_PRIORITY;
export const MINIMAX_H3_NOVITA_CAPACITY_MODE = "spot" as const;
export const MINIMAX_H3_PROFILE = Object.freeze({
  id: "official-turbo8-native-768p",
  width: 1344,
  height: 768,
  fps: 24,
  frames: 124,
  steps: 8,
});

export type MiniMaxH3Provider = "salad" | "novita";
export type MiniMaxH3Execution = "weekly-batch" | "weekly-fallback" | "on-demand";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface MiniMaxH3Readiness {
  configured: boolean;
  admitted: boolean;
  blockers: readonly string[];
}

export function miniMaxH3RouteEnvironment(provider: MiniMaxH3Provider): { url: string; token: string } {
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : "MINIMAX_H3_NOVITA";
  const rawUrl = process.env[`${prefix}_WORKER_URL`]?.trim() ?? "";
  const token = process.env[`${prefix}_WORKER_TOKEN`]?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${prefix}_WORKER_URL is missing or invalid`);
  }
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.hash) {
    throw new Error(`${prefix}_WORKER_URL must be a credential-free HTTPS URL outside local qualification`);
  }
  if (token.length < 32) throw new Error(`${prefix}_WORKER_TOKEN is missing or too short`);
  return { url: url.toString(), token };
}

export function minimaxH3Readiness(
  provider: MiniMaxH3Provider,
  options: { saladCapacityMode?: typeof MINIMAX_H3_SALAD_CAPACITY_MODE | typeof SALAD_HIGH_FALLBACK_PRIORITY } = {},
): MiniMaxH3Readiness {
  const blockers: string[] = [];
  try { miniMaxH3RouteEnvironment(provider); } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  const prefix = provider === "salad" ? "MINIMAX_H3_SALAD" : "MINIMAX_H3_NOVITA";
  if (process.env[`${prefix}_QUALIFIED`] !== "1") blockers.push(`${prefix}_QUALIFIED is not enabled`);
  const receipt = process.env[`${prefix}_QUALIFICATION_RECEIPT_SHA256`]?.trim().toLowerCase() ?? "";
  if (!SHA256.test(receipt)) blockers.push(`${prefix}_QUALIFICATION_RECEIPT_SHA256 is missing or invalid`);
  if (provider === "salad") {
    const capacityMode = options.saladCapacityMode ?? MINIMAX_H3_SALAD_CAPACITY_MODE;
    const policy = saladPriorityPolicyFromEnv();
    if (capacityMode === SALAD_HIGH_FALLBACK_PRIORITY) {
      if (!policy.highFallbackEnabled) blockers.push("MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK is disabled");
    } else if (!policy.mediumEnabled) {
      blockers.push("MINIMAX_H3_SALAD_MEDIUM_PRIORITY is disabled");
    }
  }
  return { configured: blockers.every((item) => !item.includes("WORKER_")), admitted: blockers.length === 0, blockers };
}
