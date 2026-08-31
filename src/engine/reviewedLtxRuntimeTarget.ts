import { generationProfile } from "./generationProfiles";
import {
  resolveReviewedLtxBenchmarkRegistry,
  type ReviewedLtxBenchmarkAdmission,
} from "./ltxBenchmarkAdmission";
import {
  NOVITA_LOCKED_VIDEO_RUNTIME,
  novitaVideoProfileIdentity,
  type NovitaVideoRuntimeTarget,
} from "./runtimeCapability";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Runtime-facing projection of a reviewed LTX benchmark record. This is
 * deliberately explicit input: a benchmark cannot change the global runtime
 * allow-list by being present in storage, logs, or a UI response.
 */
export interface ReviewedLtxRuntimeTargetResolution {
  readonly status: "unattested" | "attested";
  readonly runtime: NovitaVideoRuntimeTarget;
  readonly admissionFingerprints: readonly string[];
}

/**
 * Immutable run-snapshot projection of a reviewed LTX benchmark. It is never
 * accepted from a browser or mutable task payload: the parent and every remote
 * child re-read the active service-owned registry and prove this exact seed is
 * still active before a video worker can be admitted.
 */
export const REVIEWED_LTX_RUNTIME_SEED_VERSION = "reviewed-ltx-runtime-target/v1" as const;
export const REVIEWED_LTX_RUNTIME_SEED_KEY = "reviewedLtxRuntimeTarget" as const;

export interface ReviewedLtxRuntimeSeed {
  readonly version: typeof REVIEWED_LTX_RUNTIME_SEED_VERSION;
  readonly runtime: NovitaVideoRuntimeTarget;
  readonly admissionFingerprints: readonly string[];
  readonly fingerprint: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function frozenRuntime(runtime: NovitaVideoRuntimeTarget): NovitaVideoRuntimeTarget {
  if (
    runtime.gpuSku !== NOVITA_LOCKED_VIDEO_RUNTIME.gpuSku
    || runtime.vramGb !== NOVITA_LOCKED_VIDEO_RUNTIME.vramGb
    || runtime.benchmarkedVideoProfileRevisions.length !== 1
    || runtime.benchmarkedVideoProfileRevisions[0] !== DIRECT_LTX_PROFILE_IDENTITY
  ) {
    throw new Error("reviewed LTX runtime target does not match the sealed direct-LTX hardware/profile identity");
  }
  return Object.freeze({
    gpuSku: runtime.gpuSku,
    vramGb: runtime.vramGb,
    benchmarkedVideoProfileRevisions: Object.freeze([...runtime.benchmarkedVideoProfileRevisions]),
  });
}

function normalizedAdmissionFingerprints(values: readonly unknown[]): readonly string[] {
  const fingerprints = values.map((value) => {
    if (typeof value !== "string" || !SHA256_HEX.test(value)) {
      throw new Error("reviewed LTX runtime seed contains an invalid benchmark admission fingerprint");
    }
    return value;
  }).sort();
  if (!fingerprints.length || new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("reviewed LTX runtime seed requires a non-empty unique benchmark admission set");
  }
  return Object.freeze(fingerprints);
}

function seedPayload(value: Omit<ReviewedLtxRuntimeSeed, "fingerprint">): string {
  return canonicalJson(value);
}

export function reviewedLtxRuntimeSeed(
  resolution: ReviewedLtxRuntimeTargetResolution,
): ReviewedLtxRuntimeSeed | undefined {
  if (resolution.status === "unattested") return undefined;
  const core = {
    version: REVIEWED_LTX_RUNTIME_SEED_VERSION,
    runtime: frozenRuntime(resolution.runtime),
    admissionFingerprints: normalizedAdmissionFingerprints(resolution.admissionFingerprints),
  } as const;
  return Object.freeze({ ...core, fingerprint: sha256Hex(seedPayload(core)) });
}

export function assertReviewedLtxRuntimeSeed(value: unknown): ReviewedLtxRuntimeSeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("reviewed LTX runtime seed must be an object");
  }
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  const expectedKeys = ["admissionFingerprints", "fingerprint", "runtime", "version"];
  if (keys.length !== expectedKeys.length || !keys.every((key, index) => key === expectedKeys[index])) {
    throw new Error("reviewed LTX runtime seed has unknown or missing fields");
  }
  if (raw.version !== REVIEWED_LTX_RUNTIME_SEED_VERSION) {
    throw new Error("reviewed LTX runtime seed version is unsupported");
  }
  const runtime = frozenRuntime(raw.runtime as NovitaVideoRuntimeTarget);
  const admissionFingerprints = normalizedAdmissionFingerprints(
    Array.isArray(raw.admissionFingerprints) ? raw.admissionFingerprints : [],
  );
  if (typeof raw.fingerprint !== "string" || !SHA256_HEX.test(raw.fingerprint)) {
    throw new Error("reviewed LTX runtime seed fingerprint is invalid");
  }
  const core = { version: REVIEWED_LTX_RUNTIME_SEED_VERSION, runtime, admissionFingerprints } as const;
  if (raw.fingerprint !== sha256Hex(seedPayload(core))) {
    throw new Error("reviewed LTX runtime seed fingerprint does not match its sealed fields");
  }
  return Object.freeze({ ...core, fingerprint: raw.fingerprint });
}

