"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useOperationsAccess, useRequestOperationsAccess } from "@/components/OperationsAccess";
import { useOwnerId } from "@/lib/owner-context";
import { parseWorkshopDesignTransport, type WorkshopDesignTransport } from "@/lib/workshopDesignTransport";
import { compareWorkshopDesign } from "@/lib/compareWorkshopDesign";
import { WorkshopEvidenceComparison } from "@/components/WorkshopEvidenceComparison";
import { WorkshopReviewEvidenceComparison } from "@/components/WorkshopReviewEvidenceComparison";
import styles from "./WorkshopDesignImports.module.css";

type ImportedDesign = { _id: string; design: WorkshopDesignTransport; importedAt: number };
const listDesigns = makeFunctionReference<"query", { ownerId: string }, ImportedDesign[]>("workshopDesignImports:list");
const importDesign = makeFunctionReference<"mutation", { ownerId: string; design: WorkshopDesignTransport }, { id: string; reused: boolean }>("workshopDesignImports:importDesign");
const channelOptions = makeFunctionReference<"query", { ownerId: string }, { channels: { id: string; name: string; slug: string }[]; truncated: boolean }>("workshopDesignImports:channelOptions");
const channelBySlug = makeFunctionReference<"query", { ownerId: string; slug: string }, { channel: { id: string; name: string; slug: string } | null; ambiguous: boolean }>("workshopDesignImports:channelBySlug");
type ReviewCandidate = { _id: string; fingerprint: string; baselineFingerprint: string; createdAt: number; candidate: { design: WorkshopDesignTransport; baseline: { pipeline: unknown; moduleConfig: unknown; family: unknown; contentLane: unknown }; status: string } };
const createReview = makeFunctionReference<"mutation", { ownerId: string; channelId: string; designId: string; expectedBaselineFingerprint: string; expectedDesignFingerprint: string }, { id: string; reused: boolean }>("workshopDesignImports:createReviewCandidate");
const listReviews = makeFunctionReference<"query", { ownerId: string; channelId: string; designFingerprint: string }, ReviewCandidate[]>("workshopDesignImports:listReviewCandidates");
const MAX_FILE_BYTES = 120_000;

class SnapshotBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className={styles.section} role="alert">
      <h2>Workshop design snapshots</h2>
      <p>Snapshots are unavailable. Check the connection and reload this page.</p>
    </section>;
    return this.props.children;
  }
}

export function WorkshopDesignImports() {
  return <SnapshotBoundary><SnapshotPanel /></SnapshotBoundary>;
}

