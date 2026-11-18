"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { comparePipelineCandidates } from "@/lib/comparePipelineCandidates";
import { durationMinutesToSeconds } from "@/lib/durationMinutes";
import { verifyDurationCandidateLocalReceipt } from "@/lib/durationCandidateLocalReceipt";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

type Entry = { block: string; version?: string; params?: unknown };
type Evidence = { fingerprint: string; createdAt: number; sourceRunId: string; workerVersion: string; entries: Entry[] };
type Preflight = { bindingFingerprint: string; binding: { maximumCostUsd: number; channelBudgetUsd: number | null; historicalWorker: null | { sourceRunId: string; deployment: { version: string } } }; preparedEvidence?: null | { evidenceFingerprint: string; body: { entries: Entry[]; inserted: string[]; retired: string[]; removedDeliveryBlocks: string[]; skippedModuleConfig: string[]; repeatedBlocks: string[] } }; routeEvidence?: null | { evidenceFingerprint: string; binding: { bindingFingerprint: string; route: { fingerprint: string } }; visualMatter: { status: string } }; inceptionEvidence?: null | { evidence: { evidenceFingerprint: string } }; plannerEvidence?: null | { evidence: { evidenceFingerprint: string } }; localReceipt: ReturnType<typeof verifyDurationCandidateLocalReceipt>; blockers: string[]; removedDeliveryBlocks: string[]; ready: false; dispatchAuthorized: false; receiptIssued: false };

type Draft = {
  version: "channel-duration-draft/v1"; channelId: string; family: string;
  requestedSeconds: number; baselineFingerprint: string; savedToAccount: boolean;
  changes: string[]; baselinePipeline: unknown; pipeline: unknown;
};
type Candidate = {
  _id: string; family: string; requestedSeconds: number; baselineFingerprint: string;
  fingerprint: string; baselineCurrent: boolean; createdAt: number;
  baselinePipeline: unknown; pipeline: unknown; version?: string; baselineModuleConfig?: unknown; moduleConfig?: unknown;
  effectivePipeline?: Entry[] | null;
};

function LocalCompilationReports({ channelId, candidateId }: { channelId: string; candidateId: string }) {
  const [reports, setReports] = useState<Array<{ fingerprint: string; createdAt: number; report: unknown }>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const response = await fetch(`/api/duration-candidate-local-reports?channelId=${encodeURIComponent(channelId)}&candidateId=${encodeURIComponent(candidateId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.reports) || data.excluded !== 0) throw new Error("Reports could not be loaded or verified.");
      setReports(data.reports); setState("ready"); setError("");
    } catch { setState("error"); setError("Reports could not be loaded or verified."); }
  }
  useEffect(() => { void load(); }, [channelId, candidateId]);
  async function save() {
    let report: unknown;
    try { report = JSON.parse(input); } catch { setError("Enter a valid local compilation report."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/duration-candidate-local-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, candidateId, report }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Report could not be retained.");
      setInput(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Report could not be retained."); }
    finally { setBusy(false); }
  }
  return <div>
    <p>Local reports use owner-supplied options and have unverified origins. They are not worker attestations, run invocations or approvals.</p>
    {state === "loading" && <p role="status">Loading local reports...</p>}
    {state === "ready" && reports.length === 0 && <p>No local reports retained.</p>}
    {error && <p role="alert">{error}</p>}
    {state === "ready" && reports.map(item => <details key={item.fingerprint}><summary>{item.report && typeof item.report === "object" && "provenance" in item.report && item.report.provenance === "worker-reported-unattested" ? "Worker-reported local receipt (unattested)" : "Unverified report"} {item.fingerprint} ({new Date(item.createdAt).toLocaleString()})</summary><pre style={{ overflowX: "auto" }}>{JSON.stringify(item.report, null, 2)}</pre></details>)}
    <label style={{ display: "grid", gap: "0.25rem" }}>Local report (JSON)<textarea maxLength={150000} value={input} disabled={busy} onChange={event => { setInput(event.target.value); setError(""); }} style={{ background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg, #f5f5f6)", border: "1px solid var(--color-border, #71717a)", borderRadius: 8, padding: "0.45rem 0.6rem", width: "100%", minHeight: "6rem" }} /></label>
    <button type="button" disabled={busy || !input.trim()} onClick={() => void save()} style={{ background: "var(--color-accent, #e8e8ea)", color: "#0a0a0b", border: 0, borderRadius: 8, padding: "0.45rem 0.85rem", fontWeight: 600 }}>{busy ? "Saving..." : "Retain local report"}</button>
  </div>;
}

async function fetchCandidates(channelId: string): Promise<{ candidates: Candidate[]; evidence: Evidence[]; evidenceAvailable: boolean; evidenceUnavailableCount: number }> {
  const response = await fetch(`/api/channel-duration-draft?channelId=${encodeURIComponent(channelId)}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.candidates) || !Array.isArray(body.evidence)) throw new Error("Saved candidates could not be loaded.");
  return body;
}

