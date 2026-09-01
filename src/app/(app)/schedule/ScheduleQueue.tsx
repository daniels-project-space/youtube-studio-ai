"use client";

import Link from "next/link";
import { useAssetUrl } from "@/lib/asset-url";
import {
  civilDayKey,
  formatZonedScheduleTimestamp,
  type PlanReadiness,
} from "@/lib/scheduleCalendar";
import {
  DOW,
  MONTHS,
  channelHref,
  eventStatusLabel,
  type CalendarEvent,
} from "./scheduleModel";
import styles from "./schedule.module.css";

export function ScheduleQueue({
  events,
  onPin,
  onUnpin,
}: {
  events: CalendarEvent[];
  onPin: (event: CalendarEvent, isoDay: string) => Promise<void>;
  onUnpin: (event: CalendarEvent) => Promise<void>;
}) {
  return (
    <section className={styles.section} aria-labelledby="next-up-title">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Production queue</span>
          <h2 id="next-up-title">Next up</h2>
        </div>
        <span>{events.length} upcoming item{events.length === 1 ? "" : "s"}</span>
      </div>
      {events.length === 0 ? (
        <div className={`${styles.emptyState} glass`}>
          <strong>No planned videos in this scope</strong>
          <span>Open a channel&apos;s Week ahead view to build its real content queue.</span>
        </div>
      ) : (
        <div className={styles.upcomingList}>
          {events.map((event) => (
            <UpcomingCard
              key={event.key}
              event={event}
              onPin={onPin}
              onUnpin={onUnpin}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingCard({
  event,
  onPin,
  onUnpin,
}: {
  event: CalendarEvent;
  onPin: (event: CalendarEvent, isoDay: string) => Promise<void>;
  onUnpin: (event: CalendarEvent) => Promise<void>;
}) {
  const dateKey = civilDayKey(event.date);
  const exactTime = event.timestamp === undefined
    ? null
    : formatZonedScheduleTimestamp(event.timestamp, event.timeZone);
  return (
    <article className={`${styles.upcomingCard} glass`} style={{ borderLeftColor: event.color }}>
      <PlanThumbnail title={event.title} thumbnailKey={event.thumbnailKey} readiness={event.readiness} />
      <div className={styles.dateBlock}>
        <span>{MONTHS[event.date.getMonth()].slice(0, 3)}</span>
        <strong>{event.date.getDate()}</strong>
        <small>{DOW[event.date.getDay()]}</small>
      </div>
      <div className={styles.upcomingCopy}>
        <div className={styles.upcomingTopline}>
          <span className={styles.readinessBadge} data-tone={event.readiness}>{eventStatusLabel(event)}</span>
          <span>
            {event.pinned ? "Pinned" : "Projected"} · {exactTime ?? "Time unavailable"}
            {event.usesScheduleDefaults ? " · scheduler default" : ""}
          </span>
        </div>
        <h3>{event.title}</h3>
        <div className={styles.itemLinks}>
          <span style={{ color: event.color }}>{event.channel}</span>
          <Link href={channelHref(event.slug, "week-ahead", event.id)}>Open item ↗</Link>
          <Link href={channelHref(event.slug, "settings")}>Channel settings</Link>
        </div>
      </div>
      <div className={styles.dateActions}>
        <label>
          <span>Publish date</span>
          <input
            type="date"
            value={dateKey}
            onChange={(changeEvent) => {
              if (changeEvent.target.value) void onPin(event, changeEvent.target.value);
            }}
          />
        </label>
        {event.pinned && <button type="button" onClick={() => void onUnpin(event)}>Use cadence</button>}
      </div>
    </article>
  );
}

function PlanThumbnail({
  title,
  thumbnailKey,
  readiness,
}: {
  title: string;
  thumbnailKey?: string | null;
  readiness: PlanReadiness | "published";
}) {
  const url = useAssetUrl(thumbnailKey);
  return (
    <div className={styles.planThumbnail} data-tone={readiness}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${title} thumbnail`} loading="lazy" />
      ) : (
        <span>{readiness === "building" ? "Rendering" : readiness === "attention" ? "Asset needed" : "Queued"}</span>
      )}
    </div>
  );
}
