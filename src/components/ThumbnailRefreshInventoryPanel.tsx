"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { fmtDateTime } from "@/lib/format";
import { IconExternal } from "@/components/icons";
import styles from "./ThumbnailRefreshInventoryPanel.module.css";
import { THUMBNAIL_REFRESH_MAXIMUM_COST_USD } from "@/lib/thumbnailRefreshCandidate";

type InventoryStatus =
  | "current_golden_candidate"
  | "legacy_unverified"
  | "evidence_invalid"
  | "missing_thumbnail";

type ThumbnailReplayStatus =
  | "ready_for_thumbnail_only"
  | "requires_private_successor";

type CandidateDispatchState =
  | "awaiting_approval"
  | "pending"
  | "queued"
  | "consumed"
  | "blocked";

type ThumbnailInventoryRow = Readonly<{
  runId: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  title: string;
  createdAt: number;
  status: string;
  youtubeVideoId: string | null;
  thumbnailPresent: boolean;
  thumbnailEvidenceStatus: InventoryStatus;
  refreshAction: "no_refresh_action" | "owner_review_required";
  evidenceReason: string;
  releaseEvidenceStatus: string;
  thumbnailReplayStatus: ThumbnailReplayStatus;
  thumbnailReplayReason: string;
  candidate?: {
    runId: string;
    status: string;
    dispatchState?: CandidateDispatchState;
    error?: string;
    costTotal: number;
    thumbnailPresent: boolean;
  };
}>;

const STATUS_COPY: Record<InventoryStatus, { label: string; tone: string }> = {
  current_golden_candidate: { label: "Current candidate recorded", tone: "ready" },
  legacy_unverified: { label: "Legacy review needed", tone: "review" },
  evidence_invalid: { label: "Evidence needs repair", tone: "warning" },
  missing_thumbnail: { label: "No thumbnail recorded", tone: "warning" },
};

function inventoryCounts(rows: readonly ThumbnailInventoryRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.thumbnailEvidenceStatus] += 1;
      return counts;
    },
    {
      current_golden_candidate: 0,
      legacy_unverified: 0,
      evidence_invalid: 0,
      missing_thumbnail: 0,
    } satisfies Record<InventoryStatus, number>,
  );
}

