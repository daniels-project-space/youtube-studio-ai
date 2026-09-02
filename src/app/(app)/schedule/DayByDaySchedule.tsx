import Link from "next/link";
import { youtubeThumb } from "@/lib/asset-url";
import { MediaPreview } from "@/components/MediaPreview";
import { civilDayKey } from "@/lib/scheduleCalendar";
import {
  channelHref,
  eventStatusLabel,
  type CalendarEvent,
} from "./scheduleModel";
import styles from "./schedule.module.css";

function eventTime(event: CalendarEvent) {
  if (!event.timestamp) return "Cadence time";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: event.timeZone,
      timeZoneName: "short",
    }).format(new Date(event.timestamp));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(event.timestamp));
  }
}

export function DayByDaySchedule({
  events,
  today,
}: {
  events: CalendarEvent[];
  today: Date;
}) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
    const key = civilDayKey(date);
    return {
      date,
      key,
      events: events
        .filter((event) => civilDayKey(event.date) === key)
        .sort((a, b) => (a.timestamp ?? a.date.getTime()) - (b.timestamp ?? b.date.getTime())),
    };
  });

  return (
    <section className={styles.section} aria-labelledby="day-by-day-title">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Next seven days</span>
          <h2 id="day-by-day-title">Day by day</h2>
        </div>
        <span>Exact channel-local publishing times</span>
      </div>

      <div className={styles.weekBoard}>
        {days.map(({ date, key, events: dayEvents }, index) => (
          <article className={styles.dayColumn} data-today={index === 0} key={key}>
            <header className={styles.dayColumnHeader}>
              <div>
                <span>{index === 0 ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                <strong>{date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</strong>
              </div>
              <small>{dayEvents.length || "—"}</small>
            </header>

            <div className={styles.dayColumnEvents}>
              {dayEvents.length === 0 ? (
                <span className={styles.dayEmpty}>No releases</span>
              ) : dayEvents.map((event) => <DayEventCard event={event} key={event.key} />)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Preview the exact persisted plan or published-video artwork in the default
 * operational board, rather than making an operator open the hidden queue just
 * to see what is actually scheduled. */
function DayEventCard({ event }: { event: CalendarEvent }) {
  return (
    <Link
      className={styles.dayEvent}
      href={channelHref(
        event.slug,
        event.type === "planned" ? "week-ahead" : undefined,
        event.type === "planned" ? event.id : undefined,
      )}
      style={{ borderLeftColor: event.color }}
    >
      {event.thumbnailSource === "rendered_video_frame" ? (
        <div className={styles.dayEventFramePending} aria-label="Cover will use the final rendered video frame">
          <span>Final frame</span>
        </div>
      ) : (
        <MediaPreview
          className={styles.dayEventMedia}
          dataTone={event.readiness}
          assetKey={event.thumbnailKey}
          fallbackSrc={event.youtubeVideoId ? youtubeThumb(event.youtubeVideoId) : undefined}
          fallbackSource="youtube"
          alt=""
          aspectRatio="16 / 9"
          unavailableLabel="Preview unavailable"
        />
      )}
      <span className={styles.dayEventCopy}>
        <span className={styles.dayEventTime}>{eventTime(event)}</span>
        <strong>{event.title}</strong>
        <span className={styles.dayEventMeta}>
          <span>{event.channel}</span>
          <span className={styles.readinessBadge} data-tone={event.readiness}>
            {eventStatusLabel(event)}
          </span>
        </span>
      </span>
    </Link>
  );
}
