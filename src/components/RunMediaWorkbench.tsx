"use client";

import { useState } from "react";
import { useAssetUrlState } from "@/lib/asset-url";
import {
  assetLabel,
  fileName,
  mediaFacts,
  mediaType,
  orderRunMedia,
  selectedRunMaster,
  summarizeStageReceipts,
  visibleRunMedia,
  type MediaType,
  type RunMediaAsset,
  type RunStageReceipt,
} from "@/lib/runMediaWorkbench";
import styles from "./RunMediaWorkbench.module.css";

export type { RunMediaAsset, RunStageReceipt } from "@/lib/runMediaWorkbench";

export function RunMediaWorkbench({
  assets,
  stages,
  runStatus,
  selectedVideoAssetId,
}: {
  assets: readonly RunMediaAsset[] | undefined;
  stages: readonly RunStageReceipt[] | undefined;
  runStatus: string;
  selectedVideoAssetId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = assets ? orderRunMedia(assets) : [];
  const selectedMaster = selectedRunMaster(ordered, selectedVideoAssetId);
  const visible = visibleRunMedia(ordered, selectedMaster, showAll);
  const hiddenCount = Math.max(0, ordered.length - visible.length);
  const stageState = summarizeStageReceipts(stages);
  const isActiveRun = runStatus === "running" || runStatus === "queued";

  return (
    <section className={styles.section} aria-labelledby="recorded-work-title">
      <div className={`${styles.shell} glass glass-shine`}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>Assembly & retained work</p>
            <h2 id="recorded-work-title" className={styles.title}>
              Recorded production work
            </h2>
            <p className={styles.subtitle}>
              {isActiveRun
                ? "New media appears here when a stage saves it. These are retained previews, not a live render stream."
                : "Only media bytes retained for this run are shown here; stage receipts remain available in the production map below."}
            </p>
          </div>

          <dl className={styles.metrics}>
            <Metric label="Stage receipts" value={stages === undefined ? "…" : String(stages.length)} />
            <Metric label="Verified" value={stageState.verifiedLabel} tone={stageState.tone} />
            <Metric label="Active stage" value={stageState.activeLabel} tone={stageState.tone} />
            <Metric label="Retained media" value={assets === undefined ? "…" : String(ordered.length)} />
          </dl>
        </header>

        {assets === undefined ? (
          <div className={styles.loading} aria-live="polite" aria-busy="true">
            Loading saved media receipts…
          </div>
        ) : ordered.length === 0 ? (
          <div className={styles.empty}>
            <strong>No retained media yet</strong>
            <span>
              Media will appear after a pipeline stage successfully persists it for this run.
            </span>
          </div>
        ) : (
          <>
            <div className={styles.mediaGrid}>
              {visible.map((asset) => (
                <RunMediaAssetCard
                  key={asset._id}
                  asset={asset}
                  selectedMaster={asset._id === selectedMaster?._id}
                />
              ))}
            </div>

            {(hiddenCount > 0 || showAll) && (
              <div className={styles.moreRow}>
                {hiddenCount > 0 && (
                  <span>
                    Showing the newest {visible.length} of {ordered.length} retained media receipts.
                  </span>
                )}
                <button
                  type="button"
                  className={styles.moreButton}
                  onClick={() => setShowAll((current) => !current)}
                >
                  {showAll ? "Show recent work" : `Show all ${ordered.length} receipts`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "active" | "attention" | "complete";
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function RunMediaAssetCard({
  asset,
  selectedMaster,
}: {
  asset: RunMediaAsset;
  selectedMaster: boolean;
}) {
  const source = useAssetUrlState(asset.r2Key);
  const [mediaFailed, setMediaFailed] = useState(false);
  const type = mediaType(asset);
  const facts = mediaFacts(asset.meta);
  const label = assetLabel(asset.kind);

  return (
    <article
      className={`${styles.assetCard} ${selectedMaster ? styles.selectedMaster : ""}`}
      data-media-type={type}
    >
      <div className={styles.preview}>
        {selectedMaster && <span className={styles.masterFlag}>Selected master</span>}
        <MediaPreview
          asset={asset}
          type={type}
          status={source.status}
          url={source.url}
          failed={mediaFailed}
          onMediaError={() => setMediaFailed(true)}
        />
      </div>

      <div className={styles.assetBody}>
        <div className={styles.assetHeading}>
          <div>
            <p className={styles.assetKind}>{label}</p>
            <h3>{fileName(asset.r2Key)}</h3>
          </div>
          {source.url && (
            <a
              className={styles.sourceLink}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source ↗
            </a>
          )}
        </div>

        {facts.length > 0 && (
          <ul className={styles.facts} aria-label={`${label} metadata`}>
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}

        <details className={styles.receiptDetails}>
          <summary>Media receipt</summary>
          <code title={asset.r2Key}>{asset.r2Key}</code>
        </details>
      </div>
    </article>
  );
}

function MediaPreview({
  asset,
  type,
  status,
  url,
  failed,
  onMediaError,
}: {
  asset: RunMediaAsset;
  type: MediaType;
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  failed: boolean;
  onMediaError: () => void;
}) {
  if (status === "loading") {
    return <div className={styles.previewState}>Loading retained preview…</div>;
  }

  if (status === "error") {
    return <div className={styles.previewState}>Preview URL unavailable</div>;
  }

  if (!url || failed) {
    return (
      <div className={styles.previewState}>
        {failed ? "This browser could not play the saved source." : "No previewable source recorded"}
      </div>
    );
  }

  if (type === "image") {
    return (
      // R2 signed URLs are short-lived and not part of the static image optimizer domain set.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={styles.image}
        src={url}
        alt={`Retained ${assetLabel(asset.kind)} for this run`}
        loading="lazy"
        onError={onMediaError}
      />
    );
  }

  if (type === "video") {
    return (
      <video
        className={styles.video}
        controls
        preload="metadata"
        src={url}
        onError={onMediaError}
      >
        Your browser cannot preview this saved video.
      </video>
    );
  }

  if (type === "audio") {
    return (
      <div className={styles.audioPreview}>
        <span>{assetLabel(asset.kind)}</span>
        <audio controls preload="metadata" src={url} onError={onMediaError}>
          Your browser cannot preview this saved audio.
        </audio>
      </div>
    );
  }

  return <div className={styles.previewState}>Saved {assetLabel(asset.kind).toLowerCase()} file</div>;
}