export function ChannelDurationDraft({ channelId, baselineRevision, canRequest, onRequestOwner }: { channelId: string; baselineRevision?: string; canRequest: boolean; onRequestOwner: () => void }) {
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [evidenceAvailable, setEvidenceAvailable] = useState(false);
  const [evidenceUnavailableCount, setEvidenceUnavailableCount] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [ceilings, setCeilings] = useState<Record<string, string>>({});
  const [plannerOptions, setPlannerOptions] = useState<Record<string, string>>({});
  const [openReports, setOpenReports] = useState<Record<string, boolean>>({});
  const [preflights, setPreflights] = useState<Record<string, Preflight | undefined>>({});
  const [preflightErrors, setPreflightErrors] = useState<Record<string, string>>({});
  const [preflightBusy, setPreflightBusy] = useState<Record<string, boolean>>({});
  const [workerChecks, setWorkerChecks] = useState<Record<string, { state: string; message: string } | undefined>>({});
  const [reportRevision, setReportRevision] = useState<Record<string, number>>({});
  const workerSequence = useRef<Record<string, number>>({});
  useEffect(() => () => { workerSequence.current = {}; }, []);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [listState, setListState] = useState<"loading" | "loaded" | "error">("loading");
  const requestSequence = useRef(0);
  const baselineRef = useRef(baselineRevision);
  baselineRef.current = baselineRevision;
  const previousBaseline = useRef(baselineRevision);
  useEffect(() => {
    if (previousBaseline.current === baselineRevision) return;
    previousBaseline.current = baselineRevision;
    setDraft(null);
    setPreflights({});
    workerSequence.current = {};
    setWorkerChecks({});
    setError("Channel settings changed. Calculate the draft again before saving.");
    void load();
  }, [baselineRevision]);
  async function load() {
    if (!canRequest) return;
    const sequence = ++requestSequence.current;
    setListState("loading");
    try {
      const rows = await fetchCandidates(channelId);
      if (sequence === requestSequence.current) { setCandidates(rows.candidates); setEvidence(rows.evidence); setEvidenceAvailable(rows.evidenceAvailable); setEvidenceUnavailableCount(rows.evidenceUnavailableCount); setListError(""); setListState("loaded"); }
    } catch { if (sequence === requestSequence.current) { setListError("Saved candidates could not be loaded."); setListState("error"); } }
  }
  useEffect(() => {
    if (!canRequest) return;
    let current = true;
    const sequenceRef = requestSequence;
    const sequence = ++sequenceRef.current;
    setListState("loading");
    void fetchCandidates(channelId).then(rows => {
      if (current && sequence === sequenceRef.current) { setCandidates(rows.candidates); setEvidence(rows.evidence); setEvidenceAvailable(rows.evidenceAvailable); setEvidenceUnavailableCount(rows.evidenceUnavailableCount); setListError(""); setListState("loaded"); }
    }).catch(() => { if (current && sequence === sequenceRef.current) { setListError("Saved candidates could not be loaded."); setListState("error"); } });
    return () => { current = false; sequenceRef.current++; };
  }, [canRequest, channelId]);
  async function request(save: boolean) {
    const requestedSeconds = durationMinutesToSeconds(minutes);
    if (!canRequest || (save && !draft)) return;
    if (requestedSeconds === null) { setError("Enter a positive duration in minutes that resolves to a whole number of seconds."); return; }
    const requestedBaseline = baselineRef.current;
    setBusy(true); setError("");
    if (!save) setDraft(null);
    try {
      const response = await fetch("/api/channel-duration-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, requestedSeconds, ...(save ? { save: true, baselineFingerprint: draft!.baselineFingerprint } : {}) }) });
      const body = await response.json();
      if (requestedBaseline !== baselineRef.current) { setError("Channel settings changed. Calculate the draft again before saving."); return; }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not prepare the draft.");
      if (body.version !== "channel-duration-draft/v1" || body.channelId !== channelId || body.requestedSeconds !== requestedSeconds || body.savedToAccount !== save) throw new Error("Invalid draft response.");
      setDraft(body as Draft);
      if (save) await load();
    } catch (reason) { setError(requestedBaseline !== baselineRef.current ? "Channel settings changed. Calculate the draft again before saving." : reason instanceof Error ? reason.message : "Could not prepare the draft."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void request(false); }
  async function checkPreflight(candidateId: string) {
    const rawCeiling = ceilings[candidateId] ?? "";
    const maximumCostUsd = Number(rawCeiling);
    if (!canRequest) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawCeiling) || !Number.isFinite(maximumCostUsd) || maximumCostUsd < 0.01 || maximumCostUsd > 10000) {
      setPreflightErrors(current => ({ ...current, [candidateId]: "Enter an amount from $0.01 to $10,000 with at most two decimal places." }));
      setPreflights(current => ({ ...current, [candidateId]: undefined }));
      return;
    }
    let suppliedOptions: unknown;
    if (plannerOptions[candidateId]?.trim()) {
      try { suppliedOptions = JSON.parse(plannerOptions[candidateId]); if (!suppliedOptions || typeof suppliedOptions !== "object" || Array.isArray(suppliedOptions)) throw new Error(); }
      catch { setPreflightErrors(current => ({ ...current, [candidateId]: "Enter designer options as a JSON object." })); setPreflights(current => ({ ...current, [candidateId]: undefined })); return; }
    }
    const requestedBaseline = baselineRef.current;
    setPreflightBusy(current => ({ ...current, [candidateId]: true }));
    setPreflightErrors(current => ({ ...current, [candidateId]: "" }));
    setPreflights(current => ({ ...current, [candidateId]: undefined }));
    try {
      const response = await fetch("/api/channel-duration-candidate-preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, candidateId, maximumCostUsd, ...(selected[candidateId] ? { evidenceFingerprint: selected[candidateId] } : {}), ...(suppliedOptions ? { plannerOptions: suppliedOptions } : {}) }) });
      const body = await response.json();
      if (requestedBaseline !== baselineRef.current) { setPreflightErrors(current => ({ ...current, [candidateId]: "Channel settings changed. Check the candidate again." })); return; }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Preflight is unavailable.");
      if (!Array.isArray(body.blockers) || body.ready !== false || body.dispatchAuthorized !== false || body.receiptIssued !== false) throw new Error("Invalid preflight response.");
      const candidate = candidates.find(item => item._id === candidateId);
      if (!candidate) throw new Error("Candidate is no longer available.");
      const localReceipt = body.localReceipt == null ? null : verifyDurationCandidateLocalReceipt(body.localReceipt, { channelId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, pipeline: candidate.pipeline, moduleConfig: candidate.moduleConfig });
      if (body.localReceipt != null && !localReceipt) throw new Error("Local preflight receipt could not be verified against this candidate.");
      const blockers = localReceipt ? body.blockers.map((blocker: string) => blocker === "Candidate-specific runtime evidence has not been derived; no preflight receipt was issued." ? "Local runtime evidence was derived, but it is not a retained or worker-attested admission." : blocker === "Designer options were supplied by the owner; their historical provenance is not attested. Executable planner and runtime registry validation remain outstanding." ? "Designer options are historically unattested. Local planner and registry checks are not deployed-worker attestation." : blocker) : body.blockers;
      setPreflights(current => ({ ...current, [candidateId]: { ...body, blockers, localReceipt } as Preflight }));
    } catch (reason) { setPreflightErrors(current => ({ ...current, [candidateId]: requestedBaseline !== baselineRef.current ? "Channel settings changed. Check the candidate again." : reason instanceof Error ? reason.message : "Preflight is unavailable." })); }
    finally { setPreflightBusy(current => ({ ...current, [candidateId]: false })); }
  }
  async function runWorkerCheck(candidate: Candidate) {
    let options: unknown;
    try { options = JSON.parse(plannerOptions[candidate._id] ?? ""); if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(); }
    catch { setWorkerChecks(current => ({ ...current, [candidate._id]: { state: "error", message: "Enter original designer options as a JSON object." } })); return; }
    const signature = sha256Hex(canonicalJson({ candidate: candidate.fingerprint, baseline: candidate.baselineFingerprint, options }));
    const storageKey = `duration-candidate-check:${candidate._id}`;
    let requestKey: string;
    try {
      const previous = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      requestKey = previous?.signature === signature && typeof previous.key === "string" ? previous.key : crypto.randomUUID().replaceAll("-", "");
      sessionStorage.setItem(storageKey, JSON.stringify({ signature, key: requestKey }));
    } catch { setWorkerChecks(current => ({ ...current, [candidate._id]: { state: "error", message: "Session storage is required to retry this check safely." } })); return; }
    const sequence = (workerSequence.current[candidate._id] ?? 0) + 1;
    workerSequence.current[candidate._id] = sequence;
    setWorkerChecks(current => ({ ...current, [candidate._id]: { state: "pending", message: "Requesting local worker check..." } }));
    try {
      const response = await fetch("/api/channel-duration-candidate-worker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, candidateId: candidate._id, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, options, requestKey }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Worker check could not be requested.");
      if (typeof body.requestId !== "string") throw new Error("Worker check response was invalid.");
      for (let attempt = 0; attempt < 90 && sequence === workerSequence.current[candidate._id]; attempt++) {
        const statusResponse = await fetch(`/api/channel-duration-candidate-worker?channelId=${encodeURIComponent(channelId)}&candidateId=${encodeURIComponent(candidate._id)}&requestId=${encodeURIComponent(body.requestId)}`, { cache: "no-store" });
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(typeof status.error === "string" ? status.error : "Worker check status is unavailable.");
        if (status.state === "completed") {
          sessionStorage.removeItem(storageKey);
          setWorkerChecks(current => ({ ...current, [candidate._id]: { state: "completed", message: "Local worker check completed. The retained report is unattested and does not authorize dispatch." } }));
          setOpenReports(current => ({ ...current, [candidate._id]: true }));
          setReportRevision(current => ({ ...current, [candidate._id]: (current[candidate._id] ?? 0) + 1 }));
          return;
        }
        if (status.state === "failed") { sessionStorage.removeItem(storageKey); throw new Error(status.error || "Local worker check failed."); }
        if (!["pending", "queued", "running"].includes(status.state)) throw new Error("Worker check status was invalid.");
        setWorkerChecks(current => ({ ...current, [candidate._id]: { state: status.state, message: status.state === "running" ? "Local worker check is running..." : status.state === "queued" ? "Local worker check is queued..." : "Request received; dispatch is not yet confirmed." } }));
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (sequence === workerSequence.current[candidate._id]) throw new Error("Worker check has not finished. Retry to check the same request.");
    } catch (reason) { if (sequence === workerSequence.current[candidate._id]) setWorkerChecks(current => ({ ...current, [candidate._id]: { state: "error", message: reason instanceof Error ? reason.message : "Worker check is unavailable." } })); }
  }
  const inputStyle = { background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg, #f5f5f6)", border: "1px solid var(--color-border, #71717a)", borderRadius: 8, padding: "0.45rem 0.6rem", width: 120, maxWidth: "100%" };
  const buttonStyle = { background: "var(--color-accent, #e8e8ea)", color: "#0a0a0b", border: 0, borderRadius: 8, padding: "0.45rem 0.85rem", fontWeight: 600 };
  return <section aria-label="Duration draft" style={{ width: "100%", minWidth: 0, marginTop: "0.75rem" }}>
    <h3>Duration draft</h3>
    <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "0.5rem", margin: "0.5rem 0" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>Requested duration (minutes) <input style={inputStyle} type="number" min="0" step="any" required value={minutes} disabled={busy || !canRequest} onChange={event => { setMinutes(event.target.value); setDraft(null); setError(""); }} /></label>
      <button style={{ ...buttonStyle, opacity: busy || !canRequest || !minutes ? 0.5 : 1 }} type="submit" disabled={busy || !canRequest || !minutes}>{busy ? "Working..." : "Calculate draft"}</button>
    </form>
    {!canRequest && <button style={buttonStyle} type="button" onClick={onRequestOwner}>Verify owner</button>}
    {canRequest && error && <p role="alert">{error}</p>}
    {canRequest && draft && <div>
      <p><strong>{draft.savedToAccount ? "Saved candidate" : "Unsaved preview"}: {draft.requestedSeconds} sec</strong> for {draft.family}. Untested and not applied.</p>
      <p>Baseline: {draft.baselineFingerprint}. The existing route and preparation remain unchanged. A new route and qualification are required before any activation.</p>
      <pre>{JSON.stringify(draft.changes, null, 2)}</pre>
      {!draft.savedToAccount && <button style={buttonStyle} type="button" disabled={busy} onClick={() => void request(true)}>Save untested candidate</button>}
    </div>}
    <h4>Saved duration candidates</h4>
    {canRequest && listState === "loading" && <p role="status">Loading saved candidates...</p>}
    {canRequest && listState === "error" && <p role="alert">{listError}</p>}
    {canRequest && listState === "loaded" && candidates.length === 0 && <p>No saved duration candidates.</p>}
    {canRequest && listState === "loaded" && candidates.map(candidate => <details key={candidate._id}>
      <summary>Untested duration candidate: {candidate.requestedSeconds} sec ({candidate.baselineCurrent ? "current baseline" : "baseline changed"})</summary>
      <p>Not applied or qualified. Created {new Date(candidate.createdAt).toLocaleString()}. Candidate fingerprint: {candidate.fingerprint}. Baseline fingerprint: {candidate.baselineFingerprint}.</p>
      <p>Full saved pipeline before and after, in execution order. Existing routes and prepared evidence were not changed.</p>
      <h5>Original pipeline</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(candidate.baselinePipeline, null, 2)}</pre>
      <h5>Proposed pipeline</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(candidate.pipeline, null, 2)}</pre>
      {candidate.version === "duration-draft-candidate/v2" || candidate.version === "duration-draft-candidate/v3" ? <><h5>Original module settings</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(candidate.baselineModuleConfig, null, 2)}</pre><h5>Proposed module settings</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(candidate.moduleConfig, null, 2)}</pre></> : <p>This older candidate did not retain module settings.</p>}
      <h5>Compare benchmark evidence</h5>
      {!candidate.effectivePipeline ? <p>Comparison unavailable: this candidate lacks verified, resolvable frozen settings.</p> : !evidenceAvailable ? <p role="alert">Retained benchmark evidence could not be loaded.</p> : evidence.length === 0 ? <p>No retained benchmark evidence is available for comparison.</p> : <>
        <label>Retained benchmark <select disabled={preflightBusy[candidate._id]} value={selected[candidate._id] ?? ""} onChange={event => { setSelected(current => ({ ...current, [candidate._id]: event.target.value })); setPreflights(current => ({ ...current, [candidate._id]: undefined })); }}>
          <option value="">Select benchmark</option>
          {evidence.map(item => <option key={item.fingerprint} value={item.fingerprint}>{item.sourceRunId} ({new Date(item.createdAt).toLocaleDateString()})</option>)}
        </select></label>
        {evidence.filter(item => item.fingerprint === selected[candidate._id]).map(item => {
          const differences = comparePipelineCandidates(candidate.effectivePipeline!, item.entries);
          return <div key={item.fingerprint}>
            <p>Benchmark {item.sourceRunId}; worker {item.workerVersion}; evidence {item.fingerprint}.</p>
            {differences.length ? <ul>{differences.map(change => <li key={`${change.block}:${change.occurrence}`}>{change.block} ({change.occurrence}): {change.changes.join(", ")}</li>)}</ul> : <p>No differences in the displayed module entries.</p>}
            <details><summary>Compare full module entries</summary><h5>Draft with frozen module settings</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(candidate.effectivePipeline, null, 2)}</pre><h5>Retained benchmark</h5><pre style={{ overflowX: "auto" }}>{JSON.stringify(item.entries, null, 2)}</pre></details>
            <p>Compiler defaults and policy additions may appear as differences. This comparison does not qualify, approve or activate the draft; route, worker and final-master evidence must match a future candidate-specific benchmark.</p>
          </div>;
        })}
      </>}
      {evidenceUnavailableCount > 0 && <p role="alert">Some retained evidence could not be verified and was excluded.</p>}
      <h5>Candidate preflight</h5>
      <details open={!!openReports[candidate._id]} onToggle={event => { const open = event.currentTarget.open; setOpenReports(current => ({ ...current, [candidate._id]: open })); }}><summary>Local executable reports</summary>{openReports[candidate._id] && <LocalCompilationReports key={reportRevision[candidate._id] ?? 0} channelId={channelId} candidateId={candidate._id} />}</details>
      <details><summary>Supply original designer options</summary><p>Owner-supplied options have unverified historical provenance.</p><label>Designer options (JSON) <textarea style={{ ...inputStyle, width: "100%", minHeight: "6rem" }} value={plannerOptions[candidate._id] ?? ""} disabled={preflightBusy[candidate._id]} onChange={event => { setPlannerOptions(current => ({ ...current, [candidate._id]: event.target.value })); setPreflights(current => ({ ...current, [candidate._id]: undefined })); setPreflightErrors(current => ({ ...current, [candidate._id]: "" })); }} /></label></details>
      <p>Local worker check only. No provider calls, approval, or activation.</p>
      <button style={buttonStyle} type="button" disabled={!candidate.baselineCurrent || !candidate.effectivePipeline || ["pending", "queued", "running"].includes(workerChecks[candidate._id]?.state ?? "")} onClick={() => void runWorkerCheck(candidate)}>Run local worker check</button>
      {workerChecks[candidate._id] && <p role={workerChecks[candidate._id]!.state === "error" ? "alert" : "status"}>{workerChecks[candidate._id]!.message}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "0.5rem" }}><label style={{ display: "grid", gap: "0.25rem" }}>Maximum benchmark cost (USD) <input style={inputStyle} type="number" min="0.01" max="10000" step="0.01" value={ceilings[candidate._id] ?? ""} disabled={preflightBusy[candidate._id]} aria-invalid={!!preflightErrors[candidate._id]} aria-describedby={preflightErrors[candidate._id] ? `preflight-error-${candidate._id}` : undefined} onChange={event => { setCeilings(current => ({ ...current, [candidate._id]: event.target.value })); setPreflights(current => ({ ...current, [candidate._id]: undefined })); setPreflightErrors(current => ({ ...current, [candidate._id]: "" })); }} /></label>
      <button style={{ ...buttonStyle, opacity: preflightBusy[candidate._id] || !candidate.effectivePipeline || !ceilings[candidate._id] ? 0.5 : 1 }} type="button" disabled={preflightBusy[candidate._id] || !candidate.effectivePipeline || !ceilings[candidate._id]} onClick={() => void checkPreflight(candidate._id)}>{preflightBusy[candidate._id] ? "Checking..." : "Check preflight"}</button></div>
      {preflightErrors[candidate._id] && <p id={`preflight-error-${candidate._id}`} role="alert">{preflightErrors[candidate._id]}</p>}
      {preflights[candidate._id]?.preparedEvidence && <details><summary>Prepared benchmark settings</summary><p>Fingerprint: {preflights[candidate._id]!.preparedEvidence!.evidenceFingerprint}. This is a structural preview, not a compiled invocation or approval.</p><pre style={{ overflowX: "auto" }}>{JSON.stringify(preflights[candidate._id]!.preparedEvidence!.body, null, 2)}</pre></details>}
      {preflights[candidate._id] && <div role="status"><p>Blocked. No admission receipt or dispatch authorization was issued.</p>{preflights[candidate._id]!.localReceipt ? <p>Local preflight receipt: {preflights[candidate._id]!.localReceipt!.fingerprint}. Derived locally from owner-supplied, historically unattested options; not retained, not a worker attestation, and not authority to dispatch or qualify the channel.</p> : plannerOptions[candidate._id]?.trim() ? <p>No local preflight receipt was produced. Review the blockers below.</p> : null}<p>Binding fingerprint: {preflights[candidate._id]!.bindingFingerprint}. Ceiling: ${preflights[candidate._id]!.binding.maximumCostUsd}; saved budget: {preflights[candidate._id]!.binding.channelBudgetUsd === null ? "not set" : `$${preflights[candidate._id]!.binding.channelBudgetUsd}`}.</p>{preflights[candidate._id]!.routeEvidence && <p>Candidate route qualification binding: {preflights[candidate._id]!.routeEvidence!.binding.bindingFingerprint}. Visual Matter: {preflights[candidate._id]!.routeEvidence!.visualMatter.status}.</p>}{preflights[candidate._id]!.inceptionEvidence && <p>Inception plan evidence: {preflights[candidate._id]!.inceptionEvidence!.evidence.evidenceFingerprint}. Plan only; no provider calls authorized.</p>}{preflights[candidate._id]!.plannerEvidence && <p>Structural planner evidence: {preflights[candidate._id]!.plannerEvidence!.evidence.evidenceFingerprint}. Owner-supplied options, historical provenance unverified{preflights[candidate._id]!.localReceipt ? "; local executable planner validation passed." : "; executable planner validation remains outstanding."}</p>}<ul>{preflights[candidate._id]!.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div>}
    </details>)}
  </section>;
}
