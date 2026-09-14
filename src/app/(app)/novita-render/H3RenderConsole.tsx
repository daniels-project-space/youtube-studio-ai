"use client";

import { useEffect, useMemo, useState } from "react";
import { useOperationsAccess, useRequestOperationsAccess, type OperationsAccessState } from "@/components/OperationsAccess";
import styles from "./h3-render-console.module.css";

type Mode = "weekly" | "on-demand";
type H3Status = {
  ok: true;
  runId: string;
  triggerStatus: string;
  state: "pending" | "held" | "complete" | "reconciliation_required";
  requestPacketState: "frozen" | "missing" | "invalid" | "not-applicable";
  receipt: {
    kind: "weekly" | "on-demand";
    requestCount: number;
    completedCount: number;
    totalCostUsd: number;
    capacityMode?: "medium" | "high" | "mixed" | "spot";
  } | null;
  paidRequestStarted?: boolean;
};

type H3Capacity =
  | { state: "admitted"; capacity: { requiredGpuCount: number; availableGpuCount: number; capacityMode: "medium" | "high"; fallbackUsed: boolean } }
  | { state: "held"; reason: string; paidRequestStarted: false }
  | { state: "unavailable"; reason: string };

type FleetSnapshot = {
  ok: true;
  jobCount?: number;
  occupiedGpuSlots: number;
  globalGpuLimit: number;
  quota: { limit: number; used: number };
  lanes: Array<{
    id: string;
    label: string;
    model: string;
    requiredWorkers: number;
    mediumAvailable: number;
    highAvailable: number;
    recommendedPriority: "medium" | "high" | null;
    fallbackUsed: boolean;
    blockers: string[];
  }>;
};

const H3_TRACKING_STORAGE_KEY = "youtube-studio-ai:h3-render:tracking:v1";
type H3Tracking = { runId: string; receiptKey: string; provider: "salad" | "novita" };

const weeklyExample = JSON.stringify([
  {
    prompt: "Approved shot prompt",
    seed: 101,
    firstFrame: { r2Key: "owner/REPLACE/channel/batch/item/first-frame.png", sha256: "" },
    output: { r2Key: "owner/REPLACE/channel/batch/item/h3/shot-01.mp4" },
    maxCostUsd: 0.4,
  },
], null, 2);

const onDemandExample = JSON.stringify({
  prompt: "Approved repair shot prompt",
  seed: 101,
  firstFrame: { r2Key: "owner/REPLACE/channel/batch/item/first-frame.png", sha256: "" },
  output: { r2Key: "owner/REPLACE/channel/batch/item/h3/on-demand.mp4" },
  maxCostUsd: 0.4,
}, null, 2);

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return fallback;
}

function hasOwnerPath(value: unknown): value is string {
  return typeof value === "string" && /^owner\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value) && !value.includes("..") && !value.includes("\\");
}

function contractPreview(value: unknown, mode: Mode): { valid: boolean; count: number; issues: string[] } {
  const entries = mode === "weekly" ? (Array.isArray(value) ? value : []) : [value];
  const issues: string[] = [];
  const maxEntries = mode === "weekly" ? 60 : 1;
  if (entries.length < 1) issues.push(mode === "weekly" ? "Add at least one approved job." : "Add one approved job.");
  if (entries.length > maxEntries) issues.push(`This lane accepts at most ${maxEntries} job${maxEntries === 1 ? "" : "s"}.`);
  if (mode === "weekly" && !Array.isArray(value)) issues.push("Weekly batch input must be a JSON array.");
  const valid = entries.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    const frame = row.firstFrame;
    const output = row.output;
    return typeof row.prompt === "string" && row.prompt.trim().length > 0 && Number.isInteger(row.seed) &&
      typeof row.maxCostUsd === "number" && Number.isFinite(row.maxCostUsd) && row.maxCostUsd > 0 &&
      !!frame && typeof frame === "object" && !Array.isArray(frame) && hasOwnerPath((frame as Record<string, unknown>).r2Key) &&
      typeof (frame as Record<string, unknown>).sha256 === "string" && /^[a-f0-9]{64}$/u.test((frame as Record<string, unknown>).sha256 as string) &&
      !!output && typeof output === "object" && !Array.isArray(output) && hasOwnerPath((output as Record<string, unknown>).r2Key);
  });
  if (!valid && entries.length > 0 && issues.length === 0) {
    issues.push("Every job needs a prompt, integer seed, SHA-256 first-frame digest, owner-scoped frame/output keys, and a positive cost ceiling.");
  }
  return { valid: valid && issues.length === 0, count: entries.length, issues };
}

