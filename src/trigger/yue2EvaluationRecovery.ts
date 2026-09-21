import { task, wait } from "@trigger.dev/sdk/v3";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  executeDurableYuE2Evaluation, loadDurableYuE2Recovery, YuE2RecoveryScopeSchema,
  type YuE2RecoveryScope,
} from "@/lib/yue2DurableEvaluation";

export const yue2EvaluationRecovery = task({
  id: "yue2-evaluation-recovery",
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 2 },
  run: async (payload: YuE2RecoveryScope) => {
    const scope = YuE2RecoveryScopeSchema.parse(payload);
    const endpoint = process.env.YUE2_EVALUATION_URL, bearerToken = process.env.YUE2_EVALUATION_TOKEN;
    if (!endpoint || !bearerToken) throw new Error("YuE2 recovery worker configuration unavailable");
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"],
      required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
    const input = await loadDurableYuE2Recovery(scope, { endpoint, bearerToken });
    const policy = input.expectedExecutionPolicy;
    const checks = Math.ceil((policy.max_execution_seconds + policy.termination_grace_seconds) / 120) + 2;
    for (let index = 0; index < checks; index++) {
      const result = await executeDurableYuE2Evaluation(input);
      if (result.status !== "pending") return {
        status: result.status, jobId: result.jobId,
        ...(result.status === "completed" ? { candidateKey: result.candidateKey } : { reason: result.reason }),
        qualified: false, productionApproved: false,
      };
      if (index + 1 < checks) {
        await wait.for({ seconds: 120, idempotencyKey: `${scope.jobId}:recovery-wait:${index}` });
      }
    }
    // Exhaustion holds the existing job; it is never permission to resubmit.
    return { status: "pending", jobId: scope.jobId, reason: "recovery_window_exhausted",
      qualified: false, productionApproved: false };
  },
});