/**
 * New approved benchmarks may coexist with a frozen run. Revocation or a
 * hardware/profile mismatch may not: each seed admission must remain active.
 */
export function assertReviewedLtxRuntimeSeedStillActive(args: {
  readonly seed: unknown;
  readonly current: ReviewedLtxRuntimeTargetResolution;
}): ReviewedLtxRuntimeSeed {
  const seed = assertReviewedLtxRuntimeSeed(args.seed);
  const current = reviewedLtxRuntimeSeed(args.current);
  if (!current) {
    throw new Error("reviewed LTX runtime seed has no active reviewed benchmark admission");
  }
  const currentFingerprints = new Set(current.admissionFingerprints);
  if (!seed.admissionFingerprints.every((fingerprint) => currentFingerprints.has(fingerprint))) {
    throw new Error("reviewed LTX runtime seed names a revoked or missing benchmark admission");
  }
  if (canonicalJson(seed.runtime) !== canonicalJson(current.runtime)) {
    throw new Error("reviewed LTX runtime seed no longer matches the active hardware/profile target");
  }
  return seed;
}

const DIRECT_LTX_PROFILE_IDENTITY = novitaVideoProfileIdentity(generationProfile("production"));

/**
 * Derive the only non-static LTX runtime target from a complete, independently
 * reviewed, manually approved benchmark record. Callers must still pass this
 * target through every later pre-spend assertion; omitting it keeps the
 * existing fail-closed `NOVITA_LOCKED_VIDEO_RUNTIME` behavior.
 */
export function reviewedLtxRuntimeTarget(
  reviewedAdmissions: readonly unknown[] = [],
): ReviewedLtxRuntimeTargetResolution {
  const admissions = resolveReviewedLtxBenchmarkRegistry(reviewedAdmissions);
  if (!admissions.length) {
    return Object.freeze({
      status: "unattested" as const,
      runtime: NOVITA_LOCKED_VIDEO_RUNTIME,
      admissionFingerprints: Object.freeze([]),
    });
  }
  const admissionFingerprints = admissions
    .map((admission: ReviewedLtxBenchmarkAdmission) => admission.admissionFingerprint)
    .sort();
  return Object.freeze({
    status: "attested" as const,
    runtime: Object.freeze({
      gpuSku: NOVITA_LOCKED_VIDEO_RUNTIME.gpuSku,
      vramGb: NOVITA_LOCKED_VIDEO_RUNTIME.vramGb,
      benchmarkedVideoProfileRevisions: Object.freeze([DIRECT_LTX_PROFILE_IDENTITY]),
    }),
    admissionFingerprints: Object.freeze(admissionFingerprints),
  });
}