function loadStoredTracking(): H3Tracking | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(H3_TRACKING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<H3Tracking>;
    return typeof parsed.runId === "string" && typeof parsed.receiptKey === "string" &&
      (parsed.provider === "salad" || parsed.provider === "novita")
      ? { runId: parsed.runId, receiptKey: parsed.receiptKey, provider: parsed.provider }
      : null;
  } catch {
    return null;
  }
}

export function H3RenderConsole() {
  const access = useOperationsAccess();
  const requestOwner = useRequestOperationsAccess();
  const [mode, setMode] = useState<Mode>("weekly");
  const [orderKey, setOrderKey] = useState("");
  const [receiptKey, setReceiptKey] = useState("");
  const [jobsJson, setJobsJson] = useState(weeklyExample);
  const [busy, setBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState<H3Tracking | null>(null);
  const [status, setStatus] = useState<H3Status | null>(null);
  const [capacity, setCapacity] = useState<H3Capacity | null>(null);
  const [capacityBusy, setCapacityBusy] = useState(false);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [fleetBusy, setFleetBusy] = useState(false);

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    let modeFrame: number | undefined;
    if (requestedMode === "weekly" || requestedMode === "on-demand") {
      modeFrame = window.setTimeout(() => {
        setMode(requestedMode);
        setJobsJson(requestedMode === "weekly" ? weeklyExample : onDemandExample);
      }, 0);
    }
    const stored = loadStoredTracking();
    const trackingFrame = stored ? window.setTimeout(() => setTracking(stored), 0) : undefined;
    return () => {
      if (modeFrame !== undefined) window.clearTimeout(modeFrame);
      if (trackingFrame !== undefined) window.clearTimeout(trackingFrame);
    };
  }, []);

  useEffect(() => {
    try {
      if (tracking) window.localStorage.setItem(H3_TRACKING_STORAGE_KEY, JSON.stringify(tracking));
      else window.localStorage.removeItem(H3_TRACKING_STORAGE_KEY);
    } catch {
      // A storage-denied browser can still track the active run in memory.
    }
  }, [tracking]);

  const parsedPreview = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(jobsJson);
      return contractPreview(parsed, mode);
    } catch {
      return { valid: false, count: 0, issues: ["Job JSON is not valid."] };
    }
  }, [jobsJson, mode]);

  useEffect(() => {
    if (!tracking) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/minimax-h3/status?runId=${encodeURIComponent(tracking.runId)}&receiptKey=${encodeURIComponent(tracking.receiptKey)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(errorMessage(body, "Could not read H3 progress."));
        setStatus(body as H3Status);
        setError("");
        if ((body as H3Status).state === "pending") timer = window.setTimeout(poll, 5_000);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not read H3 progress.");
        timer = window.setTimeout(poll, 8_000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [tracking]);

  // A capacity-held Salad run is safe to observe again, but never safe to
  // resubmit implicitly: admission may discover a costlier high-priority tier
  // and paid retry still requires the operator's explicit action. A short
  // background recheck keeps the held desk useful while avoiding a busy poll.
  useEffect(() => {
    if (
      mode !== "weekly" || tracking?.provider !== "salad" ||
      status?.state !== "held" || !parsedPreview.valid
    ) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/minimax-h3/capacity?jobCount=${parsedPreview.count}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => null) as H3Capacity | null;
        if (!cancelled && response.ok && body && "state" in body) {
          setCapacity(body);
          // Once admission is visible, stop polling. The next paid attempt
          // remains a deliberate click so a high-tier charge is never hidden.
          if (body.state === "admitted") return;
        }
      } catch {
        // The existing held state remains authoritative; a transient read
        // failure must not turn into a retry or overwrite its explanation.
      }
      if (!cancelled) timer = window.setTimeout(poll, 60_000);
    };
    timer = window.setTimeout(poll, 15_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [mode, parsedPreview.count, parsedPreview.valid, status?.state, tracking?.provider]);

  function changeMode(next: Mode) {
    setMode(next);
    setJobsJson(next === "weekly" ? weeklyExample : onDemandExample);
    setStatus(null);
    setError("");
  }

  function clearTracking() {
    setTracking(null);
    setStatus(null);
    setError("");
  }

  async function checkCapacity() {
    if (mode !== "weekly" || !parsedPreview.valid) return;
    setCapacityBusy(true);
    setCapacity(null);
    try {
      const response = await fetch(`/api/minimax-h3/capacity?jobCount=${parsedPreview.count}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as H3Capacity | { error?: string } | null;
      if (!response.ok || !body || !("state" in body)) throw new Error(errorMessage(body, "Capacity check failed."));
      setCapacity(body as H3Capacity);
    } catch (reason) {
      setCapacity({ state: "unavailable", reason: reason instanceof Error ? reason.message : "Capacity check failed." });
    } finally {
      setCapacityBusy(false);
    }
  }

  async function dispatch() {
    if (access !== "owner") {
      requestOwner();
      return;
    }
    const trimmedOrder = orderKey.trim();
    const trimmedReceipt = receiptKey.trim();
    if (!trimmedOrder || !trimmedReceipt) {
      setError("Order key and owner-scoped receipt key are required.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jobsJson);
    } catch {
      setError("Job JSON is not valid.");
      return;
    }
    const body = mode === "weekly"
      ? { orderKey: trimmedOrder, receiptKey: trimmedReceipt, jobs: parsed }
      : { orderKey: trimmedOrder, receiptKey: trimmedReceipt, request: parsed };
    const count = mode === "weekly" && Array.isArray(parsed) ? parsed.length : 1;
    if (!window.confirm(`Start paid MiniMax H3 ${mode === "weekly" ? "weekly Salad batch" : "Novita on-demand render"} for ${count} shot${count === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    setError("");
    setStatus(null);
    try {
      const response = await fetch(`/api/minimax-h3/${mode}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; triggerRunId?: string; requestKey?: string; requestKeys?: string[]; error?: string } | null;
      if (!response.ok || payload?.ok !== true || !payload.triggerRunId) throw new Error(errorMessage(payload, "H3 render could not be queued."));
      setTracking({ runId: payload.triggerRunId, receiptKey: trimmedReceipt, provider: mode === "weekly" ? "salad" : "novita" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "H3 render could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  async function inspectFleet() {
    setFleetBusy(true);
    setFleet(null);
    try {
      const requestedJobs = parsedPreview.valid ? parsedPreview.count : 1;
      const response = await fetch(`/api/salad/capacity?jobCount=${requestedJobs}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as FleetSnapshot | { error?: string } | null;
      if (!response.ok || !body || !("ok" in body) || body.ok !== true) throw new Error(errorMessage(body, "Fleet snapshot failed."));
      setFleet(body as FleetSnapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fleet snapshot failed.");
    } finally {
      setFleetBusy(false);
    }
  }

  async function retryHeld() {
    if (!tracking || !status || status.state !== "held" || tracking.provider !== "salad") return;
    setRetryBusy(true);
    setError("");
    try {
      const response = await fetch("/api/minimax-h3/retry", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ runId: tracking.runId, receiptKey: tracking.receiptKey }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; triggerRunId?: string; error?: string } | null;
      if (!response.ok || payload?.ok !== true || !payload.triggerRunId) throw new Error(errorMessage(payload, "Capacity-held batch could not be re-queued."));
      setTracking({ runId: payload.triggerRunId, receiptKey: tracking.receiptKey, provider: "salad" });
      setStatus(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Capacity-held batch could not be re-queued.");
    } finally {
      setRetryBusy(false);
    }
  }

  if (access !== "owner") return <LockedConsole access={access} onRequestOwner={requestOwner} />;

  const provider = mode === "weekly" ? "Salad" : "Novita";
  const routeNote = mode === "weekly"
    ? "Weekly slate · medium first · high fallback · up to 3 RTX 5090 workers"
    : "One repair or preview clip · Novita spot GPU · no automatic retry";
  const progressPercent = !status ? 0 : status.state === "complete" ? 100 : status.state === "held" ? 8 : status.state === "reconciliation_required" ? 92 : /EXECUTING|RUNNING|IN_PROGRESS/i.test(status.triggerStatus) ? 58 : 16;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>H3 render control</span>
          <h1>MiniMax H3</h1>
          <p>One sealed contract. Two deliberate lanes.</p>
        </div>
        <div className={styles.routeBadge}><strong>{provider}</strong><span>{routeNote}</span></div>
      </header>

      <section className={styles.modeTabs} aria-label="H3 render lane">
        <button type="button" data-active={mode === "weekly"} onClick={() => changeMode("weekly")}><strong>Weekly batch</strong><span>Salad · 1–60 approved shots</span></button>
        <button type="button" data-active={mode === "on-demand"} onClick={() => changeMode("on-demand")}><strong>On demand</strong><span>Novita · one approved shot</span></button>
      </section>

      <section className={styles.formCard} aria-label={`${provider} H3 dispatch form`}>
        <div className={styles.fieldGrid}>
          <label><span>Order key</span><input value={orderKey} onChange={(event) => setOrderKey(event.target.value)} placeholder="week-2026-09-14" /></label>
          <label><span>Owner receipt key</span><input value={receiptKey} onChange={(event) => setReceiptKey(event.target.value)} placeholder="owner/.../h3/receipt.json" /></label>
        </div>
        <label className={styles.jobsField}><span>{mode === "weekly" ? "Approved jobs JSON array" : "Approved job JSON"}</span><textarea value={jobsJson} onChange={(event) => setJobsJson(event.target.value)} rows={12} spellCheck={false} /></label>
        <div className={styles.formFooter}>
          <span data-valid={parsedPreview.valid}>{parsedPreview.valid ? `${parsedPreview.count} sealed job${parsedPreview.count === 1 ? "" : "s"} ready` : (parsedPreview.issues[0] ?? "Complete the sealed job contract")}</span>
          <button type="button" onClick={() => void dispatch()} disabled={busy || !parsedPreview.valid}>{busy ? "Queuing…" : `Queue ${provider} render`}</button>
        </div>
        {mode === "weekly" && <div className={styles.capacityTools}>
          <button type="button" className={styles.secondaryButton} onClick={() => void checkCapacity()} disabled={capacityBusy || !parsedPreview.valid}>{capacityBusy ? "Checking Salad…" : "Check Salad capacity"}</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void inspectFleet()} disabled={fleetBusy}>{fleetBusy ? "Reading fleet…" : "Fleet snapshot"}</button>
          {capacity && <span className={styles.capacityNotice} data-state={capacity.state} role="status">
            {capacity.state === "admitted"
              ? capacity.capacity.fallbackUsed
                ? `Admits ${capacity.capacity.requiredGpuCount} worker${capacity.capacity.requiredGpuCount === 1 ? "" : "s"} at high priority fallback (medium unavailable).`
                : `Admits ${capacity.capacity.requiredGpuCount} worker${capacity.capacity.requiredGpuCount === 1 ? "" : "s"} at medium priority.`
              : capacity.state === "held"
                ? `Held before spend · ${capacity.reason}`
              : `Capacity check unavailable · ${capacity.reason}`}
          </span>}
        </div>}
        {fleet && <div className={styles.fleetSummary} role="status" aria-label="Salad fleet snapshot">
          <div className={styles.fleetHeader}><strong>Salad fleet{fleet.jobCount ? ` · ${fleet.jobCount}-job wave` : ""}</strong><span>Lease {fleet.occupiedGpuSlots}/{fleet.globalGpuLimit} · quota {fleet.quota.used}/{fleet.quota.limit}</span></div>
          <div className={styles.fleetLanes}>
            {fleet.lanes.map((lane) => <div key={lane.id} className={styles.fleetLane} data-state={lane.recommendedPriority ?? "held"}>
              <span><strong>{lane.label}</strong><small>{lane.model}</small></span>
              <b>{lane.recommendedPriority === "high" ? "HIGH FALLBACK" : lane.recommendedPriority?.toUpperCase() ?? "HELD"}</b>
              <small>need {lane.requiredWorkers} · M {lane.mediumAvailable} · H {lane.highAvailable}</small>
            </div>)}
          </div>
        </div>}
        {!parsedPreview.valid && parsedPreview.issues.length > 1 && <ul className={styles.validationIssues}>{parsedPreview.issues.slice(1, 3).map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        <small className={styles.contractHint}>The server rechecks the H3 model manifest, first-frame bytes, owner namespace, cost ceiling, and create-only receipt before any provider call.</small>
      </section>

      {(tracking || status || error) && (
        <section className={styles.progressCard} aria-live="polite" aria-label="H3 render progress">
          <div className={styles.progressHeader}><div><span className={styles.eyebrow}>Live progress · {tracking?.provider ?? provider}</span><strong>{status?.triggerStatus ?? "Queued"}</strong></div><b>{progressPercent}%</b></div>
          <div className={styles.progressTrack}><i style={{ width: `${progressPercent}%` }} /></div>
          <div className={styles.progressMeta}><span>{tracking?.runId ?? ""}</span>{status?.receipt ? <span>{status.receipt.completedCount}/{status.receipt.requestCount} outputs · ${status.receipt.totalCostUsd.toFixed(4)}</span> : <span>Waiting for Trigger and R2 receipt</span>}{status?.receipt?.capacityMode && <span data-capacity-mode={status.receipt.capacityMode}>Tier {status.receipt.capacityMode === "high" ? "high fallback" : status.receipt.capacityMode}</span>}{status?.requestPacketState === "frozen" && <span>Inputs frozen</span>}{status?.requestPacketState === "missing" && <span className={styles.warn}>Request packet missing</span>}{status?.requestPacketState === "invalid" && <span className={styles.warn}>Request packet invalid</span>}<button type="button" className={styles.clearButton} onClick={clearTracking}>Clear tracking</button></div>
          {status?.state === "held" && <div className={styles.holdAction}><span className={styles.holdCopy}><strong className={styles.warn}>Held before spend: Salad capacity was unavailable.</strong><small>Next check uses medium first, then high only if it unlocks this wave.</small></span><button type="button" className={styles.secondaryButton} onClick={() => void retryHeld()} disabled={retryBusy}>{retryBusy ? "Rechecking capacity…" : capacity?.state === "admitted" ? capacity.capacity.fallbackUsed ? "Retry with high priority" : "Retry at medium priority" : "Check again"}</button></div>}
          {status?.state === "reconciliation_required" && <strong className={styles.warn}>Provider run ended without a durable receipt. Reconcile before retrying.</strong>}
          {error && <strong className={styles.error}>{error}</strong>}
        </section>
      )}
    </main>
  );
}

function LockedConsole({ access, onRequestOwner }: { access: OperationsAccessState; onRequestOwner: () => void }) {
  return <main className={styles.page}><section className={styles.locked}><span className={styles.eyebrow}>{access === "checking" ? "Checking access" : "Paid compute"}</span><h1>MiniMax H3 render lanes</h1><p>{access === "checking" ? "Reading this browser session." : "Owner access is required to submit a paid Salad or Novita job."}</p>{access !== "checking" && <button type="button" onClick={onRequestOwner}>Verify owner</button>}</section></main>;
}
