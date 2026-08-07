const DAY_MS = 86_400_000;

export type PlanReadiness = "ready" | "building" | "attention" | "queued";

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type ScheduleProjectionPolicy = {
  frequency?: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
};

export type OrderedSchedulePlanItem = {
  order: number;
  scheduledAt?: number;
};

export type ProjectedScheduleItem<T extends OrderedSchedulePlanItem> = {
  item: T;
  date: Date;
  timestamp?: number;
  timeZone: string;
  pinned: boolean;
  usesScheduleDefaults: boolean;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^(\d{2}):(\d{2})$/;

/** Unknown/legacy time zones fall back to the scheduler's canonical UTC zone. */
export function validTimeZone(value?: string): string {
  const zone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

export function formatZonedScheduleTimestamp(
  timestamp: number,
  timeZone?: string,
  options: { weekday?: boolean } = {},
): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: options.weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: validTimeZone(timeZone),
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

export function zonedDateParts(
  timestamp: number,
  timeZone?: string,
): ZonedDateParts | null {
  if (!Number.isFinite(timestamp)) return null;
  const zone = validTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  if (
    !Number.isInteger(values.year) ||
    !Number.isInteger(values.month) ||
    !Number.isInteger(values.day) ||
    !Number.isInteger(values.hour) ||
    !Number.isInteger(values.minute)
  ) {
    return null;
  }
  return values as ZonedDateParts;
}

export function isoDayForTimestamp(timestamp: number, timeZone?: string): string | null {
  const parts = zonedDateParts(timestamp, timeZone);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** A browser-local Date used only as a timezone-neutral civil calendar value. */
export function civilDateFromIsoDay(value: string): Date | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function civilDateForTimestamp(timestamp: number, timeZone?: string): Date | null {
  const isoDay = isoDayForTimestamp(timestamp, timeZone);
  return isoDay ? civilDateFromIsoDay(isoDay) : null;
}

export function civilDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function civilOrdinal(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

const CANONICAL_MONDAY = Date.UTC(1970, 0, 5);

/** One stable recurrence contract shared by the calendar and generation scheduler. */
export function isScheduledCivilDate(
  frequency: string,
  days: number[] | undefined,
  date: Date,
): boolean {
  const normalizedDays = [
    ...new Set((days ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
  ];
  const scheduledDays = normalizedDays.length
    ? new Set(normalizedDays)
    : frequency === "daily"
      ? null
      : new Set([1]);
  const weekday = date.getDay();

  if (frequency === "daily") return !scheduledDays || scheduledDays.has(weekday);
  if (!scheduledDays?.has(weekday)) return false;
  if (frequency === "biweekly") {
    const week = Math.floor((civilOrdinal(date) - CANONICAL_MONDAY) / (7 * DAY_MS));
    return ((week % 2) + 2) % 2 === 1;
  }
  if (frequency === "monthly") {
    for (let day = 1; day < date.getDate(); day += 1) {
      const prior = new Date(date.getFullYear(), date.getMonth(), day);
      if (scheduledDays.has(prior.getDay())) return false;
    }
  }
  return true;
}

/**
 * Projects channel cadence using civil-date arithmetic, so browser DST changes
 * cannot move an upload to the previous/next day.
 */
export function projectScheduleDates(
  frequency: string,
  days: number[] | undefined,
  count: number,
  from: Date,
): Date[] {
  const result: Date[] = [];
  const wanted = Math.max(0, Math.min(400, Math.floor(count)));
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  let guard = 0;

  while (result.length < wanted && guard++ < 1_500) {
    if (isScheduledCivilDate(frequency, days, cursor)) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * One projection path for every operator-facing schedule surface. Pinned dates
 * keep their stored epoch; unpinned queue rows are assigned cadence dates in
 * queue order using the same timezone/default contract as the scheduler.
 */
export function projectPlanSchedule<T extends OrderedSchedulePlanItem>({
  items,
  schedule,
  cadence,
  fromTimestamp,
}: {
  items: T[];
  schedule?: ScheduleProjectionPolicy;
  cadence?: string;
  fromTimestamp: number;
}): ProjectedScheduleItem<T>[] {
  const indexed = items.map((item, index) => ({ item, index }));
  const sorted = indexed.sort(
    (a, b) => a.item.order - b.item.order || a.index - b.index,
  );
  const configuredTimeZone = schedule?.timezone?.trim();
  const timeZone = validTimeZone(configuredTimeZone);
  const localTime = schedule?.localTime ?? "09:00";
  const fallbackNow = new Date(fromTimestamp);
  const channelToday = civilDateForTimestamp(fromTimestamp, timeZone) ?? new Date(
    fallbackNow.getFullYear(),
    fallbackNow.getMonth(),
    fallbackNow.getDate(),
  );
  const frequency = schedule?.frequency ?? cadence ?? "weekly";
  const projected = projectScheduleDates(
    frequency,
    schedule?.days,
    sorted.length,
    channelToday,
  );
  const usesScheduleDefaults =
    !configuredTimeZone || configuredTimeZone !== timeZone || !schedule?.localTime;

  return sorted.flatMap(({ item }, index) => {
    const pinnedDate = Number.isFinite(item.scheduledAt) && item.scheduledAt !== undefined
      ? civilDateForTimestamp(item.scheduledAt, timeZone)
      : null;
    const date = pinnedDate ?? projected[index];
    if (!date) return [];
    const projectedTimestamp = scheduledTimestampForDay(
      civilDayKey(date),
      localTime,
      timeZone,
    );
    return [{
      item,
      date,
      timestamp: pinnedDate ? item.scheduledAt : (projectedTimestamp ?? undefined),
      timeZone,
      pinned: Boolean(pinnedDate),
      usesScheduleDefaults,
    }];
  });
}

export function nextProjectedPlanItem<T extends OrderedSchedulePlanItem>(args: {
  items: T[];
  schedule?: ScheduleProjectionPolicy;
  cadence?: string;
  fromTimestamp: number;
}): ProjectedScheduleItem<T> | null {
  const projections = projectPlanSchedule(args);
  const timeZone = validTimeZone(args.schedule?.timezone);
  const today = civilDateForTimestamp(args.fromTimestamp, timeZone);
  const todayKey = today ? civilDayKey(today) : "";
  return projections
    .filter((projection) =>
      projection.timestamp !== undefined
        ? projection.timestamp >= args.fromTimestamp
        : civilDayKey(projection.date) >= todayKey,
    )
    .sort((a, b) => {
      if (a.timestamp !== undefined && b.timestamp !== undefined) {
        return a.timestamp - b.timestamp;
      }
      return a.date.getTime() - b.date.getTime();
    })[0] ?? null;
}

/**
 * Converts an operator-entered channel-local day/time to an exact epoch. The
 * final equality check rejects nonexistent DST wall times rather than silently
 * shifting a scheduled upload.
 */
export function scheduledTimestampForDay(
  isoDay: string,
  localTime = "09:00",
  timeZone = "UTC",
): number | null {
  const dayMatch = ISO_DAY.exec(isoDay);
  const timeMatch = CLOCK_TIME.exec(localTime);
  if (!dayMatch || !timeMatch) return null;

  const desired: ZonedDateParts = {
    year: Number(dayMatch[1]),
    month: Number(dayMatch[2]),
    day: Number(dayMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (desired.hour > 23 || desired.minute > 59 || !civilDateFromIsoDay(isoDay)) return null;

  const zone = validTimeZone(timeZone);
  const desiredUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let guess = desiredUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = zonedDateParts(guess, zone);
    if (!observed) return null;
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const delta = desiredUtc - observedUtc;
    if (delta === 0) break;
    guess += delta;
  }

  const final = zonedDateParts(guess, zone);
  if (!final || Object.keys(desired).some((key) => final[key as keyof ZonedDateParts] !== desired[key as keyof ZonedDateParts])) {
    return null;
  }
  return guess;
}

/** `ready` is only truthful when the required thumbnail artifact exists. */
export function planReadiness(status: string, thumbnailKey?: string | null): PlanReadiness {
  if (status === "failed") return "attention";
  if (status === "generating") return "building";
  if (status === "ready") return thumbnailKey?.trim() ? "ready" : "attention";
  return "queued";
}
