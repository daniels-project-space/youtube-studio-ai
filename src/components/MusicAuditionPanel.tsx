"use client";

import { useCallback, useEffect, useState } from "react";

type Desk = {
  ok: boolean;
  error?: string;
  checkpoint?: { decision: "awaiting" | "approved" | "rejected" | "blocked"; blockedReason?: string } | null;
  review?: { nativeWavUrl?: string; durationSec?: number; sampleRateHz?: number; channels?: number };
};

/** Owner-facing, server-derived native-WAV audition. Decisions intentionally
 * remain unavailable until the quality-receipt mutation exists. */
export function MusicAuditionPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<Desk | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/music-audition-checkpoints?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      setData(await response.json() as Desk);
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Could not load music audition" });
    }
  }, [runId]);
  useEffect(() => { void load(); }, [load]);
  if (!data?.checkpoint) return null;
  return <section className="glass" style={{ padding: "1rem 1.15rem", marginBottom: "1.25rem" }}>
    <h2 style={{ fontSize: "1rem", margin: 0 }}>Music audition</h2>
    <p style={{ color: "var(--color-muted)", margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
      Native worker WAV · {data.review?.sampleRateHz ? `${data.review.sampleRateHz / 1000} kHz` : "format loading"} · {data.review?.channels ?? 2} channels
    </p>
    {data.review?.nativeWavUrl && <audio controls preload="metadata" src={data.review.nativeWavUrl} style={{ width: "100%", marginTop: "0.75rem" }} />}
    {data.error && <p style={{ color: "var(--color-failed)", marginBottom: 0 }}>{data.error}</p>}
    {data.checkpoint.decision === "awaiting" && <p style={{ color: "var(--color-amber)", marginBottom: 0, fontSize: "0.84rem" }}>Awaiting section review and quality receipt before continuation.</p>}
  </section>;
}
