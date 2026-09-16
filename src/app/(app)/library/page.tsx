"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow, VideoRow } from "@/lib/types";
import { orderLibraryVideos } from "@/lib/libraryOrder";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import { ThumbnailRefreshInventoryPanel } from "@/components/ThumbnailRefreshInventoryPanel";
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
type LibrarySummary = { activeCount: number; archivedCount: number; totalCount: number };
const LIBRARY_LOADING_TIMEOUT_MS = 8_000;
export default function LibraryPage() {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const operationsAccess = useOperationsAccess();

  const videos = useQuery(api.videos.listVideos, { ownerId, limit: 500, includeArchived: true }) as
    | VideoRow[]
    | undefined;
  const summary = useQuery(api.videos.librarySummary, { ownerId }) as LibrarySummary | undefined;
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelRow[]
    | undefined;
  const setLibraryState = useMutation(api.videos.setLibraryState);
  const applyBulkLibraryState = useMutation(api.videos.applyBulkLibraryState);
  const undoBulkLibraryState = useMutation(api.videos.undoBulkLibraryState);

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
  const [changeError, setChangeError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkReceiptId, setBulkReceiptId] = useState<Id<"libraryActionReceipts"> | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
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

    return orderLibraryVideos(out, filters.sort);
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

  const loading = libraryVideos === undefined || channels === undefined || summary === undefined;
  useEffect(() => {
    if (!loading) {
      const reset = window.setTimeout(() => setLoadingTimedOut(false), 0);
      return () => window.clearTimeout(reset);
    }
    const timer = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, LIBRARY_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const activeCount = summary?.activeCount ?? 0;
  const archivedCount = summary?.archivedCount ?? 0;

  const changeLibraryState = async (video: VideoRow, state: CollectionMode) => {
    if (busyIds.has(video._id)) return;
    setChangeError(null);
    setBusyIds((current) => new Set(current).add(video._id));
    try {
      await setLibraryState({
        ownerId,
        runId: video._id as Id<"runs">,
        state,
      });
      setRecentChange({ video, state });
      if (lightbox && filtered[lightbox.index]?._id === video._id) setLightbox(null);
    } catch (error) {
      setChangeError(error instanceof Error ? error.message : "The Library could not save that change.");
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

  const selectCollection = (next: CollectionMode) => {
    setCollection(next);
    setVisibleLimit(LIBRARY_PAGE_SIZE);
    setLightbox(null);
    setRecentChange(null);
    setChangeError(null);
    setSelectedIds(new Set());
    setBulkReceiptId(null);
  };

  const toggleSelected = (video: VideoRow) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(video._id)) next.delete(video._id); else next.add(video._id);
      return next;
    });
  };

  const applyBulk = async () => {
    const runIds = [...selectedIds];
    if (!runIds.length || bulkBusy) return;
    setBulkBusy(true);
    setChangeError(null);
    try {
      const result = await applyBulkLibraryState({
        ownerId,
        runIds: runIds as Id<"runs">[],
        state: collection === "active" ? "archived" : "active",
        actionKey: `library-bulk:${collection}:${runIds.slice().sort().join(",")}:${Date.now()}`,
      });
      setBulkReceiptId(result.actionId);
      setSelectedIds(new Set());
    } catch (error) {
      setChangeError(error instanceof Error ? error.message : "The bulk library action failed.");
    } finally {
      setBulkBusy(false);
    }
  };

  const undoBulk = async () => {
    if (!bulkReceiptId || bulkBusy) return;
    setBulkBusy(true);
    try {
      await undoBulkLibraryState({ ownerId, actionId: bulkReceiptId });
      setBulkReceiptId(null);
    } catch (error) {
      setChangeError(error instanceof Error ? error.message : "Undo failed.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className={styles.library}>
      <PageHeader
        eyebrow="Video library"
        title="Library"
        subtitle="Review, archive, and restore saved masters."
      />

      <div className={styles.libraryDashboard}>
        <section className={styles.collectionBar} aria-label="Library collections">
          <div className={styles.collectionTabs} role="tablist" aria-label="Video collection">
            <button type="button" role="tab" aria-selected={collection === "active"} onClick={() => selectCollection("active")}>
              <span>Active masters</span><strong>{loading ? "—" : activeCount}</strong>
            </button>
            <button type="button" role="tab" aria-selected={collection === "archived"} onClick={() => selectCollection("archived")}>
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
          <LibraryMetric label="Master review" value={loading ? "—" : String(reviewCount)} tone={reviewCount ? "attention" : "ready"} />
        </dl>
      </div>

      {collection === "active" ? (
        <details id="thumbnail-refresh" className={`${styles.packagingWorkshop} glass`}>
          <summary>
            <span className={styles.workshopIcon} aria-hidden="true"><IconSpark width={18} height={18} /></span>
            <span><small>Thumbnail review</small><strong>Exact saved runs</strong></span>
            <p>Private candidates and confirmed replacements.</p>
            <i aria-hidden="true" />
          </summary>
          <div className={styles.workshopBody}>
            <ThumbnailRefreshInventoryPanel
              selectedChannelSlug={selectedSlug}
              canManage={operationsAccess === "owner"}
              canQueueCandidates
            />
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

      {loading && !loadingTimedOut ? (
        <SkeletonList rows={4} />
      ) : loading && loadingTimedOut ? (
        <EmptyState
          title="Library data unavailable"
          description="Refresh to reconnect to saved masters."
          icon={<IconLibrary width={24} height={24} />}
        />
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
          {operationsAccess === "owner" ? (
            <div className={styles.bulkBar} role="toolbar" aria-label="Bulk library actions">
              <button type="button" className="btn-secondary" onClick={() => setSelectedIds(new Set(page.visible.map((video) => video._id)))}>
                Select visible
              </button>
              {selectedIds.size ? <span>{selectedIds.size} selected</span> : <span>Select masters to organize together</span>}
              <button type="button" className="btn-primary" disabled={!selectedIds.size || bulkBusy} onClick={() => void applyBulk()}>
                {bulkBusy ? "Saving…" : collection === "active" ? "Archive selected" : "Restore selected"}
              </button>
            </div>
          ) : null}
          <VideoGrid
            videos={page.visible}
            density="library"
            onOpen={openLightbox}
            selection={operationsAccess === "owner" ? { selectedIds, onToggle: toggleSelected } : undefined}
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
                    Show fewer
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
      {bulkReceiptId ? (
        <aside className={styles.changeToast} role="status">
          <span><strong>{collection === "active" ? "Selected masters archived" : "Selected masters restored"}</strong><small>The exact prior states are saved.</small></span>
          <button type="button" onClick={() => void undoBulk()} disabled={bulkBusy}>Undo</button>
          <button type="button" aria-label="Dismiss" onClick={() => setBulkReceiptId(null)}>×</button>
        </aside>
      ) : null}
      {changeError ? (
        <aside className={styles.changeToast} data-tone="error" role="alert">
          <span><strong>Library change failed</strong><small>{changeError}</small></span>
          <button type="button" onClick={() => setChangeError(null)}>Dismiss</button>
        </aside>
      ) : null}
    </div>
  );
}

function LibraryMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "attention" | "ready" }) {
  return <div data-tone={tone}><dt>{label}</dt><dd>{value}</dd></div>;
}
