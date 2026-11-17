export const SALAD_BULK_PRIORITY = "medium" as const;
export const SALAD_HIGH_FALLBACK_PRIORITY = "high" as const;

export interface SaladPriorityPolicy {
  mediumEnabled: boolean;
  highFallbackEnabled: boolean;
}

export function saladPriorityPolicyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SaladPriorityPolicy {
  return {
    mediumEnabled: env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY !== "0",
    highFallbackEnabled: env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK !== "0",
  };
}