function SnapshotPanel() {
  const access = useOperationsAccess();
  const requestAccess = useRequestOperationsAccess();
  const ownerId = useOwnerId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const designs = useQuery(listDesigns, open && access === "owner" ? { ownerId } : "skip");
  const channels = useQuery(channelOptions, open && access === "owner" ? { ownerId } : "skip");
  const saveDesign = useMutation(importDesign);

  async function importFile(file: File) {
    setMessage("");
    if (file.size > MAX_FILE_BYTES) {
      setMessage("File exceeds the 120 KB limit.");
      return;
    }
    setBusy(true);
    try {
      const parsed = parseWorkshopDesignTransport(JSON.parse(await file.text()));
      const result = await saveDesign({ ownerId, design: parsed });
      setMessage(result.reused ? "This snapshot was already imported." : "Snapshot imported as untrusted.");
    } catch (error) {
      setMessage(error instanceof Error ? `Import failed: ${error.message}` : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.section} aria-labelledby="workshop-design-title">
    <div className={styles.heading}>
      <div><h2 id="workshop-design-title">Workshop design snapshots</h2><p>Imported designs are untrusted and cannot run or change channels.</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide snapshots" : "View snapshots"}</button>
    </div>
    {open && access !== "owner" ? <div className={styles.access}>
      <span>{access === "checking" ? "Checking owner access..." : "Owner verification required."}</span>
      {access !== "checking" ? <button type="button" onClick={requestAccess}>Verify owner</button> : null}
    </div> : null}
    {open && access === "owner" ? <div className={styles.content}>
      <label className={styles.upload}>Import JSON snapshot <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void importFile(file);
      }} /></label>
      <span className={styles.hint}>Maximum file size: 120 KB</span>
      {message ? <p role="status" className={styles.message}>{message}</p> : null}
      {designs === undefined ? <p>Loading snapshots...</p> : designs.length === 0 ? <p>No snapshots imported yet.</p> : <div className={styles.list}>
        {designs.map(({ _id, design, importedAt }) => <details key={_id} className={styles.item}>
          <summary><span><strong>{design.name}</strong><small>{design.family} · {design.entries.length} modules · {new Date(importedAt).toLocaleDateString()}</small></span><span className={styles.status}>Untrusted</span></summary>
          <div className={styles.details}>
            <p>Fingerprint: <code>{design.fingerprint}</code></p>
            <DesignComparison design={design} designId={_id} channels={channels} ownerId={ownerId} />
            {design.version === "workshop-design-snapshot/v2" && <section aria-label="Imported channel design">
              <h3>Channel design context</h3>
              <p><strong>{design.channelDesign.name}</strong> · revision {design.channelDesign.revision}</p>
              <dl><dt>Niche</dt><dd>{design.channelDesign.niche || "Not set"}</dd><dt>Persona</dt><dd className={styles.persona}>{design.channelDesign.persona || "Not set"}</dd><dt>Palette</dt><dd>{design.channelDesign.palette.join(", ") || "Not set"}</dd></dl>
              <p>Untrusted context, retained for review.</p>
            </section>}
            <ol>{design.entries.map((entry, index) => <li key={index}><strong>{entry.block}</strong>{entry.version ? ` · ${entry.version}` : ""}{entry.params ? <pre>{JSON.stringify(entry.params, null, 2)}</pre> : null}</li>)}</ol>
          </div>
        </details>)}
      </div>}
    </div> : null}
  </section>;
}

type ChannelOptions = { channels: { id: string; name: string; slug: string }[]; truncated: boolean };
type Baseline = { family: string | null; familyWarning?: string | null; comparisonPipeline: { block: string; version?: string; params?: unknown }[] | null; comparisonFingerprint: string | null; baselineFingerprint: string };

