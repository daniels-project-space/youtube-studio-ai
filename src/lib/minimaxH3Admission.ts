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
/** OpenRelay's terminal weekly lane uses the same sealed H3 model pack on A100. */
export const MINIMAX_H3_OPENRELAY_RUNTIME_ID = "minimax-h3-turbo8-a100-v1" as const;
// Re-verified against the current R2 immutable manifest on 2026-09-18. Its
// five file keys, checksums, and 44,426,778,471 source bytes match the sealed
// MiniMax H3 pack; the prior digest referred to an older manifest envelope.
export const MINIMAX_H3_MANIFEST_SHA256 = "1e1b44f69249511e8e7308e5ceb9c9fa60efff4abde37f200dc33f28345b5ae3" as const;
export const MINIMAX_H3_SALAD_CAPACITY_MODE = SALAD_BULK_PRIORITY;
export const MINIMAX_H3_NOVITA_CAPACITY_MODE = "spot" as const;
/**
 * A stopped OpenRelay VM retains its verified local disk but releases its GPU.
 * This lane is intentionally a terminal weekly fallback, never Salad's
 * primary weekly admission path.
 */
export const MINIMAX_H3_OPENRELAY_CAPACITY_MODE = "persistent-disk-auto-stop" as const;
export const MINIMAX_H3_OPENRELAY_GPU_MODEL = "A100" as const;
export const MINIMAX_H3_PROFILE = Object.freeze({
  id: "official-turbo8-native-768p",
  width: 1344,
  height: 768,
  fps: 24,
  frames: 124,
  steps: 8,
});

export type MiniMaxH3Provider = "salad" | "novita" | "openrelay";
export type MiniMaxH3Execution = "weekly-batch" | "weekly-fallback" | "on-demand";

const SHA256 = /^[a-f0-9]{64}$/u;

export function miniMaxH3RuntimeId(provider: MiniMaxH3Provider):
  typeof MINIMAX_H3_RUNTIME_ID | typeof MINIMAX_H3_OPENRELAY_RUNTIME_ID {
  return provider === "openrelay" ? MINIMAX_H3_OPENRELAY_RUNTIME_ID : MINIMAX_H3_RUNTIME_ID;
}

export function miniMaxH3GpuModel(provider: MiniMaxH3Provider): "RTX 5090" | typeof MINIMAX_H3_OPENRELAY_GPU_MODEL {
  return provider === "openrelay" ? MINIMAX_H3_OPENRELAY_GPU_MODEL : "RTX 5090";
}

export interface MiniMaxH3Readiness {
  configured: boolean;
  admitted: boolean;
  blockers: readonly string[];
}

export function miniMaxH3RouteEnvironment(provider: MiniMaxH3Provider): { url: string; token: string } {
  const prefix = provider === "salad"
    ? "MINIMAX_H3_SALAD"
    : provider === "novita"
      ? "MINIMAX_H3_NOVITA"
      : "MINIMAX_H3_OPENRELAY";
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
  const prefix = provider === "salad"
    ? "MINIMAX_H3_SALAD"
    : provider === "novita"
      ? "MINIMAX_H3_NOVITA"
      : "MINIMAX_H3_OPENRELAY";
  if (process.env[`${prefix}_QUALIFIED`] !== "1") blockers.push(`${prefix}_QUALIFIED is not enabled`);
  const receipt = process.env[`${prefix}_QUALIFICATION_RECEIPT_SHA256`]?.trim().toLowerCase() ?? "";
  if (!SHA256.test(receipt)) blockers.push(`${prefix}_QUALIFICATION_RECEIPT_SHA256 is missing or invalid`);
  if (provider === "openrelay" && (process.env.OPENRELAY_API_KEY?.trim().length ?? 0) < 32) {
    blockers.push("OPENRELAY_API_KEY is missing or too short for the private H3 gateway");
  }
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
