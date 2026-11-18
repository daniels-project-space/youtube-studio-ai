"use client";

import { useEffect, useState } from "react";

type Evidence = { fingerprint: string; sourceRunId: string; workerVersion: string | null; comparison: { differences: Array<{ block: string; changes: string[] }>; repeatedBlocks: string[]; unpinnedSaved: number; unpinnedImported: number } };

export function WorkshopEvidenceComparison({ channelId, designId }: { channelId: string; designId: string }) {
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<{ key: string; evidence: Evidence[] | null }>();
  const key = JSON.stringify([channelId, designId]);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ channelId, designId });
    fetch(`/api/workshop-design-evidence?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (!Array.isArray(data.evidence)) throw new Error("Invalid evidence");
        return data.evidence as Evidence[];
      })
      .then(evidence => { if (!controller.signal.aborted) setResult({ key, evidence }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, evidence: null }); });
    return () => controller.abort();
  }, [channelId, designId, key, requested]);
  const evidence = result?.key === key ? result.evidence : undefined;
  return <section aria-label="Compare retained benchmark evidence">
    <h3>Retained benchmark evidence</h3>
    <p>Comparing entries does not prove this design produced a benchmark, approve it, or make it executable.</p>
    {!requested && <button type="button" onClick={() => setRequested(true)}>Check retained evidence</button>}
    {requested && evidence === undefined && <p role="status">Loading retained evidence...</p>}
    {requested && evidence === null && <p role="alert">Retained evidence comparison is unavailable.</p>}
    {requested && evidence?.length === 0 && <p>No retained benchmark evidence for this channel.</p>}
    {requested && evidence && evidence.length > 0 && <ul>{evidence.map(row => <li key={row.fingerprint}>
      <p>Benchmark run: {row.sourceRunId} · worker: {row.workerVersion ?? "Unavailable"}</p>
      <p>Evidence fingerprint: <code>{row.fingerprint}</code></p>
      {row.comparison.differences.length === 0 ? <p>No recorded differences among uniquely occurring modules.</p> : <ul>{row.comparison.differences.map(change => <li key={change.block}>{change.block}: {change.changes.join(" · ")}</li>)}</ul>}
      {row.comparison.repeatedBlocks.length > 0 && <p>Repeated modules require manual comparison: {row.comparison.repeatedBlocks.join(", ")}.</p>}
      {(row.comparison.unpinnedSaved > 0 || row.comparison.unpinnedImported > 0) && <p>Unpinned versions: {row.comparison.unpinnedSaved} in evidence, {row.comparison.unpinnedImported} in the import. Missing versions do not establish a match.</p>}
    </li>)}</ul>}
  </section>;
}
