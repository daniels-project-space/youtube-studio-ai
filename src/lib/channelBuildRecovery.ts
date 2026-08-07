export interface PendingChannelBuildRequest {
  version: "channel-build-pending/v1";
  intent: string;
  requestKey: string;
  design: Record<string, unknown>;
  displayName: string;
  startedAt: number;
}

const REQUEST_KEY = /^[0-9a-f-]{36}_[a-f0-9]{64}$/;

export function parsePendingChannelBuildRequest(raw: string | null): PendingChannelBuildRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingChannelBuildRequest>;
    if (
      value.version !== "channel-build-pending/v1" ||
      typeof value.intent !== "string" ||
      !REQUEST_KEY.test(value.requestKey ?? "") ||
      !value.design ||
      typeof value.design !== "object" ||
      Array.isArray(value.design) ||
      typeof value.displayName !== "string" ||
      typeof value.startedAt !== "number" ||
      !Number.isFinite(value.startedAt) ||
      value.startedAt <= 0
    ) return null;
    return value as PendingChannelBuildRequest;
  } catch {
    return null;
  }
}

/** Reuse the same request identity for the exact canonical intent only. */
export function reusableChannelBuildRequestKey(
  intent: string,
  pending: PendingChannelBuildRequest | null,
): string | undefined {
  return pending?.intent === intent ? pending.requestKey : undefined;
}

/** Clear only when the server has definitively rejected this exact intent. */
export function shouldRetainPendingChannelBuild(status: number): boolean {
  return status !== 400 && status !== 409 && status !== 422;
}

export interface ChannelBuildSubmissionAttempt {
  requestKey: string;
  controller: AbortController;
}

/** One network submission per tab/request key, including React Strict Mode replays. */
export class ChannelBuildSubmissionGate {
  private active: ChannelBuildSubmissionAttempt | null = null;

  begin(requestKey: string): ChannelBuildSubmissionAttempt | null {
    if (this.active?.requestKey === requestKey) return null;
    this.abort();
    const attempt = { requestKey, controller: new AbortController() };
    this.active = attempt;
    return attempt;
  }

  finish(attempt: ChannelBuildSubmissionAttempt): void {
    if (this.active === attempt) this.active = null;
  }

  abort(): void {
    this.active?.controller.abort();
    this.active = null;
  }
}
