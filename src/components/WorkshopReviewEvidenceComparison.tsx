"use client";

import { useEffect, useState } from "react";
import { blockLabel } from "@/lib/blocks";
import styles from "./WorkshopReviewEvidenceComparison.module.css";

type Review = { fingerprint: string; name: string; createdAt: number };
type Benchmark = { fingerprint: string; runId: string; workerVersion?: string; receiptFingerprint: string; createdAt: number };
type Difference = { block: string; occurrence: number; changes: string[] };
type Evidence = { reviews: Review[]; benchmarks: Benchmark[]; comparisons: { reviewFingerprint: string; benchmarkFingerprint: string; differences: Difference[] }[]; reviewsTruncated: boolean; benchmarksTruncated: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function parseEvidence(value: unknown): Evidence {
  if (!record(value) || !Array.isArray(value.reviews) || !Array.isArray(value.benchmarks) || !Array.isArray(value.comparisons) || typeof value.reviewsTruncated !== "boolean" || typeof value.benchmarksTruncated !== "boolean" || value.reviews.length > 10 || value.benchmarks.length > 10) throw new Error("Invalid evidence");
  const reviews = value.reviews, benchmarks = value.benchmarks, comparisons = value.comparisons;
  if (!reviews.every(row => record(row) && fingerprint(row.fingerprint) && typeof row.name === "string" && typeof row.createdAt === "number" && Number.isFinite(row.createdAt)) ||
      !benchmarks.every(row => record(row) && fingerprint(row.fingerprint) && fingerprint(row.receiptFingerprint) && typeof row.runId === "string" && (row.workerVersion === undefined || typeof row.workerVersion === "string") && typeof row.createdAt === "number" && Number.isFinite(row.createdAt)) ||
      new Set(reviews.map(row => row.fingerprint)).size !== reviews.length || new Set(benchmarks.map(row => row.fingerprint)).size !== benchmarks.length || comparisons.length !== reviews.length * benchmarks.length) throw new Error("Invalid evidence");
  const pairs = new Set<string>();
  for (const row of comparisons) {
    if (!record(row) || !fingerprint(row.reviewFingerprint) || !fingerprint(row.benchmarkFingerprint) || !reviews.some(review => review.fingerprint === row.reviewFingerprint) || !benchmarks.some(benchmark => benchmark.fingerprint === row.benchmarkFingerprint) || !Array.isArray(row.differences) || !row.differences.every((difference: unknown) => record(difference) && typeof difference.block === "string" && Number.isSafeInteger(difference.occurrence) && (difference.occurrence as number) > 0 && Array.isArray(difference.changes) && difference.changes.length > 0 && difference.changes.every((change: unknown) => typeof change === "string" && change.length > 0))) throw new Error("Invalid evidence");
    const pair = `${row.reviewFingerprint}:${row.benchmarkFingerprint}`;
    if (pairs.has(pair)) throw new Error("Invalid evidence");
    pairs.add(pair);
  }
  return value as Evidence;
}

export function WorkshopReviewEvidenceComparison({ channelId, designFingerprint, revision = "" }: { channelId: string; designFingerprint: string; revision?: string }) {
  const [loaded, setLoaded] = useState<{ channelId: string; designFingerprint: string; revision: string; data: Evidence | null }>();
  const [selection, setSelection] = useState<{ channelId: string; designFingerprint: string; review: string; benchmark: string }>();
  const [retry, setRetry] = useState(0);
  const data = loaded?.channelId === channelId && loaded.designFingerprint === designFingerprint && loaded.revision === revision ? loaded.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workshop-review-evidence?channelId=${encodeURIComponent(channelId)}&designFingerprint=${encodeURIComponent(designFingerprint)}`, { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("Evidence unavailable"); return response.json(); })
      .then(value => { if (!controller.signal.aborted) setLoaded({ channelId, designFingerprint, revision, data: parseEvidence(value) }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ channelId, designFingerprint, revision, data: null }); });
    return () => controller.abort();
  }, [channelId, designFingerprint, revision, retry]);
  const review = data && (data.reviews.find(row => selection?.channelId === channelId && selection.designFingerprint === designFingerprint && row.fingerprint === selection.review) ?? data.reviews[0]);
  const benchmark = data && (data.benchmarks.find(row => selection?.channelId === channelId && selection.designFingerprint === designFingerprint && row.fingerprint === selection.benchmark) ?? data.benchmarks[0]);
  const comparison = data && review && benchmark ? data.comparisons.find(row => row.reviewFingerprint === review.fingerprint && row.benchmarkFingerprint === benchmark.fingerprint) : undefined;

  return <section className={styles.section} aria-label="Review evidence comparison">
    <h3>Review evidence comparison</h3>
    <p>A saved review remains unqualified. Matching entries do not approve, activate, or qualify a design; benchmark evidence belongs only to its recorded run and worker.</p>
    {data === undefined ? <p role="status">Loading review evidence...</p> : data === null ? <div role="alert"><p>Review evidence is unavailable or could not be verified.</p><button type="button" onClick={() => { setLoaded(undefined); setRetry(value => value + 1); }}>Retry</button></div> : <>
      {data.reviewsTruncated || data.benchmarksTruncated ? <p role="status">Only a bounded selection is shown; additional saved evidence exists.</p> : null}
      {data.reviews.length === 0 ? <p>No saved reviews for this channel.</p> : data.benchmarks.length === 0 ? <p>No retained qualified benchmarks for this channel. Reviews remain unqualified.</p> : <>
        <div className={styles.selectors}>
          <label>Saved review<select value={review?.fingerprint} onChange={event => setSelection({ channelId, designFingerprint, review: event.target.value, benchmark: benchmark!.fingerprint })}>{data.reviews.map(row => <option key={row.fingerprint} value={row.fingerprint}>{row.name} ({row.fingerprint.slice(0, 10)})</option>)}</select></label>
          <label>Retained benchmark<select value={benchmark?.fingerprint} onChange={event => setSelection({ channelId, designFingerprint, review: review!.fingerprint, benchmark: event.target.value })}>{data.benchmarks.map(row => <option key={row.fingerprint} value={row.fingerprint}>{row.runId} ({row.fingerprint.slice(0, 10)})</option>)}</select></label>
        </div>
        <dl className={styles.facts}><div><dt>Benchmark run</dt><dd>{benchmark?.runId}</dd></div><div><dt>Worker version</dt><dd>{benchmark?.workerVersion || "Unavailable"}</dd></div><div><dt>Receipt fingerprint</dt><dd>{benchmark?.receiptFingerprint}</dd></div></dl>
        <p>Compiler defaults and policy additions can produce differences; this comparison covers module entries, not the full design or execution environment.</p>
        {comparison?.differences.length === 0 ? <p role="status">Module entries match the retained benchmark.</p> : <ul className={styles.changes}>{comparison?.differences.map(difference => <li key={`${difference.block}:${difference.occurrence}`}><strong>{blockLabel(difference.block)}{difference.occurrence > 1 ? ` (${difference.occurrence})` : ""}</strong><span>{difference.changes.join(" · ")}</span></li>)}</ul>}
      </>}
    </>}
  </section>;
}
