"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { fmtDateTime } from "@/lib/format";
import { IconExternal } from "@/components/icons";
import styles from "./ThumbnailRefreshInventoryPanel.module.css";
import { THUMBNAIL_REFRESH_MAXIMUM_COST_USD } from "@/lib/thumbnailRefreshCandidate";
import type { LegacyVideoRetirementReason } from "@/lib/legacyVideoCleanup";

type InventoryStatus =
  | "current_golden_candidate"
  | "legacy_unverified"
  | "evidence_invalid"
  | "missing_thumbnail";

type ThumbnailReplayStatus =
  | "ready_for_thumbnail_only"
  | "ready_for_private_successor"
  | "private_successor_unavailable";

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
  legacyCleanupAction: "keep" | "retire";
  legacyCleanupReason: string;
  legacyCleanupExplanation: string;
  retirement?: {
    id: string;
    status?: "awaiting_approval" | "pending" | "queued" | "deleted" | "blocked";
    error?: string;
    verified: boolean;
  };
  candidate?: {
    runId: string;
    status: string;
    dispatchState?: CandidateDispatchState;
    error?: string;
    costTotal: number;
    thumbnailPresent: boolean;
  };
  replacement?: {
    id: string;
    status?: "awaiting_approval" | "pending" | "queued" | "applied" | "blocked";
    error?: string;
    verified: boolean;
    appliedAt?: number;
  };
}>;

