import { PRICE } from "@/engine/pricing";

const COST_EPSILON_USD = 1e-9;

export interface NovitaCostEnvelopeInput {
  /** Number of direct image workers the request will create. */
  readonly imageJobs?: number;
  /** Number of direct image-to-video workers the request will create. */
  readonly videoJobs?: number;
  /**
   * Optional caller-owned ceiling. It must cover the complete conservative
   * envelope; a partial sequence is never allowed to start and strand a run
   * after it has already bought keyframes.
   */
  readonly maxCostUsd?: number;
  readonly label: string;
}

export interface NovitaCostEnvelope {
  readonly imageJobs: number;
  readonly videoJobs: number;
  readonly imageMaxCostUsd: number;
  readonly videoMaxCostUsd: number;
  readonly totalMaxCostUsd: number;
}

/**
 * A paid pipeline block receives this only from the compiler-derived runner
 * context. Keep the narrowing here so every specialised block rejects a
 * legacy/custom invocation before it can transform a run-wide budget into a
 * direct-provider admission.
 */
export function requireNovitaStageBudget(
  value: number | undefined,
  label: string,
): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    throw new Error(`${label} requires an authenticated per-stage Novita budget reservation`);
  }
  return value;
}

function jobCount(value: number | undefined, label: string): number {
  const count = value ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return count;
}

/**
 * Creates a conservative, immutable direct-provider envelope from the exact
 * worker count. This is intentionally separate from optimistic planning
 * rates: a worker must have enough budget for its verified lifecycle, or it
 * never gets provisioned.
 */
export function novitaCostEnvelope(input: NovitaCostEnvelopeInput): NovitaCostEnvelope {
  const imageJobs = jobCount(input.imageJobs, `${input.label} image job count`);
  const videoJobs = jobCount(input.videoJobs, `${input.label} video job count`);
  const imageMaxCostUsd = imageJobs * PRICE.novitaImageMaxUsd;
  const videoMaxCostUsd = videoJobs * PRICE.novitaVideoMaxUsd;
  const totalMaxCostUsd = imageMaxCostUsd + videoMaxCostUsd;

  if (!Number.isFinite(totalMaxCostUsd) || totalMaxCostUsd <= 0) {
    throw new Error(`${input.label} must contain at least one Novita worker`);
  }

  if (input.maxCostUsd !== undefined) {
    if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) {
      throw new Error(`${input.label} has an invalid Novita cost ceiling`);
    }
    if (input.maxCostUsd + COST_EPSILON_USD < totalMaxCostUsd) {
      throw new Error(
        `${input.label} requires a $${totalMaxCostUsd.toFixed(4)} Novita envelope but only $${input.maxCostUsd.toFixed(4)} is admitted`,
      );
    }
  }

  return {
    imageJobs,
    videoJobs,
    imageMaxCostUsd,
    videoMaxCostUsd,
    totalMaxCostUsd,
  };
}
