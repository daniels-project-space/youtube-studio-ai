"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChannelRow } from "./scheduleModel";
import { civilDayKey } from "@/lib/scheduleCalendar";
import styles from "./schedule.module.css";

type BulkStatus = "admitted" | "dispatched" | "running" | "succeeded" | "failed";
type ChildStatus = "pending" | "queued" | "running" | "succeeded" | "failed";

type BulkChild = {
  channelId: string;
  requestKey: string;
  count: number;
  status: ChildStatus;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

type BulkReceipt = {
  ok: true;
  fingerprint: string;
  status: BulkStatus;
  channelCount: number;
  totalItems: number;
  reservedCostUsd: number;
  progress: {
    pending: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    completed: number;
  };
  children: BulkChild[];
};

type BulkError = { ok?: false; error?: string };
type BulkQueueResponse = {
  ok: true;
  fingerprint: string;
  channelCount: number;
  totalItems: number;
  reservedCostUsd: number;
};

function statusLabel(status: BulkStatus | ChildStatus) {
  if (status === "succeeded") return "Complete";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "Rendering";
  if (status === "dispatched") return "Dispatched";
  if (status === "admitted") return "Admitted";
  return "Queued";
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => ({ error: "The planner returned an unreadable response." }));
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export function WeekBulkPlanner({
  channels,
  week,
  canEdit,
  onRequestOwner,
}: {
  channels: ChannelRow[];
  week: Date;
  canEdit: boolean;
  onRequestOwner: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [fingerprint, setFingerprint] = useState("");
  const [receipt, setReceipt] = useState<BulkReceipt | null>(null);
  const [error, setError] = useState("");
  const activeChannels = useMemo(
    () => channels.filter((channel) => channel.status === "active").slice(0, 12),
    [channels],
  );
  const weekKey = civilDayKey(week);
  const requestKey = `week-${weekKey}`;
  const completed = receipt?.progress.completed ?? 0;
  const total = receipt?.channelCount ?? activeChannels.length;
  const terminal = receipt?.status === "succeeded" || receipt?.status === "failed";
  const channelNames = useMemo(
    () => new Map(channels.map((channel) => [channel._id, channel.name])),
    [channels],
  );

  useEffect(() => {
    if (!fingerprint || terminal) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/plan-week/bulk?fingerprint=${encodeURIComponent(fingerprint)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await readJson(response) as BulkReceipt | BulkError;
        if (!response.ok || body.ok !== true) {
          throw new Error(errorMessage(body, "Could not read planner progress."));
        }
        setReceipt(body);
        setError("");
        if (body.status !== "succeeded" && body.status !== "failed") {
          timer = window.setTimeout(poll, 5_000);
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not read planner progress.");
        timer = window.setTimeout(poll, 8_000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [fingerprint, terminal]);

  async function queueWeek() {
    if (!canEdit) {
      onRequestOwner();
      return;
    }
    if (activeChannels.length === 0) {
      setError("No active channels are available for this week.");
      return;
    }
    setBusy(true);
    setError("");
    setReceipt(null);
    setFingerprint("");
    try {
      const response = await fetch("/api/plan-week/bulk", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          channelIds: activeChannels.map((channel) => channel._id),
          count,
          requestKey,
        }),
      });
      const body = await readJson(response) as BulkQueueResponse | BulkError;
      if (!response.ok || body.ok !== true) {
        throw new Error(errorMessage(body, "Could not queue the week plan."));
      }
      setFingerprint(body.fingerprint);
      setReceipt({
        ...body,
        ok: true,
        fingerprint: body.fingerprint,
        status: "admitted",
        progress: { pending: body.channelCount, queued: 0, running: 0, succeeded: 0, failed: 0, completed: 0 },
        children: [],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not queue the week plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={`${styles.bulkPlanner} glass`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={styles.bulkSummary}>
        <span className={styles.bulkSignal} aria-hidden="true" />
        <span>
          <strong>Batch-plan this week</strong>
          <small>{activeChannels.length ? `${activeChannels.length} active channels · one controlled handoff` : "No active channels"}</small>
        </span>
        <span className={styles.bulkSummaryStatus} data-status={receipt?.status ?? "idle"}>
          {receipt ? statusLabel(receipt.status) : "Ready"}
        </span>
      </summary>
      <div className={styles.bulkBody}>
        <div className={styles.bulkControls}>
          <label>
            <span>Items per channel</span>
            <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={busy || Boolean(fingerprint)}>
              {[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <div className={styles.bulkActionCopy}>
            <strong>{receipt ? `${completed}/${total} channels complete` : "Prepare the next seven days"}</strong>
            <span>{receipt ? `${receipt.totalItems} planned items · ${receipt.reservedCostUsd.toFixed(2)} USD reserved` : `Idempotent key ${requestKey}`}</span>
          </div>
          <button className={styles.bulkAction} type="button" onClick={() => void queueWeek()} disabled={busy || Boolean(fingerprint && !terminal)}>
            {!canEdit ? "Verify owner" : busy ? "Queueing…" : fingerprint && !terminal ? "In progress" : terminal ? "Run again" : "Queue week"}
          </button>
        </div>

        {(receipt || error) && (
          <div className={styles.bulkProgress} aria-live="polite">
            {receipt && (
              <>
                <div className={styles.bulkProgressTopline}>
                  <span>{statusLabel(receipt.status)}</span>
                  <strong>{completed} / {total}</strong>
                </div>
                <div className={styles.bulkProgressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={completed}>
                  <i style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
                </div>
                {receipt.children.length > 0 && (
                  <div className={styles.bulkChildren}>
                    {receipt.children.map((child) => (
                      <span className={styles.bulkChild} data-status={child.status} key={child.channelId} title={child.error ?? undefined}>
                        <i aria-hidden="true" />
                        {channelNames.get(child.channelId) ?? "Channel"}
                        <em>{statusLabel(child.status)}</em>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && <span className={styles.bulkError}>{error}</span>}
          </div>
        )}
      </div>
    </details>
  );
}
