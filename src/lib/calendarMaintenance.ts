export type CalendarSchedule = {
  frequency?: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
  enabled?: boolean;
  approvalMode?: "manual" | "private_auto";
  dailyQuota?: number;
  maxConcurrent?: number;
  retryMaxAttempts?: number;
  retryBaseMinutes?: number;
  madeForKids?: boolean;
};

export type MaterializedCalendarSchedule = CalendarSchedule & {
  frequency: string;
  timezone: string;
  localTime: string;
  enabled: boolean;
};

export type MaterializedScheduleDefaults = {
  changed: boolean;
  fields: Array<"frequency" | "days" | "timezone" | "localTime" | "enabled">;
  schedule: MaterializedCalendarSchedule;
};

const SUPPORTED_FREQUENCIES = new Set(["daily", "weekly", "biweekly", "monthly"]);

export const ORPHAN_READY_CANCELLATION_REASON =
  "Cancelled by operational calendar maintenance: channel no longer exists.";

export function orphanReadyRowsForMaintenance<T extends { channelId: unknown }>(
  readyRows: T[],
  channelIds: Iterable<unknown>,
): T[] {
  const existing = new Set([...channelIds].map(String));
  return readyRows.filter((row) => !existing.has(String(row.channelId)));
}

export function orphanReadyCancellationPatch() {
  return {
    status: "cancelled" as const,
    scheduledFailure: ORPHAN_READY_CANCELLATION_REASON,
  };
}

/**
 * Persist only behavior that was already implicit. In particular, a supported
 * identity cadence wins over the weekly fallback so this maintenance operation
 * cannot alter how often an existing channel runs.
 */
export function materializeCalendarScheduleDefaults(channel: {
  identity?: { cadence?: string };
  schedule?: CalendarSchedule;
}): MaterializedScheduleDefaults {
  const current = channel.schedule ?? {};
  const fields: MaterializedScheduleDefaults["fields"] = [];
  const storedFrequency = current.frequency?.trim();
  const identityCadence = channel.identity?.cadence?.trim();
  const frequency = storedFrequency || (
    identityCadence && SUPPORTED_FREQUENCIES.has(identityCadence)
      ? identityCadence
      : "weekly"
  );
  const timezone = current.timezone?.trim() || "UTC";
  const localTime = current.localTime?.trim() || "09:00";
  const enabled = current.enabled ?? true;
  const schedule: MaterializedCalendarSchedule = {
    ...current,
    frequency,
    timezone,
    localTime,
    enabled,
  };

  if (!storedFrequency) fields.push("frequency");
  if (!current.timezone?.trim()) fields.push("timezone");
  if (!current.localTime?.trim()) fields.push("localTime");
  if (current.enabled === undefined) fields.push("enabled");

  // Every non-daily recurrence currently defaults to Monday when days are
  // absent. Materializing [1] preserves that exact runtime behavior.
  if (frequency !== "daily" && !current.days?.length) {
    schedule.days = [1];
    fields.push("days");
  }

  return { changed: fields.length > 0, fields, schedule };
}
