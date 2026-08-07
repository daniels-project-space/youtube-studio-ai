"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconChevron } from "@/components/icons";
import { civilDayKey, type PlanReadiness } from "@/lib/scheduleCalendar";
import {
  DOW,
  MONTHS,
  channelHref,
  eventStatusLabel,
  type CalendarEvent,
  type CalendarModel,
  type ChannelRow,
} from "./scheduleModel";
import styles from "./schedule.module.css";

export function CalendarPanel({
  view,
  today,
  cells,
  calendar,
  channels,
  channelColors,
  scope,
  onScope,
  onPrevious,
  onToday,
  onNext,
  onPin,
}: {
  view: Date;
  today: Date;
  cells: Date[];
  calendar: CalendarModel;
  channels: ChannelRow[];
  channelColors: Map<string, string>;
  scope: string;
  onScope: (scope: string) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onPin: (event: CalendarEvent, isoDay: string) => Promise<void>;
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  return (
    <section className={`${styles.calendarPanel} glass`} aria-label={`${MONTHS[view.getMonth()]} ${view.getFullYear()} calendar`}>
      <div className={styles.calendarHeader}>
        <div>
          <span className={styles.eyebrow}>Month view</span>
          <h2>{MONTHS[view.getMonth()]} {view.getFullYear()}</h2>
        </div>
        <div className={styles.monthNav}>
          <NavButton onClick={onPrevious} label="Previous month" flip><IconChevron width={16} height={16} /></NavButton>
          <button type="button" className={styles.todayButton} onClick={onToday}>Today</button>
          <NavButton onClick={onNext} label="Next month"><IconChevron width={16} height={16} /></NavButton>
        </div>
      </div>

      <div className={styles.statusLegend} aria-label="Calendar status legend">
        <LegendDot tone="ready" label="Ready" />
        <LegendDot tone="building" label="Building" />
        <LegendDot tone="attention" label="Needs attention" />
        <LegendDot tone="published" label="Published" />
        <span className={styles.legendHint}>Dashed edge = projected · solid edge = pinned</span>
      </div>

      <div className={styles.channelLegend} aria-label="Channel color legend">
        {channels.map((channel) => (
          <button
            type="button"
            key={channel._id}
            className={scope === channel._id ? styles.channelLegendActive : styles.channelLegendItem}
            onClick={() => onScope(channel._id)}
            title={`Show only ${channel.name}`}
          >
            <span style={{ background: channelColors.get(channel._id) }} />
            {channel.name}
          </button>
        ))}
        {scope !== "all" && (
          <button type="button" className={styles.showAllButton} onClick={() => onScope("all")}>Show all channels</button>
        )}
      </div>

      <div className={styles.calendarViewport} tabIndex={0} aria-label="Scrollable calendar grid">
        <div className={styles.calendarGrid}>
          {DOW.map((day) => <div key={day} className={styles.weekday}>{day}</div>)}
          {cells.map((date) => {
            const key = civilDayKey(date);
            const inMonth = date.getMonth() === view.getMonth();
            const isToday = key === civilDayKey(today);
            const events = calendar.byDay.get(key) ?? [];
            const expanded = expandedDay === key;
            const visibleEvents = expanded ? events : events.slice(0, 3);
            return (
              <div
                key={key}
                className={`${styles.dayCell} ${inMonth ? "" : styles.outsideMonth} ${isToday ? styles.today : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(dropEvent) => {
                  dropEvent.preventDefault();
                  const id = dropEvent.dataTransfer.getData("text/plan-id");
                  const item = calendar.flat.find((event) => event.id === id);
                  if (item) void onPin(item, key);
                }}
              >
                <div className={styles.dayNumber}>
                  <time dateTime={key}>{date.getDate()}</time>
                  {isToday && <span>Today</span>}
                </div>
                <div className={styles.dayEvents}>
                  {visibleEvents.map((event) => <CalendarChip key={event.key} event={event} />)}
                  {events.length > 3 && (
                    <button
                      type="button"
                      className={styles.moreEvents}
                      aria-expanded={expanded}
                      onClick={() => setExpandedDay(expanded ? null : key)}
                    >
                      {expanded ? "Show fewer" : `+${events.length - 3} more`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CalendarChip({ event }: { event: CalendarEvent }) {
  const content = (
    <>
      <span className={styles.chipTitle}>{event.title}</span>
      <span className={styles.chipMeta}>
        <i data-tone={event.readiness} />
        {event.channel} · {eventStatusLabel(event)}
      </span>
    </>
  );
  const chipStyle = { borderLeftColor: event.color, background: `${event.color}16` };

  if (event.type === "published" && event.youtubeVideoId) {
    return (
      <a
        className={`${styles.calendarChip} ${styles.publishedChip}`}
        style={chipStyle}
        href={`https://www.youtube.com/watch?v=${event.youtubeVideoId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`${event.title} — ${eventStatusLabel(event).toLowerCase()} on ${event.channel}`}
      >
        {content}
      </a>
    );
  }
  return (
    <div
      className={`${styles.calendarChip} ${event.pinned ? styles.pinnedChip : styles.projectedChip}`}
      style={chipStyle}
      draggable={Boolean(event.id)}
      onDragStart={(dragEvent) => {
        if (!event.id) return;
        dragEvent.dataTransfer.setData("text/plan-id", event.id);
        dragEvent.dataTransfer.effectAllowed = "move";
      }}
      title={`${event.title} — ${event.channel} — ${eventStatusLabel(event)} — ${event.pinned ? "pinned" : "projected"}`}
    >
      {event.slug ? <Link href={channelHref(event.slug, "week-ahead")}>{content}</Link> : content}
    </div>
  );
}

function LegendDot({ tone, label }: { tone: PlanReadiness | "published"; label: string }) {
  return <span className={styles.legendDot}><span data-tone={tone} />{label}</span>;
}

function NavButton({ children, onClick, label, flip }: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  flip?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.navButton}
      onClick={onClick}
      aria-label={label}
      style={{ transform: flip ? "rotate(180deg)" : undefined }}
    >
      {children}
    </button>
  );
}
