"use client";

import type { ChannelRow } from "@/lib/types";
import styles from "./LibraryFilters.module.css";

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

/**
 * Library toolbar: channel dropdown, status, sort, free-text title search, and
 * a date range. Fully controlled — the page owns the state and does the actual
 * filtering/sorting client-side.
 */
export function LibraryFilters({
  channels,
  state,
  onChange,
  resultCount,
}: {
  channels: ChannelRow[];
  state: LibraryFilterState;
  onChange: (next: LibraryFilterState) => void;
  resultCount?: number;
}) {
  const set = <K extends keyof LibraryFilterState>(
    key: K,
    value: LibraryFilterState[K],
  ) => onChange({ ...state, [key]: value });

  return (
    <div className={`glass ${styles.toolbar}`} aria-label="Library filters">
      {/* Search */}
      <div className={`${styles.field} ${styles.search}`}>
        <label className={styles.label}>Search title</label>
        <input
          type="search"
          placeholder="Search videos…"
          value={state.search}
          onChange={(e) => set("search", e.target.value)}
          className={styles.input}
        />
      </div>

      {/* Channel */}
      <div className={styles.field}>
        <label className={styles.label}>Channel</label>
        <select
          value={state.channelSlug ?? ""}
          onChange={(e) => set("channelSlug", e.target.value || null)}
          className={styles.select}
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
      <div className={styles.field}>
        <label className={styles.label}>Status</label>
        <select
          value={state.status}
          onChange={(e) => set("status", e.target.value as StatusFilter)}
          className={styles.select}
        >
          <option value="all">All</option>
          <option value="ok">Done</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Sort */}
      <div className={styles.field}>
        <label className={styles.label}>Sort</label>
        <select
          value={state.sort}
          onChange={(e) => set("sort", e.target.value as SortKey)}
          className={styles.select}
        >
          <option value="date">Newest</option>
          <option value="views">Est. views</option>
        </select>
      </div>

      {/* Date range */}
      <div className={styles.field}>
        <label className={styles.label}>From</label>
        <input
          type="date"
          value={state.from}
          onChange={(e) => set("from", e.target.value)}
          className={styles.input}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>To</label>
        <input
          type="date"
          value={state.to}
          onChange={(e) => set("to", e.target.value)}
          className={styles.input}
        />
      </div>
      {resultCount !== undefined ? (
        <div className={styles.resultCount} aria-live="polite">
          <strong>{resultCount}</strong>
          <span>visible</span>
        </div>
      ) : null}
    </div>
  );
}
