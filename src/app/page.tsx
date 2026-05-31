"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Single-operator default — the owner used by the Milestone-1 Lofi pipeline.
const OWNER_ID = "owner_daniel";

type RunRow = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
  channelName: string;
  channelSlug: string;
};

type ChannelRow = {
  _id: string;
  name: string;
  slug: string;
  status: string;
  template: string;
};

const STATUS_COLOR: Record<string, string> = {
  ok: "#22c55e",
  running: "#3b82f6",
  queued: "#a1a1aa",
  failed: "#ef4444",
  canceled: "#f59e0b",
};

function fmt(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function Home() {
  const channels = useQuery(api.channels.listChannels, { ownerId: OWNER_ID }) as
    | ChannelRow[]
    | undefined;
  const runs = useQuery(api.runs.listRecent, { ownerId: OWNER_ID, limit: 10 }) as
    | RunRow[]
    | undefined;

  const featured = runs?.find((r) => r.youtubeVideoId);

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      }}
    >
      <header style={{ marginBottom: "2.5rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          YouTube Studio AI
        </h1>
        <p style={{ color: "#71717a", marginTop: "0.5rem" }}>
          Autonomous channel pipeline — live data from Convex ({OWNER_ID}).
        </p>
      </header>

      {/* Featured / Milestone-1 video */}
      {featured?.youtubeVideoId && (
        <section style={{ marginBottom: "3rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Latest published video
          </h2>
          <div
            style={{
              position: "relative",
              paddingBottom: "56.25%",
              height: 0,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #27272a",
            }}
          >
            <iframe
              src={`https://www.youtube.com/embed/${featured.youtubeVideoId}`}
              title="Latest published video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
          <a
            href={`https://www.youtube.com/watch?v=${featured.youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: "0.5rem", color: "#3b82f6", fontSize: "0.9rem" }}
          >
            youtube.com/watch?v={featured.youtubeVideoId} ↗
          </a>
        </section>
      )}

      {/* Channels */}
      <section style={{ marginBottom: "3rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Channels</h2>
        {channels === undefined ? (
          <p style={{ color: "#71717a" }}>Loading…</p>
        ) : channels.length === 0 ? (
          <p style={{ color: "#71717a" }}>No channels yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {channels.map((c) => (
              <li
                key={c._id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid #27272a",
                  borderRadius: 10,
                  padding: "0.75rem 1rem",
                }}
              >
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                  {c.template} · {c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent runs */}
      <section>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Recent runs</h2>
        {runs === undefined ? (
          <p style={{ color: "#71717a" }}>Loading…</p>
        ) : runs.length === 0 ? (
          <p style={{ color: "#71717a" }}>No runs yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {runs.map((r) => (
              <li
                key={r._id}
                style={{
                  border: "1px solid #27272a",
                  borderRadius: 10,
                  padding: "0.75rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: STATUS_COLOR[r.status] ?? "#a1a1aa",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{r.status}</span>
                  <span style={{ color: "#a1a1aa", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.channelName}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.8rem", color: "#71717a", whiteSpace: "nowrap" }}>
                  {r.youtubeVideoId && (
                    <a
                      href={`https://www.youtube.com/watch?v=${r.youtubeVideoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#3b82f6" }}
                    >
                      video ↗
                    </a>
                  )}
                  <span>{fmt(r.startedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