type ErnieBatchPreview = Readonly<{
  sourceRunId: string;
  channelSlug: string;
  channelName: string;
  title: string;
  youtubeVideoId: string;
  previewUrl: string;
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

function isLofiChannel(row: Pick<ThumbnailInventoryRow, "channelName" | "channelSlug">): boolean {
  return /lo[\s-]?fi/i.test(`${row.channelName} ${row.channelSlug}`);
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
  const [ernieBatch, setErnieBatch] = useState<readonly ErnieBatchPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyRunIds, setBusyRunIds] = useState<Set<string>>(() => new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [retirementRunId, setRetirementRunId] = useState<string | null>(null);
  const [retirementConfirmation, setRetirementConfirmation] = useState("");
  const [replacementRunId, setReplacementRunId] = useState<string | null>(null);
  const [replacementConfirmation, setReplacementConfirmation] = useState("");
  const [ernieBatchBusy, setErnieBatchBusy] = useState(false);
  const [lofiFrameBatchBusy, setLofiFrameBatchBusy] = useState(false);

  const loadInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/thumbnail-refresh?ernieBatch=reviewed", { cache: "no-store", signal });
    const payload = await response.json() as {
      ok?: boolean;
      inventory?: ThumbnailInventoryRow[];
      ernieBatch?: { candidates?: ErnieBatchPreview[] };
      error?: string;
    };
    if (!response.ok || !payload.ok || !Array.isArray(payload.inventory)) {
      throw new Error(payload.error || "Could not load thumbnail review inventory");
    }
    setInventory(payload.inventory);
    setErnieBatch(Array.isArray(payload.ernieBatch?.candidates) ? payload.ernieBatch.candidates : []);
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
  const hasActiveRetirement = inventory?.some((row) =>
    row.retirement && ["pending", "queued"].includes(row.retirement.status ?? ""),
  ) ?? false;
  const hasActiveReplacement = inventory?.some((row) =>
    row.replacement && ["pending", "queued"].includes(row.replacement.status ?? ""),
  ) ?? false;

  useEffect(() => {
    if (!hasActiveCandidate && !hasActiveRetirement && !hasActiveReplacement) return;
    const timer = window.setInterval(() => {
      void loadInventory().catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveCandidate, hasActiveReplacement, hasActiveRetirement, loadInventory]);

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

  const retireVideo = async (row: ThumbnailInventoryRow) => {
    if (
      !row.youtubeVideoId ||
      row.legacyCleanupAction !== "retire" ||
      retirementConfirmation !== row.youtubeVideoId ||
      busyRunIds.has(row.runId)
    ) return;
    setBusyRunIds((current) => new Set(current).add(row.runId));
    setActionMessage(null);
    try {
      const response = await fetch("/api/youtube-video-retire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: row.runId,
          youtubeVideoId: row.youtubeVideoId,
          reason: row.legacyCleanupReason as LegacyVideoRetirementReason,
          confirmPermanentDeletion: retirementConfirmation,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not queue permanent removal");
      }
      setActionMessage(`Permanent removal queued for “${row.title}”. Ownership will be rechecked first.`);
      setRetirementRunId(null);
      setRetirementConfirmation("");
      await loadInventory();
    } catch (retirementError) {
      setActionMessage(retirementError instanceof Error
        ? retirementError.message
        : "Could not queue permanent removal");
    } finally {
      setBusyRunIds((current) => {
        const next = new Set(current);
        next.delete(row.runId);
        return next;
      });
    }
  };

  const applyCandidate = async (row: ThumbnailInventoryRow) => {
    if (
      !row.youtubeVideoId ||
      !row.candidate ||
      row.candidate.status !== "ok" ||
      replacementConfirmation !== row.youtubeVideoId ||
      busyRunIds.has(row.runId)
    ) return;
    setBusyRunIds((current) => new Set(current).add(row.runId));
    setActionMessage(null);
    try {
      const response = await fetch("/api/thumbnail-refresh/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceRunId: row.runId,
          candidateRunId: row.candidate.runId,
          youtubeVideoId: row.youtubeVideoId,
          confirmYoutubeVideoId: replacementConfirmation,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not apply the thumbnail");
      }
      setActionMessage(`YouTube update queued for “${row.title}”. The exact account and candidate will be rechecked.`);
      setReplacementRunId(null);
      setReplacementConfirmation("");
      await loadInventory();
    } catch (replacementError) {
      setActionMessage(replacementError instanceof Error
        ? replacementError.message
        : "Could not apply the thumbnail");
    } finally {
      setBusyRunIds((current) => {
        const next = new Set(current);
        next.delete(row.runId);
        return next;
      });
    }
  };

  const queueReviewedErnieBatch = async () => {
    if (ernieBatchBusy) return;
    setErnieBatchBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/thumbnail-refresh/ernie-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmReplaceAll: "APPLY 30" }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; batchCount?: number };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not queue the reviewed ERNIE thumbnail batch");
      }
      setActionMessage(`${payload.batchCount ?? 30} reviewed native ERNIE thumbnails queued for exact YouTube video bindings.`);
      await loadInventory();
    } catch (batchError) {
      setActionMessage(batchError instanceof Error
        ? batchError.message
        : "Could not queue the reviewed ERNIE thumbnail batch");
    } finally {
      setErnieBatchBusy(false);
    }
  };

  const rows = useMemo(
    () => inventory?.filter((row) => !selectedChannelSlug || row.channelSlug === selectedChannelSlug) ?? [],
    [inventory, selectedChannelSlug],
  );
  const reviewedErniePreviews = useMemo(
    () => ernieBatch.filter((item) => !selectedChannelSlug || item.channelSlug === selectedChannelSlug),
    [ernieBatch, selectedChannelSlug],
  );
  const counts = inventoryCounts(rows);
  const reviewCount = counts.legacy_unverified + counts.evidence_invalid + counts.missing_thumbnail;
  const retirementCount = rows.filter((row) => row.legacyCleanupAction === "retire" && row.retirement?.status !== "deleted").length;
  const visible = showAll ? rows : rows.slice(0, 6);
  const lofiFrameCandidates = rows.filter((row) =>
    isLofiChannel(row) &&
    row.legacyCleanupAction !== "retire" &&
    row.refreshAction === "owner_review_required" &&
    row.thumbnailReplayStatus !== "private_successor_unavailable" &&
    !row.candidate,
  );

  const queueLofiFrameCandidates = async () => {
    if (lofiFrameBatchBusy || !lofiFrameCandidates.length) return;
    const candidateIds = new Set(lofiFrameCandidates.map((row) => row.runId));
    setLofiFrameBatchBusy(true);
    setBusyRunIds((current) => new Set([...current, ...candidateIds]));
    setActionMessage(null);
    const queued: string[] = [];
    const failed: string[] = [];
    try {
      // Deliberately submit one owner-bound candidate per retained run. Each
      // server request revalidates the exact finished video and therefore
      // cannot convert this convenience action into a generic artwork batch.
      for (const row of lofiFrameCandidates) {
        try {
          const response = await fetch("/api/thumbnail-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceRunId: row.runId, confirmCandidateSpend: true }),
          });
          const payload = await response.json() as { ok?: boolean; error?: string };
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Could not queue the Lo-Fi frame candidate");
          }
          queued.push(row.title);
        } catch (error) {
          failed.push(`${row.title}: ${error instanceof Error ? error.message : "candidate was not queued"}`);
        }
      }
      const summary = queued.length
        ? `${queued.length} Lo-Fi render-frame ${queued.length === 1 ? "candidate" : "candidates"} queued from the retained finished videos.`
        : "No Lo-Fi render-frame candidates were queued.";
      setActionMessage(failed.length ? `${summary} ${failed[0]}` : summary);
      await loadInventory();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Could not refresh the Lo-Fi frame candidates");
    } finally {
      setLofiFrameBatchBusy(false);
      setBusyRunIds((current) => {
        const next = new Set(current);
        for (const runId of candidateIds) next.delete(runId);
        return next;
      });
    }
  };

  return (
    <section className={`${styles.section} glass`} aria-labelledby="thumbnail-review-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Saved uploads</p>
          <h2 id="thumbnail-review-title">Packaging queue</h2>
          <p>Keep, rebuild, or remove older uploads. Every action uses the exact saved run.</p>
        </div>
        <div className={styles.counts} aria-label="Thumbnail evidence totals">
          <span data-tone="review"><small>Needs review</small><strong>{inventory === null ? "—" : reviewCount}</strong></span>
          <span data-tone="warning"><small>Remove</small><strong>{inventory === null ? "—" : retirementCount}</strong></span>
          <span data-tone="ready"><small>Current proof</small><strong>{inventory === null ? "—" : counts.current_golden_candidate}</strong></span>
        </div>
      </header>

      <div className={styles.ernieBatch}>
        <div>
          <span className={styles.ernieBatchMark} aria-hidden="true">E</span>
          <strong>Reviewed ERNIE batch</strong>
          <small>30 native images · exact video bindings</small>
        </div>
        <button
          type="button"
          className={styles.ernieBatchAction}
          disabled={ernieBatchBusy}
          onClick={() => void queueReviewedErnieBatch()}
        >{ernieBatchBusy ? "Queueing…" : "Replace all 30 now"}</button>
      </div>

      {lofiFrameCandidates.length ? (
        <div className={styles.lofiFrameBatch}>
          <div>
            <span className={styles.lofiFrameMark} aria-hidden="true">4K</span>
            <strong>Lo-Fi source-frame refresh</strong>
            <small>{lofiFrameCandidates.length} retained render{lofiFrameCandidates.length === 1 ? "" : "s"} · no generated scene</small>
          </div>
          <button
            type="button"
            className={styles.lofiFrameAction}
            disabled={lofiFrameBatchBusy}
            onClick={() => void queueLofiFrameCandidates()}
          >{lofiFrameBatchBusy
            ? "Queueing frames…"
            : `Render ${lofiFrameCandidates.length} exact frame${lofiFrameCandidates.length === 1 ? "" : "s"} · ≤$${(lofiFrameCandidates.length * THUMBNAIL_REFRESH_MAXIMUM_COST_USD).toFixed(2)}`}</button>
        </div>
      ) : null}

      {reviewedErniePreviews.length ? (
        <section className={styles.ernieGallery} aria-label="Reviewed native ERNIE thumbnails">
          <header>
            <span>New thumbnails</span>
            <small>{reviewedErniePreviews.length} reviewed</small>
          </header>
          <div className={styles.ernieGalleryRail}>
            {reviewedErniePreviews.map((item) => (
              <article className={styles.ernieGalleryCard} key={item.sourceRunId}>
                <a
                  href={`https://www.youtube.com/watch?v=${item.youtubeVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Preview replacement for ${item.title}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={`${item.title} new thumbnail`} loading="lazy" decoding="async" />
                </a>
                <div>
                  <strong title={item.title}>{item.title}</strong>
                  <Link href={`/channels/${item.channelSlug}`}>{item.channelName}</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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
            const lofiSourceFrame = isLofiChannel(row);
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
                      : row.thumbnailReplayStatus === "ready_for_private_successor"
                        ? "Current thumbnail module snapshotted. "
                        : "Thumbnail candidate is unavailable. "}
                    {row.thumbnailReplayReason}
                  </p>
                  {row.legacyCleanupAction === "retire" ? (
                    <p className={styles.retirementReason}>{row.legacyCleanupExplanation}</p>
                  ) : null}
                  <div className={styles.meta}>
                    {row.channelSlug ? <Link href={`/channels/${row.channelSlug}`}>{row.channelName}</Link> : <span>{row.channelName}</span>}
                    <span>{fmtDateTime(row.createdAt)}</span>
                    <span>{row.thumbnailPresent ? "thumbnail retained" : "no thumbnail asset"}</span>
                    <span>master proof: {row.releaseEvidenceStatus.replaceAll("_", " ")}</span>
                    <span>
                      {row.thumbnailReplayStatus === "ready_for_thumbnail_only"
                        ? "exact thumbnail replay eligible"
                        : row.thumbnailReplayStatus === "ready_for_private_successor"
                          ? "private successor ready"
                          : "channel setup required"}
                    </span>
                    {row.candidate ? (
                      <span>candidate: {row.candidate.status.replaceAll("_", " ")} · ${row.candidate.costTotal.toFixed(2)}</span>
                    ) : null}
                    {row.retirement ? <span>removal: {row.retirement.status?.replaceAll("_", " ")}</span> : null}
                  </div>
                </div>
                <div className={styles.actions}>
                  {row.legacyCleanupAction !== "retire" && row.refreshAction === "owner_review_required" && row.thumbnailReplayStatus !== "private_successor_unavailable" && !row.candidate ? (
                    <button
                      type="button"
                      className={styles.generateAction}
                      disabled={busyRunIds.has(row.runId)}
                      onClick={() => void createCandidate(row)}
                    >
                      {busyRunIds.has(row.runId)
                        ? "Reserving candidate…"
                        : `${lofiSourceFrame
                          ? "Render exact video frame"
                          : row.thumbnailReplayStatus === "ready_for_private_successor"
                            ? "Render private successor"
                            : "Render new candidate"} · ≤$${THUMBNAIL_REFRESH_MAXIMUM_COST_USD.toFixed(2)}`}
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
                  {row.replacement?.status === "applied" && row.replacement.verified ? (
                    <span className={styles.replacementDone}>Live on YouTube · receipt verified</span>
                  ) : null}
                  {row.replacement && ["pending", "queued"].includes(row.replacement.status ?? "") ? (
                    <span className={styles.candidateProgress} role="status">
                      <i aria-hidden="true" />Account check + YouTube update
                    </span>
                  ) : null}
                  {row.replacement?.status === "blocked" ? (
                    <span className={styles.candidateFailed}>{row.replacement.error ?? "YouTube update blocked"}</span>
                  ) : null}
                  {row.candidate?.status === "ok" && row.youtubeVideoId && !row.replacement && replacementRunId !== row.runId ? (
                    <button
                      type="button"
                      className={styles.acceptAction}
                      onClick={() => {
                        setReplacementRunId(row.runId);
                        setReplacementConfirmation("");
                      }}
                    >Use on YouTube</button>
                  ) : null}
                  {row.candidate?.status === "ok" && row.youtubeVideoId && !row.replacement && replacementRunId === row.runId ? (
                    <div className={styles.acceptConfirm}>
                      <label htmlFor={`accept-${row.runId}`}>Confirm video <code>{row.youtubeVideoId}</code></label>
                      <input
                        id={`accept-${row.runId}`}
                        value={replacementConfirmation}
                        onChange={(event) => setReplacementConfirmation(event.target.value.trim())}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        disabled={replacementConfirmation !== row.youtubeVideoId || busyRunIds.has(row.runId)}
                        onClick={() => void applyCandidate(row)}
                      >Apply thumbnail</button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplacementRunId(null);
                          setReplacementConfirmation("");
                        }}
                      >Cancel</button>
                    </div>
                  ) : null}
                  {row.candidate?.status === "failed" ? (
                    <span className={styles.candidateFailed}>Candidate stopped — inspect evidence</span>
                  ) : null}
                  {row.candidate ? (
                    <Link href={`/runs/${row.candidate.runId}`} className={styles.action}>Inspect candidate</Link>
                  ) : null}
                  {row.legacyCleanupAction === "retire" && row.retirement?.status === "deleted" ? (
                    <span className={styles.retirementDone}>Removed · absence verified</span>
                  ) : null}
                  {row.legacyCleanupAction === "retire" && row.retirement && ["pending", "queued"].includes(row.retirement.status ?? "") ? (
                    <span className={styles.candidateProgress} role="status">
                      <i aria-hidden="true" />Ownership check + removal
                    </span>
                  ) : null}
                  {row.legacyCleanupAction === "retire" && row.retirement?.status === "blocked" ? (
                    <span className={styles.candidateFailed}>{row.retirement.error ?? "Removal blocked"}</span>
                  ) : null}
                  {row.legacyCleanupAction === "retire" && !row.retirement && retirementRunId !== row.runId ? (
                    <button
                      type="button"
                      className={styles.retireAction}
                      onClick={() => {
                        setRetirementRunId(row.runId);
                        setRetirementConfirmation("");
                      }}
                    >Review permanent removal</button>
                  ) : null}
                  {row.legacyCleanupAction === "retire" && !row.retirement && retirementRunId === row.runId && row.youtubeVideoId ? (
                    <div className={styles.retireConfirm}>
                      <label htmlFor={`retire-${row.runId}`}>Type <code>{row.youtubeVideoId}</code></label>
                      <input
                        id={`retire-${row.runId}`}
                        value={retirementConfirmation}
                        onChange={(event) => setRetirementConfirmation(event.target.value.trim())}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        disabled={retirementConfirmation !== row.youtubeVideoId || busyRunIds.has(row.runId)}
                        onClick={() => void retireVideo(row)}
                      >Permanently delete</button>
                      <button
                        type="button"
                        onClick={() => {
                          setRetirementRunId(null);
                          setRetirementConfirmation("");
                        }}
                      >Cancel</button>
                    </div>
                  ) : null}
                  <Link href={`/runs/${row.runId}`} className={styles.action}>Inspect run</Link>
                  {row.channelSlug && row.refreshAction === "owner_review_required" && row.legacyCleanupAction !== "retire" ? (
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
