"use client";

import { useCallback, useEffect, useState } from "react";

type Desk = {
  ok: boolean;
  error?: string;
  checkpoint?: { id?: string; decision: "awaiting" | "approved" | "rejected" | "blocked"; blockedReason?: string } | null;
  review?: { nativeWavUrl?: string; durationSec?: number; sampleRateHz?: number; channels?: number };
};

/** Owner-facing, server-derived native-WAV audition. Decisions intentionally
 * remain unavailable until the quality-receipt mutation exists. */
export function MusicAuditionPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<Desk | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/music-audition-checkpoints?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      setData(await response.json() as Desk);
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Could not load music audition" });
    }
  }, [runId]);
  useEffect(() => { void load(); }, [load]);
  const reject = useCallback(async () => {
    if (!data?.checkpoint?.id || rejecting) return;
    setRejecting(true);
    try {
      const response = await fetch("/api/music-audition-checkpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject", checkpointId: data.checkpoint.id }) });
      const body = await response.json() as Desk;
      if (!response.ok || !body.ok) setData({ ...data, error: body.error ?? "Music rejection was not accepted" }); else await load();
    } finally { setRejecting(false); }
  }, [data, load, rejecting]);
  if (!data?.checkpoint) return null;
  return <section className="glass" style={{ padding: "1rem 1.15rem", marginBottom: "1.25rem" }}>
    <h2 style={{ fontSize: "1rem", margin: 0 }}>Music audition</h2>
    <p style={{ color: "var(--color-muted)", margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
      Native worker WAV · {data.review?.sampleRateHz ? `${data.review.sampleRateHz / 1000} kHz` : "format loading"} · {data.review?.channels ?? 2} channels
    </p>
    {data.review?.nativeWavUrl && <audio controls preload="metadata" src={data.review.nativeWavUrl} style={{ width: "100%", marginTop: "0.75rem" }} />}
    {data.error && <p style={{ color: "var(--color-failed)", marginBottom: 0 }}>{data.error}</p>}
    {data.checkpoint.decision === "awaiting" && <p style={{ color: "var(--color-amber)", marginBottom: 0, fontSize: "0.84rem" }}>Awaiting section review and quality receipt before continuation.</p>}
    {data.checkpoint.decision === "awaiting" && <button type="button" disabled={rejecting} onClick={() => void reject()} style={{ marginTop: "0.75rem" }}>{rejecting ? "Rejecting…" : "Reject — create a fresh track"}</button>}
  </section>;
}
