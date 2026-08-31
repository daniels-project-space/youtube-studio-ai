"use client";

import { useCallback, useEffect, useState } from "react";

type Checkpoint = {
  id: string;
  decision: "awaiting" | "approved" | "rejected" | "blocked";
  createdAt?: number;
  reviewerId?: string;
  approvedAt?: number;
  rejectedAt?: number;
  blockedAt?: number;
  blockedReason?: string;
};

type ReviewPayload = {
  narrationAudioUrl?: string;
  narrationDurationSec?: number;
  narrationTranscriptText?: unknown;
  script?: unknown;
  narrationText?: unknown;
  storySpine?: unknown;
  episodeGraph?: unknown;
  sceneManifest?: unknown;
};

type DeskResponse = {
  ok: boolean;
  error?: string;
  checkpoint?: Checkpoint | null;
  review?: ReviewPayload;
  integrityError?: string;
};

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "Unavailable";
  }
}

/**
 * Deliberately thin owner desk: it only shows the server-derived frozen
 * narration/Story Spine/Episode Graph and posts an approve/reject decision.
 * No source data, profile, route, artifact, or resume payload is browser-led.
 */
export function FactualReviewPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<DeskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/factual-review-checkpoints?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const body = await response.json() as DeskResponse;
      setData(response.ok ? body : { ok: false, error: body.error ?? "Could not load factual review" });
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Could not load factual review" });
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(async (action: "approve" | "reject") => {
    if (!data?.checkpoint?.id || acting) return;
    setActing(action);
    try {
      const response = await fetch("/api/factual-review-checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, checkpointId: data.checkpoint.id }),
      });
      const body = await response.json() as DeskResponse;
      if (!response.ok || !body.ok) {
        setData((previous) => ({ ...previous, ok: false, error: body.error ?? "Review decision was not accepted" }));
        return;
      }
      await load();
    } catch (error) {
      setData((previous) => ({
        ...previous,
        ok: false,
        error: error instanceof Error ? error.message : "Review decision was not accepted",
      }));
    } finally {
      setActing(null);
    }
  }, [acting, data?.checkpoint?.id, load]);

  if (loading) {
    return <div className="glass" style={{ padding: "1.1rem" }}>Loading factual review…</div>;
  }
  if (!data?.checkpoint) return null;

  const isAwaiting = data.checkpoint.decision === "awaiting";
  const buttonStyle = (kind: "approve" | "reject") => ({
    padding: "0.5rem 0.8rem",
    borderRadius: 8,
    border: "1px solid",
    cursor: acting ? "wait" : "pointer",
    color: kind === "approve" ? "var(--color-ok)" : "var(--color-failed)",
    background: kind === "approve"
      ? "color-mix(in srgb, var(--color-ok) 13%, transparent)"
      : "color-mix(in srgb, var(--color-failed) 13%, transparent)",
    borderColor: kind === "approve"
      ? "color-mix(in srgb, var(--color-ok) 35%, transparent)"
      : "color-mix(in srgb, var(--color-failed) 35%, transparent)",
  });

  return (
    <section style={{ marginBottom: "1.75rem" }}>
      <div className="glass" style={{ padding: "1.15rem 1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Factual review before visuals</h2>
            <p style={{ margin: "0.4rem 0 0", color: "var(--color-muted)", fontSize: "0.86rem", maxWidth: 720 }}>
              This is the retained narration, Story Spine, and Episode Graph from the exact reviewed source-data run. Approval creates one fenced continuation; rejection requires a fresh revision.
            </p>
          </div>
          <span style={{ color: isAwaiting ? "var(--color-amber)" : "var(--color-muted)", fontSize: "0.82rem", fontFamily: "var(--font-mono)" }}>
            {data.checkpoint.decision}
          </span>
        </div>

        {data.error && <p style={{ color: "var(--color-failed)", margin: "0.9rem 0 0" }}>{data.error}</p>}
        {data.integrityError && (
          <p style={{ color: "var(--color-failed)", margin: "0.9rem 0 0" }}>
            Retained review integrity needs manual repair: {data.integrityError}
          </p>
        )}
        {data.checkpoint.blockedReason && (
          <p style={{ color: "var(--color-failed)", margin: "0.9rem 0 0" }}>{data.checkpoint.blockedReason}</p>
        )}

        {data.review && (
          <div style={{ display: "grid", gap: "0.85rem", marginTop: "1rem" }}>
            {data.review.narrationAudioUrl && (
              <audio controls preload="metadata" src={data.review.narrationAudioUrl} style={{ width: "100%" }}>
                Your browser cannot play the retained narration.
              </audio>
            )}
            <details open>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Narration transcript</summary>
              <pre style={preStyle}>{pretty(data.review.narrationTranscriptText ?? data.review.narrationText)}</pre>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Story Spine</summary>
              <pre style={preStyle}>{pretty(data.review.storySpine)}</pre>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Episode Graph</summary>
              <pre style={preStyle}>{pretty(data.review.episodeGraph)}</pre>
            </details>
          </div>
        )}

        {isAwaiting && !data.integrityError && (
          <div style={{ display: "flex", gap: "0.65rem", marginTop: "1rem", flexWrap: "wrap" }}>
            <button type="button" disabled={acting !== null} onClick={() => void decide("approve")} style={buttonStyle("approve")}>
              {acting === "approve" ? "Approving…" : "Approve & queue one continuation"}
            </button>
            <button type="button" disabled={acting !== null} onClick={() => void decide("reject")} style={buttonStyle("reject")}>
              {acting === "reject" ? "Rejecting…" : "Reject — require fresh revision"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

const preStyle = {
  margin: "0.65rem 0 0",
  padding: "0.75rem",
  overflow: "auto",
  maxHeight: 300,
  borderRadius: 8,
  background: "color-mix(in srgb, var(--color-bg) 65%, transparent)",
  color: "var(--color-muted)",
  fontSize: "0.78rem",
  whiteSpace: "pre-wrap" as const,
};