function DesignComparison({ design, designId, channels, ownerId }: { design: WorkshopDesignTransport; designId: string; channels: ChannelOptions | undefined; ownerId: string }) {
  const [channelId, setChannelId] = useState("");
  const [slug, setSlug] = useState("");
  const [lookup, setLookup] = useState("");
  const exact = useQuery(channelBySlug, lookup ? { ownerId, slug: lookup } : "skip");
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const saveReview = useMutation(createReview);
  const reviews = useQuery(listReviews, channelId ? { ownerId, channelId, designFingerprint: design.fingerprint } : "skip");
  const [result, setResult] = useState<{ channelId: string; refresh: number; baseline: Baseline | null; fetchedAt: number }>();
  const [verification, setVerification] = useState<{ channelId: string; refresh: number; baselineAt: number; status: "checking" | "same" | "changed" | "unavailable"; checkedAt?: number }>();
  useEffect(() => {
    if (!channelId) return;
    const controller = new AbortController();
    fetch(`/api/workshop-design-comparison?channelId=${encodeURIComponent(channelId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Baseline unavailable");
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || !("comparisonPipeline" in value) || !("family" in value) || !("comparisonFingerprint" in value)) throw new Error("Invalid baseline");
        const baseline = value as Baseline;
        if (!/^[a-f0-9]{64}$/.test(baseline.baselineFingerprint ?? "") || (baseline.family !== null && typeof baseline.family !== "string") || (baseline.familyWarning != null && typeof baseline.familyWarning !== "string") || (baseline.comparisonPipeline !== null && (!Array.isArray(baseline.comparisonPipeline) || baseline.comparisonPipeline.some(entry => !entry || typeof entry.block !== "string"))) || (baseline.comparisonPipeline === null || baseline.familyWarning ? baseline.comparisonFingerprint !== null : !/^[a-f0-9]{64}$/.test(baseline.comparisonFingerprint ?? ""))) throw new Error("Invalid baseline");
        return baseline;
      })
      .then(baseline => { if (!controller.signal.aborted) setResult({ channelId, refresh, baseline, fetchedAt: Date.now() }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ channelId, refresh, baseline: null, fetchedAt: Date.now() }); });
    return () => controller.abort();
  }, [channelId, refresh]);
  const options = [...(channels?.channels ?? [])];
  if (exact?.channel && !options.some(channel => channel.id === exact.channel?.id)) options.push(exact.channel);
  const selected = options.find(channel => channel.id === channelId);
  const baseline = selected && result?.channelId === channelId && result.refresh === refresh ? result.baseline : undefined;
  const comparison = baseline?.comparisonPipeline ? compareWorkshopDesign(baseline.comparisonPipeline, design.entries) : null;
  const checked = result && verification?.channelId === channelId && verification.refresh === refresh && verification.baselineAt === result.fetchedAt ? verification : undefined;
  async function verifyBaseline() {
    if (!baseline?.comparisonFingerprint || !result) return;
    const stamp = { channelId, refresh, baselineAt: result.fetchedAt };
    setVerification({ ...stamp, status: "checking" });
    try {
      const response = await fetch(`/api/workshop-design-comparison?channelId=${encodeURIComponent(channelId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || !("comparisonFingerprint" in value) || typeof value.comparisonFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.comparisonFingerprint)) throw new Error("Unavailable");
      setVerification({ ...stamp, status: value.comparisonFingerprint === baseline.comparisonFingerprint ? "same" : "changed", checkedAt: Date.now() });
    } catch { setVerification({ ...stamp, status: "unavailable" }); }
  }
  async function saveCandidate() {
    if (!baseline || !channelId) return;
    setSaving(true); setSaveMessage("");
    try {
      const saved = await saveReview({ ownerId, channelId, designId, expectedBaselineFingerprint: baseline.baselineFingerprint, expectedDesignFingerprint: design.fingerprint });
      setSaveMessage(saved.reused ? "This review is already saved." : "Review saved as unqualified.");
    } catch (error) { setSaveMessage(error instanceof Error ? error.message : "Review could not be saved."); }
    finally { setSaving(false); }
  }
  return <section className={styles.comparison} aria-label={`Compare ${design.name} with channel`}>
    <h3>Compare with a channel</h3>
    <label>Existing channel <select value={selected ? channelId : ""} disabled={!channels || channels.channels.length === 0} onChange={event => { setResult(undefined); setChannelId(event.target.value); }}>
      <option value="">Select a channel</option>
      {options.map(channel => <option key={channel.id} value={channel.id}>{channel.name} ({channel.slug})</option>)}
    </select></label>
    {channels?.truncated && <p>Showing the first 100 channels. Find another by its exact slug.</p>}
    <form onSubmit={event => { event.preventDefault(); setResult(undefined); setChannelId(""); setLookup(slug.trim()); }}>
      <label>Exact channel slug <input value={slug} maxLength={200} onChange={event => setSlug(event.target.value)} /></label>{" "}
      <button type="submit" disabled={!slug.trim()}>Find channel</button>
    </form>
    {lookup && exact === undefined && <p role="status">Looking up channel...</p>}
    {lookup && exact && !exact.channel && <p role="status">{exact.ambiguous ? "More than one channel has this slug; comparison is unavailable." : "No channel found for this owner and slug."}</p>}
    {lookup && exact?.channel && <button type="button" onClick={() => { setResult(undefined); setChannelId(exact.channel!.id); }}>Compare {exact.channel.name}</button>}
    {channels && channels.channels.length === 0 && <p>No existing channels.</p>}
    {selected && baseline === undefined && <p role="status">Loading channel baseline...</p>}
    {selected && baseline === null && <p role="alert">Channel baseline is unavailable.</p>}
    {selected && baseline && <>
      <p>Baseline retrieved {new Date(result!.fetchedAt).toLocaleString()}. <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh baseline</button></p>
      {baseline.comparisonFingerprint && <div><button type="button" disabled={checked?.status === "checking"} onClick={() => void verifyBaseline()}>Recheck displayed baseline</button>
        {checked?.status === "checking" && <p role="status">Checking baseline...</p>}
        {checked?.status === "same" && <p role="status">Displayed format and pipeline settings matched the saved baseline at {new Date(checked.checkedAt!).toLocaleTimeString()}.</p>}
        {checked?.status === "changed" && <p role="alert">The saved format or pipeline settings changed. Refresh the baseline before reviewing.</p>}
        {checked?.status === "unavailable" && <p role="alert">Baseline could not be rechecked.</p>}
        <p>Only the displayed format and pipeline settings are checked. Other channel settings, worker readiness and approval are not verified.</p>
      </div>}
      <p>Saved channel format: {baseline.family ?? "Unavailable"} · Imported format: {design.family}</p>
      {baseline.familyWarning && <p role="alert">{baseline.familyWarning}</p>}
      {baseline.family && baseline.family !== design.family && <p role="alert">The imported format differs from the saved channel format.</p>}
      {baseline.comparisonPipeline === null ? <p role="alert">Saved module settings could not be resolved for comparison.</p> : comparison?.differences.length === 0 ? <p>No recorded differences among uniquely occurring modules.</p> : <ul>{comparison?.differences.map(change => <li key={change.block}><strong>{change.block}</strong>: {change.changes.join(" · ")}</li>)}</ul>}
      {comparison && comparison.repeatedBlocks.length > 0 && <p role="status">Repeated modules require manual comparison: {comparison.repeatedBlocks.join(", ")}. Instances have no stable identity; the saved baseline applies block-keyed settings to every occurrence.</p>}
      {comparison && (comparison.unpinnedSaved > 0 || comparison.unpinnedImported > 0) && <p>Versions not specified: {comparison.unpinnedSaved} in the saved baseline and {comparison.unpinnedImported} in the import. A missing version does not establish a match.</p>}
      {baseline.comparisonPipeline && <details><summary>Saved baseline modules</summary><ol>{baseline.comparisonPipeline.map((entry, index) => <li key={index}><strong>{entry.block}</strong>{entry.version ? ` · ${entry.version}` : ""}{entry.params ? <pre>{JSON.stringify(entry.params, null, 2)}</pre> : null}</li>)}</ol></details>}
      <p>The import is uncompiled: defaults, policy additions, compatibility and execution have not been checked. Differences and matches do not establish qualification, approval, or activation.</p>
      <button type="button" onClick={() => void saveCandidate()} disabled={saving || Boolean(baseline.familyWarning) || baseline.comparisonPipeline === null}>{saving ? "Saving review..." : "Save unqualified review"}</button>
      {saveMessage && <p role="status">{saveMessage}</p>}
      {reviews === undefined ? <p role="status">Loading saved reviews...</p> : reviews.length === 0 ? <p>No saved reviews for this design and channel.</p> : <div><h4>Saved reviews</h4><p>Showing up to 10 recent reviews.</p>{reviews.map(review => <details key={review._id}><summary>Unqualified · {new Date(review.createdAt).toLocaleString()}</summary><p>Review fingerprint: <code>{review.fingerprint}</code></p><p>Baseline fingerprint: <code>{review.baselineFingerprint}</code></p><p>Frozen baseline entries and overrides are shown separately; they have not been resolved or qualified.</p><pre>{JSON.stringify(review.candidate.baseline, null, 2)}</pre><p>Frozen imported design:</p><pre>{JSON.stringify(review.candidate.design, null, 2)}</pre></details>)}</div>}
      {reviews?.length ? <WorkshopReviewEvidenceComparison key={selected.id} channelId={selected.id} designFingerprint={design.fingerprint} revision={JSON.stringify(reviews.map(review => review.fingerprint))} /> : <WorkshopEvidenceComparison key={`${selected.id}:${designId}`} channelId={selected.id} designId={designId} />}
    </>}
  </section>;
}
