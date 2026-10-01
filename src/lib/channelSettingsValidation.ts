export class SettingsValidationError extends Error {}

function numberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new SettingsValidationError(
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return parsed;
}

export function validatedSchedule(
  current: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const merged = { ...current, ...input };
  const frequency = String(merged.frequency ?? "weekly");
  if (!["daily", "weekly", "biweekly", "monthly"].includes(frequency)) {
    throw new SettingsValidationError("invalid schedule frequency");
  }
  const timezone = String(merged.timezone ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new SettingsValidationError(`invalid IANA timezone: ${timezone}`);
  }
  const localTime = String(merged.localTime ?? "09:00");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
    throw new SettingsValidationError("localTime must be HH:MM in 24-hour time");
  }
  const rawDays = Array.isArray(merged.days) ? merged.days : [];
  const days = [...new Set(rawDays.map(Number))].sort((a, b) => a - b);
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new SettingsValidationError(
      "schedule days must be integers from 0 to 6",
    );
  }
  if ((frequency === "weekly" || frequency === "biweekly") && days.length === 0) {
    throw new SettingsValidationError(
      "weekly and biweekly schedules require at least one weekday",
    );
  }
  const approvalMode = String(merged.approvalMode ?? "manual");
  if (approvalMode !== "manual" && approvalMode !== "private_auto") {
    throw new SettingsValidationError("invalid schedule approval mode");
  }
  return {
    frequency,
    days: frequency === "weekly" || frequency === "biweekly" ? days : undefined,
    timezone,
    localTime,
    enabled: merged.enabled !== false,
    approvalMode: approvalMode as "manual" | "private_auto",
    dailyQuota: numberInRange(merged.dailyQuota ?? 1, "dailyQuota", 1, 50),
    maxConcurrent: numberInRange(
      merged.maxConcurrent ?? 1,
      "maxConcurrent",
      1,
      10,
    ),
    retryMaxAttempts: numberInRange(
      merged.retryMaxAttempts ?? 5,
      "retryMaxAttempts",
      1,
      12,
    ),
    retryBaseMinutes: numberInRange(
      merged.retryBaseMinutes ?? 15,
      "retryBaseMinutes",
      1,
      1_440,
    ),
    madeForKids: merged.madeForKids === true,
  };
}

/**
 * SPEND GUARD for the automatic Casefile case-research opt-in, applied at
 * settings-write time.
 *
 * Enabling this flag makes `generation-scheduler` call `researchCase()` every
 * 6h for the channel, which spends real money (live Browserbase search
 * sessions + LLM verification calls) before `run-pipeline` even starts.
 * Casefile's current sealed route is private-review/manual only; no Program
 * Route currently admits recurring autonomous real-case research. Refuse an
 * enable request immediately rather than accepting a setting that the worker
 * must fail closed before every potential spend.
 *
 * Convex's `channels.updateChannel` enforces the same rule authoritatively
 * (it covers every write path, not just this route); this check exists so the
 * operator gets a 400 with an actionable message instead of a 500.
 *
 * Disabling (`enabled === false`) is always allowed, on any lane — an
 * operator must never be blocked from turning off spend.
 */
export function assertCasefileAutoResearchLaneEligible(
  _channel: { contentLane?: unknown; family?: unknown; pipeline?: unknown },
  enabled: boolean,
): void {
  if (!enabled) return;
  throw new SettingsValidationError(
    "automatic Casefile research cannot be enabled: no sealed channel Program Route currently " +
      "admits autonomous Casefile research. Use the private-review Casefile workflow instead.",
  );
}
