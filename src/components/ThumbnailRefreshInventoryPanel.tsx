"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { fmtDateTime } from "@/lib/format";
import { IconExternal } from "@/components/icons";
import styles from "./ThumbnailRefreshInventoryPanel.module.css";

type InventoryStatus =
  | "current_golden_candidate"
  | "legacy_unverified"
  | "evidence_invalid"
  | "missing_thumbnail";

type ThumbnailReplayStatus =
  | "ready_for_thumbnail_only"
  | "requires_private_successor";

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

function ThumbnailRefreshPreview({ row }: { row: ThumbnailInventoryRow }) {
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [storedPreviewFailed, setStoredPreviewFailed] = useState(false);

  useEffect(() => {
    let current = true;
    if (!row.thumbnailPresent) {
      return () => { current = false; };
    }
    void fetch(`/api/thumbnail-refresh?previewRunId=${encodeURIComponent(row.runId)}`, { cache: "no-store" })
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
  }, [row.runId, row.thumbnailPresent]);

  const fallback = row.youtubeVideoId ? youtubeThumbnailUrl(row.youtubeVideoId) : null;
  const src = storedUrl && !storedPreviewFailed ? storedUrl : fallback;
  const source = storedUrl && !storedPreviewFailed
    ? "retained candidate"
    : fallback
      ? "current YouTube image"
      : "no image retained";

  return (
    <div
      className={styles.preview}
      data-preview-source={source === "retained candidate" ? "retained" : fallback ? "youtube" : "unavailable"}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${row.title} thumbnail preview`}
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
 * A read-only, owner-authenticated review queue. It never turns a legacy row
 * into a candidate, renders a thumbnail, or updates a YouTube video; those
 * are deliberate future approvals after the retained evidence is reviewed.
 */
export function ThumbnailRefreshInventoryPanel({
  selectedChannelSlug,
}: {
  selectedChannelSlug?: string | null;
}) {
  const [inventory, setInventory] = useState<readonly ThumbnailInventoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const response = await fetch("/api/thumbnail-refresh", { cache: "no-store" });
        const payload = await response.json() as {
          ok?: boolean;
          inventory?: ThumbnailInventoryRow[];
          error?: string;
        };
        if (!response.ok || !payload.ok || !Array.isArray(payload.inventory)) {
          throw new Error(payload.error || "Could not load thumbnail review inventory");
        }
        if (current) setInventory(payload.inventory);
      } catch {
        if (current) setError("Thumbnail review inventory is unavailable right now.");
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, []);

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
          <p className={styles.eyebrow}>Legacy output review</p>
          <h2 id="thumbnail-review-title">Thumbnail evidence queue</h2>
          <p>
            See which finished videos retain current thumbnail provenance before creating a candidate. A thumbnail can update the existing YouTube video after review; a rebuilt video must become a separate private successor draft because YouTube does not replace media in place. Legacy never means replace automatically.
          </p>
        </div>
        <div className={styles.counts} aria-label="Thumbnail evidence totals">
          <span data-tone="review"><strong>{inventory === null ? "—" : reviewCount}</strong> review</span>
          <span data-tone="ready"><strong>{inventory === null ? "—" : counts.current_golden_candidate}</strong> current</span>
        </div>
      </header>

      {inventory === null && !error ? <p className={styles.state}>Loading retained thumbnail evidence…</p> : null}
      {error ? <p className={styles.state} role="status">{error}</p> : null}
      {inventory !== null && rows.length === 0 ? (
        <p className={styles.state}>No finished videos match this channel selection yet.</p>
      ) : null}

      {visible.length ? (
        <div className={styles.list}>
          {visible.map((row) => {
            const display = STATUS_COPY[row.thumbnailEvidenceStatus];
            return (
              <article className={styles.row} key={row.runId}>
                <ThumbnailRefreshPreview row={row} />
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
                  </div>
                </div>
                <div className={styles.actions}>
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
