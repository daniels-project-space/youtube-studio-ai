"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SkeletonList } from "@/components/Skeleton";
import { useOwnerId } from "@/lib/owner-context";
import { civilDayKey, scheduledTimestampForDay } from "@/lib/scheduleCalendar";
import { CalendarPanel } from "./CalendarPanel";
import {
  ChannelScheduleEditor,
  channelScheduleEditorKey,
} from "./ChannelScheduleEditor";
import { DayByDaySchedule } from "./DayByDaySchedule";
import { ScheduleQueue } from "./ScheduleQueue";
import {
  CHANNEL_COLORS,
  buildCalendarModel,
  buildChannelColors,
  publishedTimestampRange,
  type CalendarEvent,
  type ChannelRow,
  type PlanItem,
  type PublishedVideo,
} from "./scheduleModel";
import styles from "./schedule.module.css";

type Notice = { tone: "ok" | "error"; text: string };
type PublishedHistoryPage = { items: PublishedVideo[]; truncated: boolean };
type ScheduleView = "week" | "month" | "cadence";

export default function SchedulePage() {
  const ownerId = useOwnerId();
  const [offset, setOffset] = useState(0);
  const [scope, setScope] = useState("all");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("week");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [todayMs] = useState(() => Date.now());
  const reschedule = useMutation(api.contentPlan.setScheduledAt);

  const now = new Date(todayMs);
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gridStart = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay());
  const cells = Array.from(
    { length: 42 },
    (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index),
  );
  const weekCells = Array.from(
    { length: 7 },
    (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + index),
  );
  // A six-row month grid can end one day before the seven-day board when the
  // month starts late in the week. Include the explicit week dates so the last
  // day never silently loses a real scheduled/published upload.
  const publishedRange = publishedTimestampRange(
    scheduleView === "week"
      ? [...cells, ...weekCells].sort((left, right) => left.getTime() - right.getTime())
      : cells,
  );

  const plan = useQuery(api.contentPlan.listPlanByOwner, { ownerId }) as PlanItem[] | undefined;
  const channels = useQuery(api.channels.listChannels, { ownerId }) as ChannelRow[] | undefined;
  const channelById = useMemo(
    () => new Map((channels ?? []).map((channel) => [channel._id, channel])),
    [channels],
  );
  const channelColors = useMemo(() => buildChannelColors(channels ?? []), [channels]);
  const effectiveScope = scope === "all" || channelById.has(scope) ? scope : "all";
  const publishedHistory = useQuery(api.publishIntents.listPublishedCalendarRange, {
    ownerId,
    ...(effectiveScope === "all" ? {} : { channelId: effectiveScope as Id<"channels"> }),
    ...publishedRange,
    limit: 800,
  }) as PublishedHistoryPage | undefined;
  const visibleChannels = useMemo(
    () =>
      (channels ?? [])
        .filter((channel) => effectiveScope === "all" || channel._id === effectiveScope)
        .sort((a, b) => {
          const activeDelta = Number(b.status === "active") - Number(a.status === "active");
          return activeDelta || a.name.localeCompare(b.name);
        }),
    [channels, effectiveScope],
  );
  const calendar = useMemo(
    () => buildCalendarModel({
      plan: plan ?? [],
      publishedVideos: publishedHistory?.items ?? [],
      channelById,
      channelColors,
      scope: effectiveScope,
      todayMs,
    }),
    [channelById, channelColors, effectiveScope, plan, publishedHistory, todayMs],
  );

  const plannedEvents = calendar.flat.filter((event) => event.type === "planned");
  const upcoming = plannedEvents
    .filter((event) => event.date.getTime() >= today.getTime())
    .sort((a, b) => (a.timestamp ?? a.date.getTime()) - (b.timestamp ?? b.date.getTime()))
    .slice(0, 12);
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).getTime();
  const summary = {
    ready: plannedEvents.filter((event) => event.readiness === "ready").length,
    attention: plannedEvents.filter((event) => event.readiness === "attention").length,
    pinned: plannedEvents.filter((event) => event.pinned).length,
    nextSevenDays: calendar.flat.filter((event) => {
      const timestamp = event.date.getTime();
      return timestamp >= today.getTime() && timestamp < weekEnd;
    }).length,
  };
  const rhythm = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
    const dayEvents = calendar.flat.filter((event) => civilDayKey(event.date) === civilDayKey(date));
    return {
      date,
      count: dayEvents.length,
      attention: dayEvents.some((event) => event.readiness === "attention"),
      ready: dayEvents.filter((event) => event.readiness === "ready").length,
    };
  });
  const rhythmPeak = Math.max(1, ...rhythm.map((day) => day.count));
  const nextEvent = upcoming[0];
  const scopeName = effectiveScope === "all"
    ? "Fleet"
    : channelById.get(effectiveScope)?.name ?? "Channel";
  const loading = plan === undefined || publishedHistory === undefined || channels === undefined;

  const pinEvent = async (event: CalendarEvent, isoDay: string) => {
    if (!event.id) return;
    const channel = channelById.get(event.channelId);
    const localTime = channel?.schedule?.localTime ?? "09:00";
    const timeZone = channel?.schedule?.timezone ?? "UTC";
    const timestamp = scheduledTimestampForDay(isoDay, localTime, timeZone);
    if (timestamp === null) {
      setNotice({
        tone: "error",
        text: `That local time does not exist in ${timeZone} on ${isoDay}. Choose another day or update the channel time.`,
      });
      return;
    }
    try {
      await reschedule({ id: event.id as Id<"contentPlan">, scheduledAt: timestamp });
      setNotice({ tone: "ok", text: `${event.title} pinned to ${isoDay} at ${localTime} ${timeZone}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not update that date." });
    }
  };

  const unpinEvent = async (event: CalendarEvent) => {
    if (!event.id) return;
    try {
      await reschedule({ id: event.id as Id<"contentPlan">, scheduledAt: null });
      setNotice({ tone: "ok", text: `${event.title} is back on its channel cadence.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not unpin that item." });
    }
  };

  return (
    <>
      <section
        className={styles.scheduleHero}
        aria-label="Calendar scope and summary"
        aria-busy={loading}
      >
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Release clock / {scopeName}</span>
            <h1>Shape the week before production shapes it for you.</h1>
            <p>
              See the fleet&apos;s publishing rhythm, protect ready work from collisions,
              and pin exceptions without losing each channel&apos;s local cadence.
            </p>
            <div className={styles.nextRelease} data-empty={!nextEvent || undefined}>
              <span className={styles.nextReleaseSignal} aria-hidden="true"><i /></span>
              <span>
                <small>{loading ? "Reading release ledger" : nextEvent ? "Next handoff" : "Runway clear"}</small>
                <strong>{loading ? "Binding schedules…" : nextEvent?.title ?? "No planned release in this scope"}</strong>
                <em>
                  {nextEvent
                    ? `${nextEvent.channel} · ${nextEvent.pinned ? "pinned" : "cadence projected"}`
                    : "Build the next episode from a channel room."}
                </em>
              </span>
            </div>
          </div>

          <div className={styles.rhythmPanel} aria-label="Fourteen day release rhythm">
            <div className={styles.rhythmHeader}>
              <span>14-day release signal</span>
              <small>{loading ? "—" : `${rhythm.reduce((sum, day) => sum + day.count, 0)} handoffs`}</small>
            </div>
            <div className={styles.rhythmPlot}>
              {rhythm.map((day, index) => (
                <span
                  className={styles.rhythmDay}
                  data-today={index === 0 || undefined}
                  data-attention={day.attention || undefined}
                  key={civilDayKey(day.date)}
                  title={`${day.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${day.count} release${day.count === 1 ? "" : "s"}, ${day.ready} ready`}
                >
                  <i
                    style={{ "--rhythm-height": `${Math.max(day.count ? 18 : 3, (day.count / rhythmPeak) * 100)}%` } as CSSProperties}
                  />
                  <small>{day.date.toLocaleDateString("en-GB", { weekday: "narrow" })}</small>
                  <em>{day.date.getDate()}</em>
                </span>
              ))}
            </div>
            <div className={styles.rhythmLegend}>
              <span><i data-tone="ready" /> Ready runway</span>
              <span><i data-tone="attention" /> Needs intervention</span>
              <span>Height = releases per day</span>
            </div>
          </div>
        </div>

        <div className={styles.heroControls}>
          <label className={styles.scopeControl}>
            <span>Calendar scope</span>
            <select
              className={styles.scopeSelect}
              value={effectiveScope}
              onChange={(event) => setScope(event.target.value)}
              aria-label="Filter calendar by channel"
              disabled={loading}
            >
              <option value="all">All channels</option>
              {(channels ?? []).map((channel) => <option key={channel._id} value={channel._id}>{channel.name}</option>)}
            </select>
          </label>

          <nav className={styles.viewTabs} aria-label="Schedule view" role="tablist">
            {([
              ["week", "Seven-day board"],
              ["month", "Month map"],
              ["cadence", "Cadence controls"],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                role="tab"
                data-active={scheduleView === value}
                aria-selected={scheduleView === value}
                onClick={() => {
                  setScheduleView(value);
                  if (value !== "month") setOffset(0);
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={styles.metrics}>
            <Metric value={loading ? "—" : summary.nextSevenDays} label="7-day handoffs" />
            <Metric value={loading ? "—" : summary.ready} label="Ready" tone={loading ? undefined : "ok"} />
            <Metric value={loading ? "—" : summary.pinned} label="Pinned" />
            <Metric
              value={loading ? "—" : summary.attention}
              label="Intervene"
              tone={!loading && summary.attention ? "warn" : undefined}
            />
          </div>
        </div>
      </section>

      {notice && (
        <div className={notice.tone === "error" ? styles.noticeError : styles.noticeOk} role="status">
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      {publishedHistory?.truncated && (
        <div className={styles.historyNotice} role="status">
          This calendar page has more than 800 published uploads. Only the first 800 are shown; narrow to one channel for a smaller complete view.
        </div>
      )}

      {!loading && calendar.excluded.total > 0 && (
        <div className={styles.exclusionNotice} role="status">
          <strong>{calendar.excluded.total} queue item{calendar.excluded.total === 1 ? "" : "s"} excluded from the operational calendar.</strong>
          <span>
            {calendar.excluded.labels.join(" · ")}. These items cannot run in the current channel state and are not counted as upcoming.
          </span>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingState} aria-live="polite">
          <span>Connecting to live channel, plan and publishing data…</span>
          <SkeletonList rows={5} />
        </div>
      ) : (
        <>
          {scheduleView === "week" && (
            <>
              <DayByDaySchedule events={calendar.flat} today={today} />
              <details className={`${styles.queueDisclosure} glass`}>
                <summary>
                  <span>Manage exact dates</span>
                  <small>{upcoming.length} upcoming</small>
                </summary>
                <div className={styles.queueDisclosureBody}>
                  <ScheduleQueue events={upcoming} onPin={pinEvent} onUnpin={unpinEvent} />
                </div>
              </details>
            </>
          )}
          {scheduleView === "month" && (
            <CalendarPanel
              view={view}
              today={today}
              cells={cells}
              calendar={calendar}
              channels={visibleChannels}
              channelColors={channelColors}
              scope={effectiveScope}
              onScope={setScope}
              onPrevious={() => setOffset((value) => value - 1)}
              onToday={() => setOffset(0)}
              onNext={() => setOffset((value) => value + 1)}
              onPin={pinEvent}
            />
          )}
          {scheduleView === "cadence" && (
            <section className={styles.section} aria-labelledby="channel-schedules-title">
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>Channel settings</span>
                  <h2 id="channel-schedules-title">Upload cadence</h2>
                </div>
                <span>Changes save once per channel</span>
              </div>
              {visibleChannels.length === 0 ? (
                <div className={`${styles.emptyState} glass`}>No channels are available in this scope.</div>
              ) : (
                <div className={styles.scheduleGrid}>
                  {visibleChannels.map((channel) => (
                    <ChannelScheduleEditor
                      key={channelScheduleEditorKey(channel)}
                      channel={channel}
                      color={channelColors.get(channel._id) ?? CHANNEL_COLORS[0]}
                    />
                  ))}
                </div>
              )}
              <TimeZoneSuggestions />
            </section>
          )}
        </>
      )}
    </>
  );
}

function Metric({ value, label, tone }: { value: number | string; label: string; tone?: "ok" | "warn" }) {
  return <div className={styles.metric} data-tone={tone}><strong>{value}</strong><span>{label}</span></div>;
}

function TimeZoneSuggestions() {
  return (
    <datalist id="studio-timezones">
      {[
        "UTC", "Europe/London", "Europe/Berlin", "America/New_York",
        "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
        "Australia/Sydney",
      ].map((zone) => <option key={zone} value={zone} />)}
    </datalist>
  );
}
