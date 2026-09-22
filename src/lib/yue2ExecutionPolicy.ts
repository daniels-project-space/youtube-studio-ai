import { z } from "zod";

const PositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Label = z.string().min(1).refine(value => value === value.trim() &&
  new TextEncoder().encode(value).length <= 512 && !/[\x00-\x1f]/u.test(value) &&
  new TextDecoder().decode(new TextEncoder().encode(value)) === value);

/** Provider-free admission contract shared by previews and runtime accounting. */
export const YuE2ExecutionPolicySchema = z.object({
  schema_version: z.literal(1), provider: z.literal("openrelay"),
  allocation_basis: z.literal("supervised_dispatch_wall_time"), rate_source: z.literal("operator_configured"),
  rate_reference: Label, runtime_id: Label.refine(value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)),
  hourly_rate_usd_micros: PositiveInteger,
  max_execution_seconds: z.number().int().min(1).max(7200),
  termination_grace_seconds: z.number().int().min(1).max(30),
  reserved_allocation_usd_micros: PositiveInteger,
}).strict();
export type YuE2ExecutionPolicy = z.infer<typeof YuE2ExecutionPolicySchema>;

export function maximumYuE2Allocation(policy: YuE2ExecutionPolicy): bigint {
  return (BigInt(policy.hourly_rate_usd_micros) *
    BigInt(policy.max_execution_seconds + policy.termination_grace_seconds) + BigInt(3599)) / BigInt(3600);
}

export function validateYuE2ExecutionPolicy(input: unknown): YuE2ExecutionPolicy {
  const policy = YuE2ExecutionPolicySchema.parse(input);
  if (BigInt(policy.reserved_allocation_usd_micros) < maximumYuE2Allocation(policy)) {
    throw new Error("YuE2 execution accounting verification failed");
  }
  return policy;
}