function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function ThumbnailRefreshPreview({
  row,
  candidate = false,
}: {
  row: ThumbnailInventoryRow;
  candidate?: boolean;
}) {
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [storedPreviewFailed, setStoredPreviewFailed] = useState(false);
  const previewPresent = candidate ? Boolean(row.candidate?.thumbnailPresent) : row.thumbnailPresent;
  const previewRunId = candidate ? row.candidate?.runId : row.runId;

  useEffect(() => {
    let current = true;
    if (!previewPresent || !previewRunId) {
      return () => { current = false; };
    }
    const previewHref = candidate
      ? `/api/thumbnail-refresh?candidatePreviewRunId=${encodeURIComponent(previewRunId)}`
      : `/api/thumbnail-refresh?previewRunId=${encodeURIComponent(previewRunId)}`;
    void fetch(previewHref, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; preview?: { url?: string } };
        if (!response.ok || !payload.ok || typeof payload.preview?.url !== "string") return null;
        return payload.preview.url;
      })
      .then((url) => {
        if (current) setStoredUrl(url);
      })
      .catch(() => {
        // The public YouTube image below remains an honest fallback; do not
        // turn one failed retained-object preview into a queue-level error.
      });
    return () => { current = false; };
  }, [candidate, previewPresent, previewRunId]);

  const fallback = !candidate && row.youtubeVideoId ? youtubeThumbnailUrl(row.youtubeVideoId) : null;
  const src = storedUrl && !storedPreviewFailed ? storedUrl : fallback;
  const source = storedUrl && !storedPreviewFailed
      ? candidate ? "new candidate" : "retained candidate"
    : fallback
      ? "current YouTube image"
      : "no image retained";

  return (
    <div
      className={styles.preview}
      data-preview-source={source === "new candidate" ? "candidate" : source === "retained candidate" ? "retained" : fallback ? "youtube" : "unavailable"}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${row.title} ${candidate ? "new candidate" : "current thumbnail"} preview`}
          loading="lazy"
          decoding="async"
          onError={() => setStoredPreviewFailed(true)}
        />
      ) : (
        <span className={styles.previewEmpty}>No preview retained</span>
      )}
      <span className={styles.previewSource}>{source}</span>
    </div>
  );
}

/**
 * Owner-authenticated packaging evidence queue. This view does not pretend a
 * legacy row is ready: it proves whether an exact thumbnail-only replay is
 * possible before a separate, bounded candidate action can spend.
 */
export function ThumbnailRefreshInventoryPanel({
  selectedChannelSlug,
}: {
  selectedChannelSlug?: string | null;
}) {
  const [inventory, setInventory] = useState<readonly ThumbnailInventoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyRunIds, setBusyRunIds] = useState<Set<string>>(() => new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/thumbnail-refresh", { cache: "no-store", signal });
    const payload = await response.json() as {
      ok?: boolean;
      inventory?: ThumbnailInventoryRow[];
      error?: string;
    };
    if (!response.ok || !payload.ok || !Array.isArray(payload.inventory)) {
      throw new Error(payload.error || "Could not load thumbnail review inventory");
    }
    setInventory(payload.inventory);
    setError(null);
    return payload.inventory;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadInventory(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError("Thumbnail review inventory is unavailable right now.");
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadInventory]);

  const hasActiveCandidate = inventory?.some((row) =>
    row.candidate &&
    (["queued", "running"].includes(row.candidate.status) ||
      ["pending", "queued"].includes(row.candidate.dispatchState ?? "")),
  ) ?? false;

  useEffect(() => {
    if (!hasActiveCandidate) return;
    const timer = window.setInterval(() => {
      void loadInventory().catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveCandidate, loadInventory]);

  const createCandidate = async (row: ThumbnailInventoryRow) => {
    const canResumeDispatch = row.candidate &&
      ["awaiting_approval", "pending"].includes(row.candidate.dispatchState ?? "");
    if (busyRunIds.has(row.runId) || (row.candidate && !canResumeDispatch)) return;
    setBusyRunIds((current) => new Set(current).add(row.runId));
    setActionMessage(null);
    try {
      const response = await fetch("/api/thumbnail-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRunId: row.runId, confirmCandidateSpend: true }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not queue thumbnail candidate");
      }
      setActionMessage(
        `${row.candidate ? "Candidate delivery resumed" : "Candidate queued"} for “${row.title}”. ` +
        "The current thumbnail is unchanged.",
      );
      await loadInventory();
    } catch (candidateError) {
      setActionMessage(candidateError instanceof Error ? candidateError.message : "Could not queue thumbnail candidate");
    } finally {
      setBusyRunIds((current) => {
        const next = new Set(current);
        next.delete(row.runId);
        return next;
      });
    }
  };

  const rows = useMemo(
    () => inventory?.filter((row) => !selectedChannelSlug || row.channelSlug === selectedChannelSlug) ?? [],
    [inventory, selectedChannelSlug],
  );
  const counts = inventoryCounts(rows);
  const reviewCount = counts.legacy_unverified + counts.evidence_invalid + counts.missing_thumbnail;
  const visible = showAll ? rows : rows.slice(0, 6);

  return (
    <section className={`${styles.section} glass`} aria-labelledby="thumbnail-review-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Packaging evidence / retained inputs</p>
          <h2 id="thumbnail-review-title">Thumbnail review queue</h2>
          <p>
            First prove what can be replayed safely. A reviewed thumbnail may update the existing YouTube video; rebuilt media must become a separate private successor draft because YouTube cannot replace video bytes in place. Legacy never means replace automatically.
          </p>
        </div>
        <div className={styles.counts} aria-label="Thumbnail evidence totals">
          <span data-tone="review"><small>Needs review</small><strong>{inventory === null ? "—" : reviewCount}</strong></span>
          <span data-tone="ready"><small>Current proof</small><strong>{inventory === null ? "—" : counts.current_golden_candidate}</strong></span>
        </div>
      </header>

      {inventory === null && !error ? <p className={styles.state}>Loading retained thumbnail evidence…</p> : null}
      {error ? <p className={styles.state} role="status">{error}</p> : null}
      {actionMessage ? <p className={styles.actionMessage} role="status">{actionMessage}</p> : null}
      {inventory !== null && rows.length === 0 ? (
        <p className={styles.state}>No finished videos match this channel selection yet.</p>
      ) : null}

      {visible.length ? (
        <div className={styles.list}>
          {visible.map((row) => {
            const display = STATUS_COPY[row.thumbnailEvidenceStatus];
            const dispatchCanResume = row.candidate &&
              ["awaiting_approval", "pending"].includes(row.candidate.dispatchState ?? "");
            const candidateProgressCopy = row.candidate?.status === "running"
              ? "Generating + quality checking"
              : row.candidate?.dispatchState === "awaiting_approval"
                ? "Candidate authorization interrupted"
                : row.candidate?.dispatchState === "pending"
                  ? "Delivery recovery pending"
                  : "Worker queued";
            return (
              <article className={styles.row} key={row.runId}>
                <div className={styles.previewStack} data-has-candidate={row.candidate ? "true" : undefined}>
                  <ThumbnailRefreshPreview row={row} />
                  {row.candidate ? <ThumbnailRefreshPreview row={row} candidate /> : null}
                </div>
                <div className={styles.rowCopy}>
                  <span className={styles.status} data-tone={display.tone}>{display.label}</span>
                  <h3>{row.title}</h3>
                  <p>{row.evidenceReason}</p>
                  <p>
                    {row.thumbnailReplayStatus === "ready_for_thumbnail_only"
                      ? "Exact thumbnail inputs retained. "
                      : "Thumbnail-only replay is not safe. "}
                    {row.thumbnailReplayReason}
                  </p>
                  <div className={styles.meta}>
                    {row.channelSlug ? <Link href={`/channels/${row.channelSlug}`}>{row.channelName}</Link> : <span>{row.channelName}</span>}
                    <span>{fmtDateTime(row.createdAt)}</span>
                    <span>{row.thumbnailPresent ? "thumbnail retained" : "no thumbnail asset"}</span>
                    <span>master proof: {row.releaseEvidenceStatus.replaceAll("_", " ")}</span>
                    <span>
                      {row.thumbnailReplayStatus === "ready_for_thumbnail_only"
                        ? "exact thumbnail replay eligible"
                        : "private successor required"}
                    </span>
                    {row.candidate ? (
                      <span>candidate: {row.candidate.status.replaceAll("_", " ")} · ${row.candidate.costTotal.toFixed(2)}</span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.actions}>
                  {row.refreshAction === "owner_review_required" && row.thumbnailReplayStatus === "ready_for_thumbnail_only" && !row.candidate ? (
                    <button
                      type="button"
                      className={styles.generateAction}
                      disabled={busyRunIds.has(row.runId)}
                      onClick={() => void createCandidate(row)}
                    >
                      {busyRunIds.has(row.runId)
                        ? "Reserving candidate…"
                        : `Render new candidate · ≤$${THUMBNAIL_REFRESH_MAXIMUM_COST_USD.toFixed(2)}`}
                    </button>
                  ) : null}
                  {dispatchCanResume ? (
                    <button
                      type="button"
                      className={styles.generateAction}
                      disabled={busyRunIds.has(row.runId)}
                      onClick={() => void createCandidate(row)}
                    >
                      {busyRunIds.has(row.runId) ? "Resuming delivery…" : "Resume candidate delivery"}
                    </button>
                  ) : null}
                  {row.candidate &&
                  (["queued", "running"].includes(row.candidate.status) || dispatchCanResume) ? (
                    <span className={styles.candidateProgress} role="status">
                      <i aria-hidden="true" />
                      {candidateProgressCopy}
                    </span>
                  ) : null}
                  {row.candidate?.status === "ok" ? (
                    <span className={styles.candidateReady}>Candidate ready for comparison</span>
                  ) : null}
                  {row.candidate?.status === "failed" ? (
                    <span className={styles.candidateFailed}>Candidate stopped — inspect evidence</span>
                  ) : null}
                  {row.candidate ? (
                    <Link href={`/runs/${row.candidate.runId}`} className={styles.action}>Inspect candidate</Link>
                  ) : null}
                  <Link href={`/runs/${row.runId}`} className={styles.action}>Inspect run</Link>
                  {row.channelSlug && row.refreshAction === "owner_review_required" ? (
                    <Link
                      href={`/channels/${row.channelSlug}#route-qualification-benchmark`}
                      className={styles.action}
                    >Open private benchmark</Link>
                  ) : null}
                  {row.youtubeVideoId ? (
                    <a
                      href={`https://www.youtube.com/watch?v=${row.youtubeVideoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.action}
                    >
                      Watch <IconExternal width={12} height={12} />
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {rows.length > visible.length ? (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          Show {rows.length - visible.length} more records
        </button>
      ) : null}
      {showAll && rows.length > 6 ? (
        <button type="button" className={styles.more} onClick={() => setShowAll(false)}>
          Show fewer records
        </button>
      ) : null}
    </section>
  );
}
