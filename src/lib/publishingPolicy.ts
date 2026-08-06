export const YOUTUBE_UPLOAD_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
] as const;
export const YOUTUBE_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

export const YOUTUBE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

export type PublishIntentStatus =
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "dispatching"
  | "retry_wait"
  | "uploaded"
  | "dead_letter"
  | "cancelled"
  | "blocked_connector";

export interface ChannelSchedulePolicy {
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
}

export interface PublishClaimInput {
  now: number;
  intent: {
    ownerId: string;
    channelId: string;
    connectorId: string;
    connectorVersion: number;
    status: PublishIntentStatus;
    nextAttemptAt: number;
    leaseExpiresAt?: number;
  };
  connector: {
    connectorId: string;
    ownerId: string;
    channelId: string;
    tokenVersion: number;
    status: "active" | "revoked" | "error";
    grantedScopes: readonly string[];
  };
  activeDispatches: number;
  uploadsToday: number;
  schedule?: ChannelSchedulePolicy;
}

export type PublishClaimDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "tenant_mismatch"
        | "connector_mismatch"
        | "connector_version_changed"
        | "connector_inactive"
        | "upload_scope_missing"
        | "not_dispatchable"
        | "not_due"
        | "lease_active"
        | "channel_concurrency"
        | "daily_quota";
    terminal: boolean;
  };

export function hasAnyScope(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const granted = new Set(grantedScopes);
  return requiredScopes.some((scope) => granted.has(scope));
}

export function evaluatePublishClaim(input: PublishClaimInput): PublishClaimDecision {
  const { intent, connector, now } = input;
  if (
    intent.ownerId !== connector.ownerId ||
    intent.channelId !== connector.channelId
  ) {
    return { ok: false, reason: "tenant_mismatch", terminal: true };
  }
  if (intent.connectorId !== connector.connectorId) {
    return { ok: false, reason: "connector_mismatch", terminal: true };
  }
  if (intent.connectorVersion !== connector.tokenVersion) {
    return { ok: false, reason: "connector_version_changed", terminal: true };
  }
  if (connector.status !== "active") {
    return { ok: false, reason: "connector_inactive", terminal: true };
  }
  if (!hasAnyScope(connector.grantedScopes, YOUTUBE_UPLOAD_SCOPES)) {
    return { ok: false, reason: "upload_scope_missing", terminal: true };
  }
  if (
    intent.status === "dispatching" &&
    intent.leaseExpiresAt !== undefined &&
    intent.leaseExpiresAt > now
  ) {
    return { ok: false, reason: "lease_active", terminal: false };
  }

  const dispatchable =
    intent.status === "approved" ||
    intent.status === "scheduled" ||
    intent.status === "retry_wait" ||
    (intent.status === "dispatching" && (intent.leaseExpiresAt ?? 0) <= now);
  if (!dispatchable) {
    return { ok: false, reason: "not_dispatchable", terminal: false };
  }
  if (intent.nextAttemptAt > now) {
    return { ok: false, reason: "not_due", terminal: false };
  }
  const maxConcurrent = boundedInt(input.schedule?.maxConcurrent, 1, 1, 3);
  if (input.activeDispatches >= maxConcurrent) {
    return { ok: false, reason: "channel_concurrency", terminal: false };
  }
  const dailyQuota = boundedInt(input.schedule?.dailyQuota, 3, 1, 25);
  if (input.uploadsToday >= dailyQuota) {
    return { ok: false, reason: "daily_quota", terminal: false };
  }
  return { ok: true };
}

export function boundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value!)));
}

export function retryAt(
  now: number,
  attempt: number,
  baseMinutes: number | undefined,
): number {
  const base = boundedInt(baseMinutes, 15, 1, 12 * 60);
  const exponent = Math.max(0, Math.min(8, attempt - 1));
  return now + Math.min(24 * 60, base * 2 ** exponent) * 60_000;
}

export function localDateKey(now: number, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`unable to resolve local date in timezone ${timezone}`);
  }
  return key;
}

function localClock(now: number, timezone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    value("weekday"),
  );
  return {
    weekday,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function isGenerationDue(args: {
  now: number;
  lastStartedAt: number;
  schedule?: ChannelSchedulePolicy;
  cadence?: string;
}): boolean {
  const schedule = args.schedule;
  if (schedule?.enabled === false) return false;
  const timezone = schedule?.timezone ?? "UTC";
  const localTime = schedule?.localTime ?? "09:00";
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`invalid channel schedule localTime: ${localTime}`);
  }
  const clock = localClock(args.now, timezone);
  const scheduledMinutes = Number(match[1]) * 60 + Number(match[2]);
  if (clock.minutes < scheduledMinutes) return false;
  if (schedule?.days?.length && !schedule.days.includes(clock.weekday)) return false;
  if (!args.lastStartedAt) return true;
  if (localDateKey(args.lastStartedAt, timezone) === localDateKey(args.now, timezone)) {
    return false;
  }
  const frequency = schedule?.frequency ?? args.cadence ?? "weekly";
  const intervalDays =
    frequency === "daily" ? 1 : frequency === "biweekly" ? 14 : frequency === "monthly" ? 28 : 7;
  return args.now - args.lastStartedAt >= (intervalDays - 0.25) * 86_400_000;
}

export function buildPublishIdempotencyKey(args: {
  connectorId: string;
  videoArtifactId: string;
  intentVersion: number;
}): string {
  if (
    !args.connectorId ||
    !args.videoArtifactId ||
    !Number.isSafeInteger(args.intentVersion) ||
    args.intentVersion < 1
  ) {
    throw new Error("invalid publish idempotency components");
  }
  return `${args.connectorId}:${args.videoArtifactId}:v${args.intentVersion}`;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}
