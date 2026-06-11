"use client";

import { useMemo, useState, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonList } from "@/components/Skeleton";
import { IconChevron } from "@/components/icons";

type PlanItem = {
  _id: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  cadence: string;
  order: number;
  topic: string;
  title?: string;
  status: string;
  scheduledAt?: number;
  frequency?: string;
  days?: number[];
};
type ChannelRow = {
  _id: string;
  name: string;
  identity?: { cadence?: string };
  schedule?: { frequency: string; days?: number[] };
};
type Video = {
  _id: string;
  title: string;
  channelName: string;
  youtubeVideoId?: string;
  createdAt?: number;
};

const DAY = 86_400_000;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Ev = { type: "planned" | "published"; title: string; channel: string; slug?: string; youtubeVideoId?: string; status?: string; id?: string; pinned?: boolean };

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const isoDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Project the next `count` upload dates from a frequency + chosen weekdays. */
function projectDates(frequency: string, days: number[] | undefined, count: number, from: Date): Date[] {
  const out: Date[] = [];
  const dset = days && days.length ? new Set(days) : null;
  const startMid = midnight(from);
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  const monthsUsed = new Set<number>();
  let guard = 0;
  while (out.length < count && guard++ < 800) {
    const wd = d.getDay();
    const weekIdx = Math.floor((midnight(d) - startMid) / (7 * DAY));
    let ok = false;
    if (frequency === "daily") ok = !dset || dset.has(wd);
    else if (frequency === "weekly") ok = dset ? dset.has(wd) : wd === 1;
    else if (frequency === "biweekly") ok = (dset ? dset.has(wd) : wd === 1) && weekIdx % 2 === 0;
    else if (frequency === "monthly") {
      const mk = d.getFullYear() * 12 + d.getMonth();
      const dayOk = dset ? dset.has(wd) : d.getDate() <= 7 && wd === 1;
      if (dayOk && !monthsUsed.has(mk)) { ok = true; monthsUsed.add(mk); }
    } else ok = dset ? dset.has(wd) : wd === 1;
    if (ok) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function SchedulePage() {
  const ownerId = useOwnerId();
  const plan = useQuery(api.contentPlan.listPlanByOwner, { ownerId }) as PlanItem[] | undefined;
  const videos = useQuery(api.videos.listVideos, { ownerId, limit: 120 }) as Video[] | undefined;
  const channels = useQuery(api.channels.listChannels, { ownerId }) as ChannelRow[] | undefined;
  const reschedule = useMutation(api.contentPlan.setScheduledAt);

  // Month being viewed (offset from the current month).
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);

  // Build the date → events map.
  const events = useMemo(() => {
    const map = new Map<string, Ev[]>();
    const add = (d: Date, e: Ev) => {
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    };
    // Projected upcoming: per channel, space plan items by cadence from today.
    const byChannel = new Map<string, PlanItem[]>();
    for (const p of plan ?? []) {
      if (!byChannel.has(p.channelId)) byChannel.set(p.channelId, []);
      byChannel.get(p.channelId)!.push(p);
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (const items of byChannel.values()) {
      const sorted = [...items].sort((a, b) => a.order - b.order);
      const freq = sorted[0]?.frequency ?? sorted[0]?.cadence ?? "weekly";
      const dates = projectDates(freq, sorted[0]?.days, sorted.length, today);
      sorted.forEach((p, k) => {
        // PINNED date (drag/date-field) wins; otherwise project from frequency+days.
        const d = p.scheduledAt ? new Date(p.scheduledAt) : (dates[k] ?? new Date(today.getTime() + (k + 1) * DAY));
        add(d, { type: "planned", title: p.title || p.topic, channel: p.channelName, slug: p.channelSlug, status: p.status, id: p._id, pinned: !!p.scheduledAt });
      });
    }
    // Published (real) — placed on their finished date.
    for (const v of videos ?? []) {
      if (!v.youtubeVideoId || !v.createdAt) continue;
      add(new Date(v.createdAt), { type: "published", title: v.title, channel: v.channelName, youtubeVideoId: v.youtubeVideoId });
    }
    return map;
  }, [plan, videos, now]);

  // 6-week grid starting on the Sunday on/before the 1st.
  const gridStart = new Date(view);
  gridStart.setDate(1 - view.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY));

  const loading = plan === undefined || videos === undefined;
  const upcoming = useMemo(() => {
    const list: { date: Date; ev: Ev }[] = [];
    for (const [k, evs] of events) {
      const [y, m, d] = k.split("-").map(Number);
      const date = new Date(y, m, d);
      if (date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        for (const ev of evs) if (ev.type === "planned") list.push({ date, ev });
      }
    }
    return list.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 8);
  }, [events, now]);

  return (
    <>
      <PageHeader title="Schedule" subtitle="Upcoming planned videos (projected by each channel's cadence) + published history" />

      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </div>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <NavBtn onClick={() => setOffset((o) => o - 1)} flip><IconChevron width={16} height={16} /></NavBtn>
          <button onClick={() => setOffset(0)} style={todayBtn}>Today</button>
          <NavBtn onClick={() => setOffset((o) => o + 1)}><IconChevron width={16} height={16} /></NavBtn>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "1.2rem", marginBottom: "0.8rem", fontSize: "0.8rem", color: "var(--color-muted)" }}>
        <Legend color="var(--color-accent)" label="Planned (projected)" />
        <Legend color="var(--color-ok)" label="Published" />
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          {/* Calendar grid */}
          <div className="glass" style={{ padding: "0.6rem", marginBottom: "1.6rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
              {DOW.map((d) => (
                <div key={d} style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--color-faint)", padding: "0.3rem 0" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {cells.map((d) => {
                const inMonth = d.getMonth() === view.getMonth();
                const isToday = dayKey(d) === dayKey(now);
                const evs = events.get(dayKey(d)) ?? [];
                return (
                  <div
                    key={d.toISOString()}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) reschedule({ id: id as Id<"contentPlan">, scheduledAt: midnight(d) });
                    }}
                    style={{
                      minHeight: 86, borderRadius: 8, padding: "0.35rem 0.4rem",
                      background: inMonth ? "var(--color-surface)" : "transparent",
                      border: isToday ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                      opacity: inMonth ? 1 : 0.4, display: "flex", flexDirection: "column", gap: 3, overflow: "hidden",
                    }}
                  >
                    <div style={{ fontSize: "0.72rem", color: isToday ? "var(--color-accent)" : "var(--color-muted)", fontWeight: isToday ? 700 : 500 }}>
                      {d.getDate()}
                    </div>
                    {evs.slice(0, 3).map((e, i) => (
                      <ChipLink key={i} ev={e} />
                    ))}
                    {evs.length > 3 && <div style={{ fontSize: "0.66rem", color: "var(--color-faint)" }}>+{evs.length - 3} more</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-channel upload cadence editor */}
          <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.7rem" }}>Upload cadence</div>
          <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.6rem" }}>
            {(channels ?? []).map((c) => (
              <ChannelScheduleEditor key={c._id} channel={c} />
            ))}
          </div>

          {/* Upcoming list */}
          <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.7rem" }}>Next up</div>
          {upcoming.length === 0 ? (
            <div className="glass" style={{ padding: "1rem 1.2rem", color: "var(--color-muted)", fontSize: "0.88rem" }}>
              No planned videos yet. Add some from a channel&apos;s <strong>Week ahead</strong> tab.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {upcoming.map(({ date, ev }, i) => (
                <div key={i} className="glass" style={{ display: "flex", alignItems: "center", gap: "0.9rem", padding: "0.6rem 0.9rem" }}>
                  <div style={{ width: 54, textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--color-faint)" }}>{MONTHS[date.getMonth()].slice(0, 3)}</div>
                    <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{date.getDate()}</div>
                  </div>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--color-accent)", flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}>
                      {ev.channel}{ev.status ? ` · ${ev.status}` : ""}{!ev.pinned ? " · projected" : ""}
                    </div>
                  </div>
                  {ev.id && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                      <input
                        type="date"
                        value={isoDate(date.getTime())}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) reschedule({ id: ev.id as Id<"contentPlan">, scheduledAt: new Date(`${val}T00:00:00`).getTime() });
                        }}
                        style={{
                          background: "var(--color-surface)", color: "var(--color-fg)",
                          border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.35rem 0.5rem", fontSize: "0.8rem",
                        }}
                      />
                      {ev.pinned && (
                        <button
                          onClick={() => reschedule({ id: ev.id as Id<"contentPlan">, scheduledAt: null })}
                          title="Unpin (back to projected)"
                          style={{ background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-muted)", borderRadius: 8, padding: "0.3rem 0.5rem", fontSize: "0.75rem", cursor: "pointer" }}
                        >
                          Unpin
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ChipLink({ ev }: { ev: Ev }) {
  const published = ev.type === "published";
  const color = published ? "var(--color-ok)" : "var(--color-accent)";
  const inner = (
    <div
      title={`${ev.title} — ${ev.channel}${!published ? (ev.pinned ? " (pinned — drag to move)" : " (projected — drag to pin a date)") : ""}`}
      style={{
        fontSize: "0.66rem", lineHeight: 1.2, padding: "2px 5px", borderRadius: 4,
        background: published ? "rgba(52,211,153,0.16)" : "rgba(124,124,255,0.16)",
        color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        border: `1px solid transparent`, borderLeft: `2px ${!published && !ev.pinned ? "dashed" : "solid"} ${color}`,
      }}
    >
      {!published && !ev.pinned ? "~ " : ""}{ev.title}
    </div>
  );
  if (published && ev.youtubeVideoId)
    return <a href={`https://www.youtube.com/watch?v=${ev.youtubeVideoId}`} target="_blank" rel="noopener noreferrer">{inner}</a>;
  if (!published && ev.id)
    return (
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", ev.id!); e.dataTransfer.effectAllowed = "move"; }}
        style={{ cursor: "grab" }}
      >
        {inner}
      </div>
    );
  if (!published && ev.slug) return <Link href={`/channels/${ev.slug}`}>{inner}</Link>;
  return inner;
}

function ChannelScheduleEditor({ channel }: { channel: ChannelRow }) {
  const update = useMutation(api.channels.updateChannel);
  const freq = channel.schedule?.frequency ?? channel.identity?.cadence ?? "weekly";
  const days = channel.schedule?.days ?? [];
  const usesDays = freq === "weekly" || freq === "biweekly";

  const save = (next: { frequency: string; days?: number[] }) =>
    update({ channelId: channel._id as Id<"channels">, schedule: next });

  const setFreq = (f: string) => save({ frequency: f, days: f === "daily" || f === "monthly" ? undefined : days.length ? days : [1] });
  const toggleDay = (d: number) => {
    const set = new Set(days);
    if (set.has(d)) set.delete(d); else set.add(d);
    save({ frequency: freq, days: [...set].sort((a, b) => a - b) });
  };

  return (
    <div className="glass" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.7rem 1rem", flexWrap: "wrap" }}>
      <div style={{ fontWeight: 600, minWidth: 150, flex: "0 0 auto" }}>{channel.name}</div>
      <select
        value={freq}
        onChange={(e) => setFreq(e.target.value)}
        style={{ background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Every 2 weeks</option>
        <option value="monthly">Monthly</option>
      </select>
      {usesDays && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {DOW.map((label, d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                title={label}
                style={{
                  width: 34, height: 30, borderRadius: 7, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                  border: `1px solid ${on ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: on ? "var(--color-accent)" : "var(--color-surface)",
                  color: on ? "#0a0a0b" : "var(--color-muted)",
                }}
              >
                {label[0]}
              </button>
            );
          })}
        </div>
      )}
      <span style={{ fontSize: "0.76rem", color: "var(--color-faint)", marginLeft: "auto" }}>
        {usesDays && days.length ? `${days.map((d) => DOW[d]).join(", ")}` : freq === "daily" ? "every day" : freq === "monthly" ? "monthly" : "pick day(s)"}
      </span>
    </div>
  );
}

function NavBtn({ children, onClick, flip }: { children: ReactNode; onClick: () => void; flip?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8,
        background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-fg)",
        cursor: "pointer", transform: flip ? "rotate(180deg)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

const todayBtn: CSSProperties = {
  background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-fg)",
  borderRadius: 8, padding: "0 0.7rem", height: 32, fontSize: "0.82rem", cursor: "pointer",
};

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} /> {label}
    </span>
  );
}
