export interface ReadLimitPolicy {
  defaultLimit: number;
  maxLimit: number;
  label: string;
}

/** Reject malformed or oversized reads instead of silently scanning history. */
export function validatedReadLimit(
  requested: number | undefined,
  policy: ReadLimitPolicy,
): number {
  const value = requested ?? policy.defaultLimit;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > policy.maxLimit
  ) {
    throw new Error(
      `${policy.label} must be an integer between 1 and ${policy.maxLimit}`,
    );
  }
  return value;
}

export const RUNS_BY_CHANNEL_LIMIT = {
  defaultLimit: 200,
  maxLimit: 500,
  label: "run history limit",
} as const;

export const RECENT_RUNS_LIMIT = {
  defaultLimit: 10,
  maxLimit: 200,
  label: "recent runs limit",
} as const;

export const RUN_HISTORY_PAGE_LIMIT = {
  defaultLimit: 100,
  maxLimit: 200,
  label: "run history page size",
} as const;

export const CHANNEL_PLAN_LIMIT = {
  defaultLimit: 200,
  maxLimit: 500,
  label: "channel plan limit",
} as const;

export const OWNER_PLAN_LIMIT = {
  defaultLimit: 500,
  maxLimit: 1_000,
  label: "owner plan limit",
} as const;

export const PLAN_HISTORY_PAGE_LIMIT = {
  defaultLimit: 50,
  maxLimit: 100,
  label: "plan history page size",
} as const;
