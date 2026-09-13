"use client";

import { useEffect, useMemo, useState } from "react";
import { useOperationsAccess, useRequestOperationsAccess, type OperationsAccessState } from "@/components/OperationsAccess";
import styles from "./h3-render-console.module.css";

type Mode = "weekly" | "on-demand";
type H3Status = {
  ok: true;
  runId: string;
  triggerStatus: string;
  state: "pending" | "complete" | "reconciliation_required";
  receipt: { kind: "weekly" | "on-demand"; requestCount: number; completedCount: number; totalCostUsd: number } | null;
};

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

function contractPreview(value: unknown, mode: Mode): { valid: boolean; count: number } {
  const entries = mode === "weekly" ? (Array.isArray(value) ? value : []) : [value];
  if (entries.length < 1 || entries.length > (mode === "weekly" ? 60 : 1)) return { valid: false, count: entries.length };
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
  return { valid, count: entries.length };
}

export function H3RenderConsole() {
  const access = useOperationsAccess();
  const requestOwner = useRequestOperationsAccess();
  const [mode, setMode] = useState<Mode>("weekly");
  const [orderKey, setOrderKey] = useState("");
  const [receiptKey, setReceiptKey] = useState("");
  const [jobsJson, setJobsJson] = useState(weeklyExample);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState<{ runId: string; receiptKey: string; provider: "salad" | "novita" } | null>(null);
  const [status, setStatus] = useState<H3Status | null>(null);

  const parsedPreview = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(jobsJson);
      return contractPreview(parsed, mode);
    } catch {
      return { valid: false, count: 0 };
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

  function changeMode(next: Mode) {
    setMode(next);
    setJobsJson(next === "weekly" ? weeklyExample : onDemandExample);
    setStatus(null);
    setError("");
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

  if (access !== "owner") return <LockedConsole access={access} onRequestOwner={requestOwner} />;

  const provider = mode === "weekly" ? "Salad" : "Novita";
  const routeNote = mode === "weekly"
    ? "Weekly slate · medium priority · up to 3 RTX 5090 workers"
    : "One repair or preview clip · Novita spot GPU · no automatic retry";
  const progressPercent = !status ? 0 : status.state === "complete" ? 100 : status.state === "reconciliation_required" ? 92 : /EXECUTING|RUNNING|IN_PROGRESS/i.test(status.triggerStatus) ? 58 : 16;

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
          <span data-valid={parsedPreview.valid}>{parsedPreview.valid ? `${parsedPreview.count} sealed job${parsedPreview.count === 1 ? "" : "s"} ready` : "Complete the sealed job contract"}</span>
          <button type="button" onClick={() => void dispatch()} disabled={busy || !parsedPreview.valid}>{busy ? "Queuing…" : `Queue ${provider} render`}</button>
        </div>
        <small className={styles.contractHint}>The server rechecks the H3 model manifest, first-frame bytes, owner namespace, cost ceiling, and create-only receipt before any provider call.</small>
      </section>

      {(tracking || status || error) && (
        <section className={styles.progressCard} aria-live="polite" aria-label="H3 render progress">
          <div className={styles.progressHeader}><div><span className={styles.eyebrow}>Live progress · {tracking?.provider ?? provider}</span><strong>{status?.triggerStatus ?? "Queued"}</strong></div><b>{progressPercent}%</b></div>
          <div className={styles.progressTrack}><i style={{ width: `${progressPercent}%` }} /></div>
          <div className={styles.progressMeta}><span>{tracking?.runId ?? ""}</span>{status?.receipt ? <span>{status.receipt.completedCount}/{status.receipt.requestCount} outputs · ${status.receipt.totalCostUsd.toFixed(4)}</span> : <span>Waiting for Trigger and R2 receipt</span>}</div>
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
