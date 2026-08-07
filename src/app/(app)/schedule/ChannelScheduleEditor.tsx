"use client";

import Link from "next/link";
import { useState } from "react";
import { ChannelAvatar } from "@/components/ChannelArt";
import {
  DOW,
  channelHref,
  frequencyLabel,
  type ChannelRow,
} from "./scheduleModel";
import styles from "./schedule.module.css";

type Notice = { tone: "ok" | "error"; text: string };
type DraftSchedule = {
  frequency: string;
  days: number[];
  timezone: string;
  localTime: string;
  enabled: boolean;
};

export function channelScheduleEditorKey(channel: ChannelRow): string {
  return [
    channel._id,
    channel.schedule?.frequency,
    channel.schedule?.days?.join(","),
    channel.schedule?.timezone,
    channel.schedule?.localTime,
    channel.schedule?.enabled,
  ].join(":");
}

function scheduleDraft(channel: ChannelRow): DraftSchedule {
  const frequency = ["daily", "weekly", "biweekly", "monthly"].includes(channel.schedule?.frequency ?? "")
    ? channel.schedule!.frequency
    : ["daily", "weekly", "biweekly", "monthly"].includes(channel.identity?.cadence ?? "")
      ? channel.identity!.cadence!
      : "weekly";
  return {
    frequency,
    days: channel.schedule?.days?.length
      ? channel.schedule.days
      : frequency === "weekly" || frequency === "biweekly"
        ? [1]
        : [],
    timezone: channel.schedule?.timezone ?? "UTC",
    localTime: channel.schedule?.localTime ?? "09:00",
    enabled: channel.schedule?.enabled !== false,
  };
}

export function ChannelScheduleEditor({ channel, color }: { channel: ChannelRow; color: string }) {
  const [draft, setDraft] = useState<DraftSchedule>(() => scheduleDraft(channel));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const usesTimeDefaults = !channel.schedule?.timezone || !channel.schedule?.localTime;
  const usesDays = draft.frequency === "weekly" || draft.frequency === "biweekly";

  const update = (patch: Partial<DraftSchedule>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/channel-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "schedule",
          channelId: channel._id,
          schedule: {
            frequency: draft.frequency,
            days: usesDays ? (draft.days.length ? draft.days : [1]) : undefined,
            timezone: draft.timezone.trim(),
            localTime: draft.localTime,
            enabled: draft.enabled,
          },
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Schedule update failed");
      setDirty(false);
      setMessage({ tone: "ok", text: "Schedule saved" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Schedule update failed" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`${styles.scheduleCard} glass`} style={{ borderTopColor: color }}>
      <div className={styles.scheduleCardHeader}>
        <div className={styles.channelIdentity}>
          <ChannelAvatar
            imageKey={channel.identity?.imageKey}
            name={channel.name}
            palette={channel.identity?.palette}
            size={34}
            radius={10}
          />
          <div>
            <Link href={channelHref(channel.slug)}>{channel.name}</Link>
            <span>{channel.status} · {draft.enabled ? "calendar active" : "calendar paused"}</span>
          </div>
        </div>
        <div className={styles.itemLinks}>
          <Link href={channelHref(channel.slug, "week-ahead")}>Week ahead</Link>
          <Link href={channelHref(channel.slug, "settings")}>Settings</Link>
        </div>
      </div>

      <div className={styles.scheduleFields}>
        <label>
          <span>Frequency</span>
          <select
            value={draft.frequency}
            onChange={(event) => {
              const frequency = event.target.value;
              update({
                frequency,
                days: (frequency === "weekly" || frequency === "biweekly") && !draft.days.length ? [1] : draft.days,
              });
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>
          <span>Local publish time</span>
          <input type="time" value={draft.localTime} onChange={(event) => update({ localTime: event.target.value })} />
        </label>
        <label>
          <span>Time zone</span>
          <input
            value={draft.timezone}
            list="studio-timezones"
            spellCheck={false}
            onChange={(event) => update({ timezone: event.target.value })}
            placeholder="UTC"
          />
        </label>
      </div>

      {usesTimeDefaults && (
        <div className={styles.defaultNotice}>
          Time is inherited from scheduler defaults (09:00 UTC). Save this card to persist explicit channel-local values.
        </div>
      )}

      {usesDays && (
        <div className={styles.weekdayPicker} aria-label={`${channel.name} upload weekdays`}>
          {DOW.map((label, day) => {
            const selected = draft.days.includes(day);
            return (
              <button
                type="button"
                key={label}
                data-selected={selected}
                onClick={() => {
                  const days = selected
                    ? draft.days.length === 1
                      ? draft.days
                      : draft.days.filter((value) => value !== day)
                    : [...draft.days, day].sort((a, b) => a - b);
                  update({ days });
                }}
                aria-pressed={selected}
              >
                {label.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.scheduleFooter}>
        <label className={styles.enabledToggle}>
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          Use this cadence for automation
        </label>
        <span className={message?.tone === "error" ? styles.saveError : styles.saveMessage} role="status">
          {message?.text ?? `${frequencyLabel(draft.frequency)} · ${draft.localTime} ${draft.timezone}${usesTimeDefaults ? " · defaults" : ""}`}
        </span>
        <button type="button" className={styles.saveButton} disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : dirty ? "Save schedule" : "Saved"}
        </button>
      </div>
    </article>
  );
}
