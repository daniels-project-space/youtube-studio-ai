"use client";

import type { ChannelRow } from "@/lib/types";

export type SortKey = "date" | "views";
export type StatusFilter = "all" | "ok" | "failed";

export type LibraryFilterState = {
  channelSlug: string | null; // null = all
  status: StatusFilter;
  sort: SortKey;
  search: string;
  from: string; // yyyy-mm-dd or ""
  to: string; // yyyy-mm-dd or ""
};

const fieldStyle: React.CSSProperties = {
  padding: "0.45rem 0.65rem",
  borderRadius: 10,
  fontSize: "0.82rem",
  font: "inherit",
  color: "var(--color-fg)",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--color-faint)",
  marginBottom: "0.3rem",
  display: "block",
};

/**
 * Library toolbar: channel dropdown, status, sort, free-text title search, and
 * a date range. Fully controlled — the page owns the state and does the actual
 * filtering/sorting client-side.
 */
export function LibraryFilters({
  channels,
  state,
  onChange,
}: {
  channels: ChannelRow[];
  state: LibraryFilterState;
  onChange: (next: LibraryFilterState) => void;
}) {
  const set = <K extends keyof LibraryFilterState>(
    key: K,
    value: LibraryFilterState[K],
  ) => onChange({ ...state, [key]: value });

  return (
    <div
      className="glass"
      style={{
        padding: "0.9rem 1rem",
        marginBottom: "1.5rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.9rem",
        alignItems: "flex-end",
      }}
    >
      {/* Search */}
      <div style={{ flex: "1 1 200px", minWidth: 160 }}>
        <label style={labelStyle}>Search title</label>
        <input
          type="search"
          placeholder="Search videos…"
          value={state.search}
          onChange={(e) => set("search", e.target.value)}
          style={{ ...fieldStyle, width: "100%" }}
        />
      </div>

      {/* Channel */}
      <div>
        <label style={labelStyle}>Channel</label>
        <select
          value={state.channelSlug ?? ""}
          onChange={(e) => set("channelSlug", e.target.value || null)}
          style={fieldStyle}
        >
          <option value="">All channels</option>
          {channels.map((c) => (
            <option key={c._id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Status */}
      <div>
        <label style={labelStyle}>Status</label>
        <select
          value={state.status}
          onChange={(e) => set("status", e.target.value as StatusFilter)}
          style={fieldStyle}
        >
          <option value="all">All</option>
          <option value="ok">Done</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Sort */}
      <div>
        <label style={labelStyle}>Sort</label>
        <select
          value={state.sort}
          onChange={(e) => set("sort", e.target.value as SortKey)}
          style={fieldStyle}
        >
          <option value="date">Newest</option>
          <option value="views">Est. views</option>
        </select>
      </div>

      {/* Date range */}
      <div>
        <label style={labelStyle}>From</label>
        <input
          type="date"
          value={state.from}
          onChange={(e) => set("from", e.target.value)}
          style={fieldStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>To</label>
        <input
          type="date"
          value={state.to}
          onChange={(e) => set("to", e.target.value)}
          style={fieldStyle}
        />
      </div>
    </div>
  );
}
