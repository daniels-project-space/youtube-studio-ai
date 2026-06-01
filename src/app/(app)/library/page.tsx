"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow, VideoRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import {
  LibraryFilters,
  type LibraryFilterState,
} from "@/components/LibraryFilters";
import { IconLibrary, IconChevron } from "@/components/icons";

/** Open lightbox = which channel group + which index within that group. */
type LightboxTarget = { slug: string; index: number };

export default function LibraryPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();

  const videos = useQuery(api.videos.listVideos, { ownerId, limit: 500 }) as
    | VideoRow[]
    | undefined;
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;

  const [filters, setFilters] = useState<LibraryFilterState>({
    channelSlug: null,
    status: "all",
    sort: "date",
    search: "",
    from: "",
    to: "",
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);

  // Apply all filters + sort client-side over the query result.
  const filtered = useMemo<VideoRow[]>(() => {
    if (!videos) return [];
    const fromMs = filters.from ? new Date(filters.from).getTime() : null;
    // `to` is inclusive → push to end-of-day.
    const toMs = filters.to
      ? new Date(filters.to).getTime() + 24 * 3600 * 1000 - 1
      : null;
    const needle = filters.search.trim().toLowerCase();

    const out = videos.filter((v) => {
      // Global ChannelSwitcher wins; the filter dropdown narrows further.
      if (selectedSlug && v.channelSlug !== selectedSlug) return false;
      if (filters.channelSlug && v.channelSlug !== filters.channelSlug)
        return false;
      if (filters.status !== "all" && v.status !== filters.status) return false;
      if (needle && !v.title.toLowerCase().includes(needle)) return false;
      if (fromMs && v.createdAt < fromMs) return false;
      if (toMs && v.createdAt > toMs) return false;
      return true;
    });

    out.sort((a, b) => {
      if (filters.sort === "views") {
        const av = a.estimatedViews ?? -1;
        const bv = b.estimatedViews ?? -1;
        if (bv !== av) return bv - av;
        return b.createdAt - a.createdAt; // tie-break / no-views fallback
      }
      return b.createdAt - a.createdAt;
    });
    return out;
  }, [videos, filters, selectedSlug]);

  // Group by channel, preserving the sorted order within each group.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { slug: string; name: string; videos: VideoRow[] }
    >();
    for (const v of filtered) {
      const g = map.get(v.channelSlug);
      if (g) g.videos.push(v);
      else
        map.set(v.channelSlug, {
          slug: v.channelSlug,
          name: v.channelName,
          videos: [v],
        });
    }
    return [...map.values()];
  }, [filtered]);

  const toggle = (slug: string) =>
    setCollapsed((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(slug)) nextSet.delete(slug);
      else nextSet.add(slug);
      return nextSet;
    });

  // Videos in the currently-open lightbox group (prev/next scope).
  const lightboxVideos = lightbox
    ? (groups.find((g) => g.slug === lightbox.slug)?.videos ?? [])
    : [];

  const openLightbox = (slug: string, video: VideoRow) => {
    const g = groups.find((gr) => gr.slug === slug);
    if (!g) return;
    const index = g.videos.findIndex((v) => v._id === video._id);
    setLightbox({ slug, index: Math.max(0, index) });
  };

  const loading = videos === undefined || channels === undefined;

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Finished videos across your channels"
      />

      {!loading && (
        <LibraryFilters
          channels={channels ?? []}
          state={filters}
          onChange={setFilters}
        />
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No videos yet"
          description="Finished and published videos will appear here, grouped by channel."
          icon={<IconLibrary width={24} height={24} />}
        />
      ) : (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.slug);
            return (
              <section key={g.slug}>
                <button
                  type="button"
                  onClick={() => toggle(g.slug)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.55rem",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    font: "inherit",
                    cursor: "pointer",
                    padding: "0 0 0.85rem",
                  }}
                >
                  <IconChevron
                    width={16}
                    height={16}
                    style={{
                      transform: isCollapsed ? "rotate(-90deg)" : "none",
                      transition: "transform 0.15s ease",
                      color: "var(--color-muted)",
                    }}
                  />
                  <h2 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>
                    {g.name}
                  </h2>
                  <span
                    style={{
                      fontSize: "0.74rem",
                      fontWeight: 500,
                      padding: "0.1rem 0.5rem",
                      borderRadius: 999,
                      color: "var(--color-muted)",
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {g.videos.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <VideoGrid
                    videos={g.videos}
                    onOpen={(v) => openLightbox(g.slug, v)}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      {lightbox && lightboxVideos.length > 0 && (
        <Lightbox
          videos={lightboxVideos}
          index={Math.min(lightbox.index, lightboxVideos.length - 1)}
          onIndex={(i) =>
            setLightbox((cur) => (cur ? { ...cur, index: i } : cur))
          }
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
