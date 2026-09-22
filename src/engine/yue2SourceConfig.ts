import { z } from "zod";
import { YuE2ExecutionPolicySchema, maximumYuE2Allocation } from "@/lib/yue2ExecutionPolicy";

export const YuE2SourceConfigSchema = z.object({
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  personalCreatorAcknowledged: z.literal(true),
  maxCostUsd: z.number().finite().positive().max(1),
  executionPolicy: YuE2ExecutionPolicySchema,
}).strict().superRefine((value, ctx) => {
  if (BigInt(value.executionPolicy.reserved_allocation_usd_micros) < maximumYuE2Allocation(value.executionPolicy)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["executionPolicy", "reserved_allocation_usd_micros"],
      message: "YuE2 execution accounting verification failed" });
  }
  if (value.executionPolicy.reserved_allocation_usd_micros > Math.floor(value.maxCostUsd * 1_000_000) ||
    value.executionPolicy.max_execution_seconds > 1200) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "YuE2 policy exceeds the explicit stage allocation or 1200-second execution window" });
  }
});
