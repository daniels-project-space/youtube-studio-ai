import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const AUTOMATIC_WORKFLOW_VERSION = "automatic-workflow/v1" as const;
export const AUTOMATIC_RESUME_MAX_ATTEMPTS = 2 as const;

/** One sealed policy for all six selected automatic workflow improvements. */
export type AutomaticControlPolicy = {
  version: typeof AUTOMATIC_WORKFLOW_VERSION;
  mode: "fully_automatic";
  resume: { enabled: true; exactRun: true; resumeCompletedStages: true; maxAttempts: typeof AUTOMATIC_RESUME_MAX_ATTEMPTS };
  reuse: { enabled: true; strategy: "content_addressed"; completedStageOnly: true; acceptedPaidWorkReplay: false };
  preflight: {
    unified: true;
    beforePaidWork: true;
    checks: readonly ["budget", "module_contracts", "resume_boundary", "provider_route", "artifact_ownership"];
  };
  deduplication: { enabled: true; scope: "owner"; crossChannel: true; identity: "module_input_params" };
  batching: { conflictAware: true; deterministicWaves: true; maxConcurrent: 3 };
  bulkActions: { undoable: true; maxTargets: 100 };
  fingerprint: string;
};

export function createAutomaticControlPolicy(): AutomaticControlPolicy {
  const body = {
    version: AUTOMATIC_WORKFLOW_VERSION as typeof AUTOMATIC_WORKFLOW_VERSION,
    mode: "fully_automatic" as const,
    resume: { enabled: true as const, exactRun: true as const, resumeCompletedStages: true as const, maxAttempts: AUTOMATIC_RESUME_MAX_ATTEMPTS },
    reuse: { enabled: true as const, strategy: "content_addressed" as const, completedStageOnly: true as const, acceptedPaidWorkReplay: false as const },
    preflight: {
      unified: true as const,
      beforePaidWork: true as const,
      checks: ["budget", "module_contracts", "resume_boundary", "provider_route", "artifact_ownership"] as const,
    },
    deduplication: { enabled: true as const, scope: "owner" as const, crossChannel: true as const, identity: "module_input_params" as const },
    batching: { conflictAware: true as const, deterministicWaves: true as const, maxConcurrent: 3 as const },
    bulkActions: { undoable: true as const, maxTargets: 100 as const },
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export function assertAutomaticControlPolicy(value: unknown): AutomaticControlPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("automatic control policy is invalid");
  const policy = value as AutomaticControlPolicy;
  const expected = createAutomaticControlPolicy();
  const { fingerprint: actualFingerprint, ...actualBody } = policy;
  const { fingerprint: expectedFingerprint, ...expectedBody } = expected;
  if (canonicalJson(actualBody) !== canonicalJson(expectedBody) || actualFingerprint !== expectedFingerprint) {
    throw new Error("automatic control policy fingerprint or defaults mismatch");
  }
  return expected;
}
