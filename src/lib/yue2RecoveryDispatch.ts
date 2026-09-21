import { configure, tasks } from "@trigger.dev/sdk/v3";
import { YuE2RecoveryScopeSchema } from "@/lib/yue2DurableEvaluation";

/** CLI-only opt-in delivery. No worker endpoint, credential or prompt enters the task payload. */
export async function queueYuE2Recovery(scope: unknown, secretKey: string) {
  const payload = YuE2RecoveryScopeSchema.parse(scope);
  if (!secretKey.trim()) throw new Error("TRIGGER_SECRET_KEY is required for recovery delivery");
  configure({ secretKey });
  return tasks.trigger("yue2-evaluation-recovery", payload, {
    idempotencyKey: `${payload.jobId}:recovery:v1`, idempotencyKeyTTL: "24h",
  });
}
