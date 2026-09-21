"use client";

import { useEffect, useRef, useState } from "react";
import type { YuE2CandidateReview } from "@/lib/yue2ReviewTypes";
import { IconChevron } from "./icons";
import { YuE2AuditionForm } from "./YuE2AuditionForm";
import styles from "./YuE2EvaluationPanel.module.css";

type ReviewState = { status: "loading" } | { status: "error"; message: string } |
  { status: "ready"; review: YuE2CandidateReview | null };
const label = (value: string) => value.replaceAll("_", " ");
const measured = (value: number | null) => value === null ? "Unknown" : value.toPrecision(4);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function YuE2EvaluationPanel({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  return <details className={styles.panel} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>YuE music evaluation</summary>
    {open && <Review key={`${runId}:${revision}`} runId={runId} reload={() => setRevision((value) => value + 1)} />}
  </details>;
}

function Review({ runId, reload }: { runId: string; reload: () => void }) {
  const [state, setState] = useState<ReviewState>({ status: "loading" });
  const [audioFailed, setAudioFailed] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 120_000);
    void (async () => {
      try {
        const response = await fetch(`/api/yue2-evaluations/review?runId=${encodeURIComponent(runId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? "Owner sign-in required." : "Review evidence unavailable or invalid.");
        const body = await response.json() as { ok?: boolean; review?: YuE2CandidateReview | null };
        if (body.ok !== true || body.review === undefined) throw new Error("Review evidence unavailable or invalid.");
        if (active) setState({ status: "ready", review: body.review });
      } catch (error) {
        if (active) setState({ status: "error", message: controller.signal.aborted
          ? "Review verification timed out." : error instanceof Error ? error.message : "Review unavailable." });
      } finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [runId]);

  if (state.status === "loading") return <p role="status" aria-busy="true">Verifying retained audio...</p>;
  if (state.status === "error") return <div className={styles.notice} role="alert">
    <p>{state.message}</p><button type="button" onClick={reload}>Retry review</button>
  </div>;
  if (!state.review) return <div className={styles.notice}>
    <p>No retained YuE candidate for this run.</p><button type="button" onClick={reload}>Check again</button>
  </div>;
  const review = state.review;
  const { quality, arrangement, brief } = review;
  const signal = quality.signal;
  return <section aria-label="YuE candidate review" className={styles.review}>
    <header className={styles.header}>
      <div><h2>{brief.topic}</h2><p>{brief.reviewContext
        ? brief.reviewContext.channelName ?? "Channel name not retained" : "Channel context not retained"}</p></div>
      <strong className={styles.status}>{quality.status === "blocked" ? "Blocked for review" : "Needs audition"}</strong>
    </header>
    <p className={styles.warning}>Not approved for production. Channel-personality fit is unverified.</p>
    <audio ref={audio} controls preload="metadata" src={review.nativeWavUrl} onLoadedMetadata={() => setAudioReady(true)} onError={() => setAudioFailed(true)} aria-label="Native YuE candidate" />
    {audioFailed && <p role="alert">Audio link expired or unavailable.</p>}
    <div className={styles.toolbar}>
      <span>{review.nativeOutput.sampleRateHz / 1000} kHz / {review.nativeOutput.channels} channels / FLOAT WAV</span>
      <button type="button" onClick={reload}>Reload review</button>
    </div>
    <dl className={styles.facts}>
      <div><dt>Requested source</dt><dd>{time(quality.requestedDurationSec)}</dd></div>
      <div><dt>Measured source</dt><dd>{quality.actualDurationSec.toFixed(3)} s</dd></div>
      <div><dt>Allocation estimate</dt><dd>${(review.allocation.allocatedCostUsdMicros / 1_000_000).toFixed(6)}</dd></div>
      <div><dt>Provider bill</dt><dd>Unknown</dd></div>
    </dl>
    {!quality.durationMatches && <p className={styles.warning}>Measured duration does not match the requested source.</p>}
    {signal.reviewReasons.length > 0 && <ul className={styles.warning} aria-label="Technical findings">
      {signal.reviewReasons.map((reason) => <li key={reason}>{label(reason)}</li>)}
    </ul>}
    <details open className={styles.disclosure}>
      <summary>Channel intent</summary>
      {brief.reviewContext ? <p className={styles.context}>{brief.reviewContext.promptContext}</p>
        : <p className={styles.warning}>Original channel context is missing. Personality fit cannot be established from this record.</p>}
    </details>
    <div className={styles.arrangement}>
      <h3>Accepted arrangement</h3>
      <p>{arrangement.direction}</p>
      <p className={styles.muted}>{label(arrangement.role)} / {label(arrangement.form)} / {label(arrangement.ending)} / {arrangement.playback}</p>
      <ol className={styles.sections}>
        {arrangement.sections.map((section) => {
          const start = section.startFraction * arrangement.requestedDurationSec;
          const end = section.endFraction * arrangement.requestedDurationSec;
          return <li key={section.id}>
            <button type="button" title={`Seek to ${section.label}`} aria-label={`Seek to ${section.label}`}
              disabled={!audioReady || audioFailed || start >= quality.actualDurationSec}
              onClick={() => { if (audio.current?.readyState) audio.current.currentTime = start; }}>
              <IconChevron /> <span>{time(start)}</span>
            </button>
            <div><strong>{section.label}</strong><span className={styles.muted}> / intended {time(start)} to {time(end)} / energy {section.energy}</span>
              <p>{section.instruction}</p></div>
          </li>;
        })}
      </ol>
    </div>
    <details className={styles.disclosure}>
      <summary>Record audition</summary>
      <YuE2AuditionForm key={review.candidateSha256} runId={runId} review={review} />
    </details>
    <details className={styles.disclosure}>
      <summary>Signal measurements</summary>
      <dl className={styles.facts}>
        <div><dt>Invalid samples</dt><dd>{signal.nonFiniteSamples}</dd></div>
        <div><dt>Full-scale samples</dt><dd>{signal.samplesAtOrAboveFullScale}</dd></div>
        <div><dt>True peak (0.1 dB resolution)</dt><dd>{signal.truePeak?.status === "measured"
          ? `${signal.truePeak.dbtp?.toFixed(1)} dBTP` : signal.truePeak?.status === "digital_silence" ? "Digital silence" : "Unknown"}</dd></div>
        <div><dt>Longest quiet run</dt><dd>{signal.longestQuietWindowRunSec.toFixed(3)} s</dd></div>
        <div><dt>Mono fold-down RMS</dt><dd>{measured(signal.monoFoldDown.rmsAmplitude)}</dd></div>
        {signal.channelMeasurements.map((channel, index) => <div key={index}>
          <dt>Channel {index + 1} RMS / peak / DC</dt><dd>{measured(channel.rmsAmplitude)} / {measured(channel.peakAmplitude)} / {measured(channel.dcOffset)}</dd>
        </div>)}
      </dl>
    </details>
    <details className={styles.disclosure}>
      <summary>Unresolved checks and provenance</summary>
      <ul>{quality.unresolved.map((item) => <li key={item}>{label(item)}</li>)}</ul>
      <dl><dt>Candidate SHA-256</dt><dd><code>{review.candidateSha256}</code></dd>
        <dt>Source brief SHA-256</dt><dd><code>{brief.sourceBriefFingerprint}</code></dd></dl>
    </details>
  </section>;
}
