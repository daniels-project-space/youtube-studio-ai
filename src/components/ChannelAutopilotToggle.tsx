"use client";

import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { channelScheduleWriteFence } from "@/lib/channelScheduleWriteFence";

export type ChannelSchedule = {
  frequency?: string;
  days?: number[];
  localTime?: string;
  timezone?: string;
  enabled?: boolean;
  approvalMode?: "manual" | "private_auto";
  dailyQuota?: number;
  maxConcurrent?: number;
  retryMaxAttempts?: number;
  retryBaseMinutes?: number;
  madeForKids?: boolean;
};

type Update = (args: {
  channelId: Id<"channels">;
  status: string;
  expectedScheduleFence?: string;
  schedule?: ChannelSchedule & { frequency: string };
}) => Promise<{ forked: false; state?: "channel_locked" | "module_locked"; blockId?: string }>;

export function ChannelAutopilotToggle({ id, active, schedule, update }: { id: string; active: boolean; schedule?: ChannelSchedule; update: Update }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setError(null);
    if (!active && !schedule) {
      setError("Set up a schedule before resuming autopilot.");
      return;
    }
    setBusy(true);
    try {
      const shouldEnableSchedule = !active && schedule?.enabled !== true;
      const result = await update({
        channelId: id as Id<"channels">,
        status: active ? "paused" : "active",
        ...(shouldEnableSchedule ? {
          expectedScheduleFence: channelScheduleWriteFence(schedule),
          schedule: { ...schedule, frequency: schedule?.frequency || "weekly", enabled: true },
        } : {}),
      });
      if (result.state === "channel_locked") throw new Error("This channel is locked. Unlock it before changing autopilot.");
      if (result.state === "module_locked") throw new Error(`Module '${result.blockId}' is locked.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update autopilot.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button onClick={toggle} disabled={busy} className="channel-account-action"
        title={active ? "Autopilot ON: builds and uploads privately on the channel's cadence. Click to pause." : "Paused: no auto-builds. Click to enable autopilot."}>
        {busy ? "Updating..." : active ? "Pause autopilot" : "Resume autopilot"}
      </button>
      {error ? <span role="alert" style={{ color: "var(--color-danger, #f08f8f)", fontSize: "0.8rem" }}>{error}</span> : null}
    </>
  );
}
