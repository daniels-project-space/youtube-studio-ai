"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow, VideoRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import { ArtifactWorkRail } from "@/components/ArtifactWorkRail";
import { ThumbnailRefreshInventoryPanel } from "@/components/ThumbnailRefreshInventoryPanel";
import { OwnerOnlyNotice } from "@/components/OwnerOnlyNotice";
import { useOperationsAccess } from "@/components/OperationsAccess";
import {
  LibraryFilters,
  type LibraryFilterState,
} from "@/components/LibraryFilters";
import { IconLibrary, IconChevron, IconSpark } from "@/components/icons";
import {
  isLibraryGroupExpanded,
  LIBRARY_PAGE_SIZE,
  pageLibraryGroup,
} from "./libraryPaging";
import styles from "./library.module.css";

/** Open lightbox = which channel group + which index within that group. */
type LightboxTarget = { slug: string; index: number };
type CollectionMode = "active" | "archived";

export default function LibraryPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const operationsAccess = useOperationsAccess();

  const videos = useQuery(api.videos.listVideos, { ownerId, limit: 500, includeArchived: true }) as
    | VideoRow[]
    | undefined;
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;
  const setLibraryState = useMutation(api.videos.setLibraryState);

  const [filters, setFilters] = useState<LibraryFilterState>({
    channelSlug: null,
    status: "all",
    sort: "date",
    search: "",
    from: "",
    to: "",
  });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [collection, setCollection] = useState<CollectionMode>("active");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [recentChange, setRecentChange] = useState<{ video: VideoRow; state: CollectionMode } | null>(null);

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
      if ((v.libraryState ?? "active") !== collection) return false;
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
  }, [videos, filters, selectedSlug, collection]);

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

  const toggle = (slug: string, isExpanded: boolean) =>
    setExpandedGroups((current) => ({ ...current, [slug]: !isExpanded }));

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
  const activeCount = videos?.filter((video) => (video.libraryState ?? "active") === "active").length ?? 0;
  const archivedCount = videos?.filter((video) => video.libraryState === "archived").length ?? 0;

  const changeLibraryState = async (video: VideoRow, state: CollectionMode) => {
    if (busyIds.has(video._id)) return;
    setBusyIds((current) => new Set(current).add(video._id));
    try {
      await setLibraryState({
        ownerId,
        runId: video._id as Id<"runs">,
        state,
      });
      setRecentChange({ video, state });
      if (lightbox?.slug === video.channelSlug) setLightbox(null);
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(video._id);
        return next;
      });
    }
  };

  const undoRecentChange = async () => {
    if (!recentChange) return;
    const change = recentChange;
    setRecentChange(null);
    await changeLibraryState(
      change.video,
      change.state === "archived" ? "active" : "archived",
    );
    setRecentChange(null);
  };

  return (
    <div className={styles.library}>
      <PageHeader
        eyebrow="Video library"
        title="Library"
        subtitle="Open, repackage, or archive saved videos."
      />

      <section className={styles.collectionBar} aria-label="Library collections">
        <div className={styles.collectionTabs} role="tablist" aria-label="Video collection">
          <button type="button" role="tab" aria-selected={collection === "active"} onClick={() => setCollection("active")}>
            <span>Active masters</span><strong>{loading ? "—" : activeCount}</strong>
          </button>
          <button type="button" role="tab" aria-selected={collection === "archived"} onClick={() => setCollection("archived")}>
            <span>Archive</span><strong>{loading ? "—" : archivedCount}</strong>
          </button>
        </div>
        <p>
          {collection === "active"
            ? "Saved and published videos."
            : "Hidden videos you can restore."}
        </p>
        <span className={styles.evidenceNote}>
          <i aria-hidden="true" />
          Verified marks a saved final master.
        </span>
      </section>

      {collection === "active" ? <div className={styles.latestRail}>
        <ArtifactWorkRail
          videos={videos === undefined ? undefined : filtered}
          onOpen={(video) => openLightbox(video.channelSlug, video)}
          title="Latest visible work"
          description="Open recent work."
          emptyMessage="No saved videos match these filters."
        />
      </div> : null}

      {collection === "active" ? (
        <details id="thumbnail-refresh" className={`${styles.packagingWorkshop} glass`} open>
          <summary>
            <span className={styles.workshopIcon} aria-hidden="true"><IconSpark width={18} height={18} /></span>
            <span><small>30 reviewed ERNIE thumbnails</small><strong>Ready to preview and apply</strong></span>
            <p>Replace the current YouTube images.</p>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.workshopBody}>
            {operationsAccess === "owner" ? (
              <ThumbnailRefreshInventoryPanel selectedChannelSlug={selectedSlug} />
            ) : (
              <OwnerOnlyNotice access={operationsAccess} desk="the thumbnail refresh inventory" />
            )}
          </div>
        </details>
      ) : null}

      {!loading && (
        <LibraryFilters
          channels={channels ?? []}
          state={filters}
          onChange={setFilters}
          resultCount={filtered.length}
        />
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={collection === "active" ? "No active masters" : "Archive is empty"}
          description={collection === "active"
            ? "Finished and published videos will appear here, grouped by channel."
            : "Archived masters remain recoverable here until you restore them."}
          icon={<IconLibrary width={24} height={24} />}
        />
      ) : (
        <div className={styles.archive}>
          {groups.map((g, groupIndex) => {
            const isExpanded = isLibraryGroupExpanded(
              groupIndex,
              expandedGroups[g.slug],
            );
            const page = pageLibraryGroup(g.videos, visibleLimits[g.slug]);
            return (
              <section key={g.slug} className={styles.channel}>
                <button
                  type="button"
                  onClick={() => toggle(g.slug, isExpanded)}
                  className={styles.channelHeader}
                  data-collapsed={!isExpanded}
                  aria-expanded={isExpanded}
                >
                  <IconChevron width={16} height={16} />
                  <h2>{g.name}</h2>
                  <span className={styles.count}>{g.videos.length} {g.videos.length === 1 ? "master" : "masters"}</span>
                </button>

                {isExpanded && (
                  <>
                    <VideoGrid
                      videos={page.visible}
                      onOpen={(v) => openLightbox(g.slug, v)}
                      libraryAction={operationsAccess === "owner" ? {
                        label: collection === "active" ? "Archive" : "Restore",
                        busyIds,
                        onAction: (video) => void changeLibraryState(video, collection === "active" ? "archived" : "active"),
                      } : undefined}
                    />
                    {page.total > LIBRARY_PAGE_SIZE ? (
                      <div className={styles.paging}>
                        <p aria-live="polite">
                          Showing {page.visible.length} of {page.total}
                        </p>
                        <div className={styles.actions}>
                          {page.visible.length > LIBRARY_PAGE_SIZE ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                setVisibleLimits((current) => ({
                                  ...current,
                                  [g.slug]: LIBRARY_PAGE_SIZE,
                                }))
                              }
                            >
                              Latest {LIBRARY_PAGE_SIZE}
                            </button>
                          ) : null}
                          {page.remaining > 0 ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                setVisibleLimits((current) => ({
                                  ...current,
                                  [g.slug]: page.visible.length + page.nextBatchSize,
                                }))
                              }
                            >
                              Show next {page.nextBatchSize}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
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
      {recentChange ? (
        <aside className={styles.changeToast} role="status">
          <span><strong>{recentChange.state === "archived" ? "Moved to archive" : "Restored to active masters"}</strong><small>{recentChange.video.title}</small></span>
          <button type="button" onClick={() => void undoRecentChange()}>
            Undo
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setRecentChange(null)}>×</button>
        </aside>
      ) : null}
    </div>
  );
}
