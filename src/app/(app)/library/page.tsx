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
import { IconLibrary, IconSpark } from "@/components/icons";
import {
  LIBRARY_PAGE_SIZE,
  pageLibraryGroup,
} from "./libraryPaging";
import styles from "./library.module.css";

/** Open lightbox = the index within the current filtered master collection. */
type LightboxTarget = { index: number };
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
  const [visibleLimit, setVisibleLimit] = useState(LIBRARY_PAGE_SIZE);
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [collection, setCollection] = useState<CollectionMode>("active");
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [recentChange, setRecentChange] = useState<{ video: VideoRow; state: CollectionMode } | null>(null);
  // ERNIE was kept only as sealed comparison evidence. The Library always
  // projects the retained source or a run-bound current candidate; it must
  // never promote a frozen experimental batch as the visible replacement.
  const libraryVideos = videos;

  // Apply all filters + sort client-side over the query result.
  const filtered = useMemo<VideoRow[]>(() => {
    if (!libraryVideos) return [];
    const fromMs = filters.from ? new Date(filters.from).getTime() : null;
    // `to` is inclusive → push to end-of-day.
    const toMs = filters.to
      ? new Date(filters.to).getTime() + 24 * 3600 * 1000 - 1
      : null;
    const needle = filters.search.trim().toLowerCase();

    const out = libraryVideos.filter((v) => {
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
  }, [libraryVideos, filters, selectedSlug, collection]);

  // The vault is an actual collection, not a stack of mostly-collapsed
  // channel containers. Channel remains a first-class filter and each card
  // keeps its channel identity, but matching masters share one dense grid.
  const page = pageLibraryGroup(filtered, visibleLimit);
  const matchingChannelCount = new Set(filtered.map((video) => video.channelSlug)).size;
  const reviewCount = filtered.filter(
    (video) => video.releaseEvidenceStatus !== "release_evidence_recorded",
  ).length;
  const lightboxVideos = lightbox ? filtered : [];

  const openLightbox = (video: VideoRow) => {
    const index = filtered.findIndex((item) => item._id === video._id);
    setLightbox({ index: Math.max(0, index) });
  };

  const loading = libraryVideos === undefined || channels === undefined;
  const activeCount = libraryVideos?.filter((video) => (video.libraryState ?? "active") === "active").length ?? 0;
  const archivedCount = libraryVideos?.filter((video) => video.libraryState === "archived").length ?? 0;

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
      if (lightbox && filtered[lightbox.index]?._id === video._id) setLightbox(null);
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

      <div className={styles.libraryDashboard}>
        <section className={styles.collectionBar} aria-label="Library collections">
          <div className={styles.collectionTabs} role="tablist" aria-label="Video collection">
            <button type="button" role="tab" aria-selected={collection === "active"} onClick={() => setCollection("active")}>
              <span>Active masters</span><strong>{loading ? "—" : activeCount}</strong>
            </button>
            <button type="button" role="tab" aria-selected={collection === "archived"} onClick={() => setCollection("archived")}>
              <span>Archive</span><strong>{loading ? "—" : archivedCount}</strong>
            </button>
          </div>
          <span
            className={styles.evidenceNote}
            title="Verified marks a saved final master"
            aria-label="Verified marks a saved final master"
          >
            <i aria-hidden="true" />
            Final-master status
          </span>
        </section>
        <dl className={styles.libraryMetrics} aria-label="Current library summary">
          <LibraryMetric label="Visible" value={loading ? "—" : String(filtered.length)} />
          <LibraryMetric label="Channels" value={loading ? "—" : String(matchingChannelCount)} />
          <LibraryMetric label="Review" value={loading ? "—" : String(reviewCount)} tone={reviewCount ? "attention" : "ready"} />
        </dl>
      </div>

      {collection === "active" ? <div className={styles.latestRail}>
        <ArtifactWorkRail
          videos={libraryVideos === undefined ? undefined : filtered}
          onOpen={openLightbox}
          title="Recent masters"
          description="Open saved output."
          emptyMessage="No saved videos match these filters."
          maxItems={5}
        />
      </div> : null}

      {collection === "active" ? (
        <details id="thumbnail-refresh" className={`${styles.packagingWorkshop} glass`}>
          <summary>
            <span className={styles.workshopIcon} aria-hidden="true"><IconSpark width={18} height={18} /></span>
            <span><small>Thumbnail review</small><strong>Exact saved runs</strong></span>
            <p>Private candidates and confirmed replacements.</p>
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
      ) : filtered.length === 0 ? (
        <EmptyState
          title={collection === "active" ? "No active masters" : "Archive is empty"}
          description={collection === "active"
            ? "Finished and published videos will appear here."
            : "Hidden videos you can restore."}
          icon={<IconLibrary width={24} height={24} />}
        />
      ) : (
        <section className={styles.vault} aria-labelledby="library-vault-title">
          <header className={styles.vaultHeader}>
            <div>
              <span>Master vault</span>
              <h2 id="library-vault-title">{collection === "active" ? "Saved video output" : "Archived video output"}</h2>
            </div>
            <p aria-live="polite">Showing {page.visible.length} of {page.total}</p>
          </header>
          <VideoGrid
            videos={page.visible}
            onOpen={openLightbox}
            libraryAction={operationsAccess === "owner" ? {
              label: collection === "active" ? "Archive" : "Restore",
              busyIds,
              onAction: (video) => void changeLibraryState(video, collection === "active" ? "archived" : "active"),
            } : undefined}
          />
          {page.total > LIBRARY_PAGE_SIZE ? (
            <div className={styles.paging}>
              <span />
              <div className={styles.actions}>
                {page.visible.length > LIBRARY_PAGE_SIZE ? (
                  <button type="button" className="btn-secondary" onClick={() => setVisibleLimit(LIBRARY_PAGE_SIZE)}>
                    Latest {LIBRARY_PAGE_SIZE}
                  </button>
                ) : null}
                {page.remaining > 0 ? (
                  <button type="button" className="btn-secondary" onClick={() => setVisibleLimit(page.visible.length + page.nextBatchSize)}>
                    Show next {page.nextBatchSize}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
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

function LibraryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "attention" | "ready" }) {
  return <div data-tone={tone}><dt>{label}</dt><dd>{value}</dd></div>;
}
