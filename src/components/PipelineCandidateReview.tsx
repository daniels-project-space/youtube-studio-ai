"use client";

import { useEffect, useState } from "react";
import { blockLabel } from "@/lib/blocks";
import { comparePipelineCandidates } from "@/lib/comparePipelineCandidates";
import styles from "./PipelineCandidateReview.module.css";

type Entry = { block: string; version?: string; params?: unknown };
type Candidate = {
  fingerprint: string;
  createdAt: number;
  candidate: { entries: Entry[]; sourceRunId: string; workerDeployment: { version: string } };
};

type Evidence = { candidates: Candidate[]; comparisonPipeline: Entry[] | null };
export function PipelineCandidateReview({ channelId, revision }: { channelId: string; revision: string }) {
  const [state, setState] = useState<{ channelId: string; revision: string; evidence: Evidence | null }>();
  const evidence = state?.channelId === channelId && state.revision === revision ? state.evidence : undefined;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/retained-pipeline-candidates?channelId=${encodeURIComponent(channelId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Candidate evidence unavailable");
        const result = await response.json();
        if (!Array.isArray(result.candidates) || (result.comparisonPipeline !== null && !Array.isArray(result.comparisonPipeline))) throw new Error("Invalid candidate evidence");
        return result as Evidence;
      })
      .then(value => { if (!controller.signal.aborted) setState({ channelId, revision, evidence: value }); })
      .catch(() => { if (!controller.signal.aborted) setState({ channelId, revision, evidence: null }); });
    return () => controller.abort();
  }, [channelId, revision]);
  return <section className={styles.section} aria-labelledby="candidate-review-title">
    <h2 id="candidate-review-title">Pipeline evidence</h2>
    <p>Evidence compares a compiled benchmark with the saved pipeline and module overrides. It is not an approved or active release.</p>
    {evidence === undefined ? <p role="status">Loading evidence...</p> : evidence === null ? <p role="alert">Pipeline evidence is unavailable.</p> : evidence.candidates.length === 0 ? <p>No qualified candidate evidence has been retained for this channel.</p> :
      <div>{evidence.candidates.map(row => {
        if (!row?.candidate || !Array.isArray(row.candidate.entries) || row.candidate.entries.some(entry => !entry || typeof entry.block !== "string")) {
          return <p key={row?.fingerprint ?? "invalid"} role="alert">A retained candidate could not be read.</p>;
        }
        const differences = evidence.comparisonPipeline ? comparePipelineCandidates(evidence.comparisonPipeline, row.candidate.entries) : null;
        return <details key={row.fingerprint} className={styles.candidate}>
          <summary><strong>Qualified benchmark</strong><span>{new Date(row.createdAt).toLocaleDateString()}</span></summary>
          <dl className={styles.facts}>
            <div><dt>Evidence fingerprint</dt><dd>{row.fingerprint}</dd></div>
            <div><dt>Benchmark run</dt><dd>{row.candidate.sourceRunId}</dd></div>
            <div><dt>Worker version</dt><dd>{row.candidate.workerDeployment?.version ?? "Unavailable"}</dd></div>
          </dl>
          <p>Compiler defaults and policy additions can appear as differences. Worker retention, approval and activation are not yet available.</p>
          {differences === null ? <p role="alert">Saved module settings could not be resolved for comparison.</p> : differences.length === 0 ? <p>No differences in the displayed module entries.</p> : <ul className={styles.changes}>{differences.map(change => <li key={`${change.block}:${change.occurrence}`}><strong>{blockLabel(change.block)}{change.occurrence > 1 ? ` (${change.occurrence})` : ""}</strong><span>{change.changes.join(" · ")}</span></li>)}</ul>}
        </details>;
      })}</div>}
  </section>;
}
