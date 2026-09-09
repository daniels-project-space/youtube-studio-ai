"use client";

import { useState } from "react";
import { useAssetUrlState } from "@/lib/asset-url";
import { MediaPreview as CurrentMediaPreview } from "@/components/MediaPreview";
import {
  assetLabel,
  fileName,
  mediaFacts,
  mediaType,
  orderRunMedia,
  partitionRunThumbnailAssets,
  runCurrentThumbnailSource,
  selectedRunMaster,
  summarizeStageReceipts,
  visibleRunMedia,
  type MediaType,
  type RunMediaAsset,
  type RunStageReceipt,
  type RunCurrentThumbnail,
} from "@/lib/runMediaWorkbench";
import styles from "./RunMediaWorkbench.module.css";

export type { RunMediaAsset, RunStageReceipt } from "@/lib/runMediaWorkbench";

export function RunMediaWorkbench({
  assets,
  stages,
  runStatus,
  selectedVideoAssetId,
  currentThumbnail,
}: {
  assets: readonly RunMediaAsset[] | undefined;
  stages: readonly RunStageReceipt[] | undefined;
  runStatus: string;
  selectedVideoAssetId?: string;
  currentThumbnail: RunCurrentThumbnail | null | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const ordered = assets ? orderRunMedia(assets) : [];
  const { media, historicalThumbnails } = partitionRunThumbnailAssets(ordered, currentThumbnail);
  const selectedMaster = selectedRunMaster(media, selectedVideoAssetId);
  const visible = visibleRunMedia(media, selectedMaster, showAll);
  const supporting = visible.filter((asset) => asset._id !== selectedMaster?._id);
  const documents = supporting.filter((asset) => mediaType(asset) === "file");
  const previews = supporting.filter((asset) => mediaType(asset) !== "file");
  const hiddenCount = Math.max(0, media.length - visible.length);
  const stageState = summarizeStageReceipts(stages);
  const isActiveRun = runStatus === "running" || runStatus === "queued";

  return (
    <section className={styles.section} aria-labelledby="recorded-work-title">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>Output</p>
            <h2 id="recorded-work-title" className={styles.title}>
              Media
            </h2>
            <p className={styles.subtitle}>
              {isActiveRun
                ? "Saved output appears as stages finish."
                : "Saved output from this run."}
            </p>
          </div>

          <dl className={styles.metrics}>
            <Metric label="Completed stages" value={stageState.completedLabel} tone={stageState.tone} />
            <Metric label="Skipped" value={stageState.skippedLabel} />
            <Metric label="Active stage" value={stageState.activeLabel} tone={stageState.tone} />
            <Metric label="Files" value={assets === undefined ? "…" : String(ordered.length)} />
          </dl>
        </header>

        {assets === undefined ? (
          <div className={styles.loading} aria-live="polite" aria-busy="true">
            Loading media…
          </div>
        ) : ordered.length === 0 && !currentThumbnail?.thumbnailKey && !currentThumbnail?.videoKey ? (
          <div className={styles.empty}>
            <strong>No retained media yet</strong>
            <span>
              Output appears when a stage saves it.
            </span>
          </div>
        ) : (
          <>
            <div className={styles.primaryMedia} data-has-master={selectedMaster ? true : undefined}>
              {selectedMaster && <RunMediaAssetCard asset={selectedMaster} selectedMaster />}
              <div className={styles.packaging}>
                <CurrentThumbnailCard thumbnail={currentThumbnail} />
                {documents.map((asset) => <RunMediaAssetCard key={asset._id} asset={asset} selectedMaster={false} />)}
              </div>
            </div>
            {previews.length > 0 && (
              <div className={styles.mediaGrid}>
                {previews.map((asset) => <RunMediaAssetCard key={asset._id} asset={asset} selectedMaster={false} />)}
              </div>
            )}

            {(hiddenCount > 0 || showAll) && (
              <div className={styles.moreRow}>
                {hiddenCount > 0 && (
                  <span>
                    {visible.length} of {media.length} media files
                  </span>
                )}
                <button
                  type="button"
                  className={styles.moreButton}
                  onClick={() => setShowAll((current) => !current)}
                >
                  {showAll ? "Show recent" : `Show all ${media.length}`}
                </button>
              </div>
            )}
            {historicalThumbnails.length > 0 && (
              <details
                className={styles.historicalThumbnails}
                open={historyOpen}
                onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
              >
                <summary>Historical thumbnails <span>{historicalThumbnails.length}</span></summary>
                {historyOpen && (
                  <div className={styles.mediaGrid}>
                    {historicalThumbnails.map((asset) => (
                      <RunMediaAssetCard key={asset._id} asset={asset} selectedMaster={false} historical />
                    ))}
                  </div>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function CurrentThumbnailCard({ thumbnail }: { thumbnail: RunCurrentThumbnail | null | undefined }) {
  const source = thumbnail ? runCurrentThumbnailSource(thumbnail) : null;
  const key = source?.assetKey ?? source?.videoStillKey;
  const frame = thumbnail?.thumbnailPresentation === "lofi_frame_pending";
  return (
    <article className={`${styles.assetCard} ${styles.currentThumbnailCard}`} data-current-thumbnail={thumbnail?.thumbnailPresentation ?? "retained"}>
      {thumbnail === undefined ? (
        <div className={styles.preview} aria-busy="true" role="status">Loading current thumbnail…</div>
      ) : (
        <CurrentMediaPreview
          className={styles.currentThumbnailPreview}
          imageClassName={styles.currentThumbnailImage}
          assetKey={source?.assetKey}
          videoStillKey={source?.videoStillKey}
          alt={`Current thumbnail for ${thumbnail?.title ?? "this run"}`}
          unavailableLabel="No current thumbnail available"
          footer={({ src, state }) => (
            <div className={styles.assetBody}>
              <div className={styles.assetHeading}>
                <p className={styles.assetKind}>{frame ? "Source video frame" : "Current thumbnail"}</p>
                {src && state === "ready" && (
                  <a
                    className={styles.sourceLink}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={frame ? "Open source video" : "Open current thumbnail source"}
                  >Open source ↗</a>
                )}
              </div>
              {key && <details className={styles.receiptDetails}><summary>Storage</summary><code title={key}>{key}</code></details>}
            </div>
          )}
        />
      )}
    </article>
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
  historical = false,
}: {
  asset: RunMediaAsset;
  selectedMaster: boolean;
  historical?: boolean;
}) {
  const source = useAssetUrlState(asset.r2Key);
  const [mediaFailed, setMediaFailed] = useState(false);
  const type = mediaType(asset);
  const facts = mediaFacts(asset.meta);
  const label = historical ? "Historical thumbnail" : assetLabel(asset.kind);

  return (
    <article
      className={`${styles.assetCard} ${selectedMaster ? styles.selectedMaster : ""}`}
      data-media-type={type}
      data-historical-thumbnail={historical || undefined}
    >
      {type !== "file" && <div className={styles.preview}>
        <MediaPreview
          asset={asset}
          type={type}
          status={source.status}
          url={source.url}
          failed={mediaFailed}
          onMediaError={() => setMediaFailed(true)}
          label={label}
        />
      </div>}

      <div className={styles.assetBody}>
        <div className={styles.assetHeading}>
          <div>
            <p className={styles.assetKind}>{selectedMaster ? "Selected master" : label}</p>
            <h3>{fileName(asset.r2Key)}</h3>
          </div>
          {source.url && (
            <a
              className={styles.sourceLink}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label.toLowerCase()} source: ${fileName(asset.r2Key)}`}
            >
              Open source ↗
            </a>
          )}
        </div>

        {type === "file" && !source.url && (
          <p className={styles.fileStatus} role="status">
            {source.status === "loading" ? "Preparing file link…" : "File link unavailable"}
          </p>
        )}

        {facts.length > 0 && (
          <ul className={styles.facts} aria-label={`${label} metadata`}>
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}

        <details className={styles.receiptDetails}>
          <summary>Storage</summary>
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
  label,
}: {
  asset: RunMediaAsset;
  type: MediaType;
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  failed: boolean;
  onMediaError: () => void;
  label: string;
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
        alt={`${label} from the original run`}
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
        <audio controls preload="metadata" src={url} onError={onMediaError}>
          Your browser cannot preview this saved audio.
        </audio>
      </div>
    );
  }

  return <div className={styles.previewState}>Saved {assetLabel(asset.kind).toLowerCase()} file</div>;
}
