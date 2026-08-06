"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

interface PublishIntentRow {
  _id: string;
  channelId: string;
  title: string;
  status: string;
  privacyStatus: string;
  publishAt?: number;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: number;
  videoSha256: string;
}

interface LearningRecommendationRow {
  _id: string;
  channelId: string;
  kind: string;
  target: string;
  status: string;
  basePolicyVersion: number;
  proposedPolicyVersion: number;
  sourceVideoIds: string[];
  dataWindowStart: string;
  dataWindowEnd: string;
  proposal: unknown;
  offlineEvaluation: {
    method: string;
    sampleSize: number;
    baselineScore?: number;
    candidateScore?: number;
    passed: boolean;
    notes: string;
  };
  createdAt: number;
}

const card: CSSProperties = {
  padding: "1rem 1.1rem",
  display: "grid",
  gap: "0.65rem",
};
const row: CSSProperties = {
  display: "flex",
  gap: "0.55rem",
  alignItems: "center",
  flexWrap: "wrap",
};
const button: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface)",
  color: "var(--color-fg)",
  padding: "0.45rem 0.75rem",
  cursor: "pointer",
  fontSize: "0.76rem",
  fontWeight: 600,
};

function fmtDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function proposalSummary(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 420 ? `${text.slice(0, 420)}…` : text;
  } catch {
    return "Proposal details unavailable";
  }
}

export default function SettingsPage() {
  const [intents, setIntents] = useState<PublishIntentRow[]>([]);
  const [recommendations, setRecommendations] = useState<LearningRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [publishResponse, learningResponse] = await Promise.all([
        fetch("/api/publish-intents", { cache: "no-store" }),
        fetch("/api/learning-recommendations", { cache: "no-store" }),
      ]);
      const [publishBody, learningBody] = await Promise.all([
        publishResponse.json(),
        learningResponse.json(),
      ]);
      if (!publishResponse.ok) throw new Error(publishBody.error ?? "Could not load publish intents");
      if (!learningResponse.ok) throw new Error(learningBody.error ?? "Could not load learning recommendations");
      setIntents((publishBody.intents ?? []).sort((a: PublishIntentRow, b: PublishIntentRow) => b.createdAt - a.createdAt));
      setRecommendations(
        (learningBody.recommendations ?? []).sort(
          (a: LearningRecommendationRow, b: LearningRecommendationRow) => b.createdAt - a.createdAt,
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (endpoint: string, body: Record<string, unknown>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Operator action failed");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyId(null);
    }
  };

  const pendingIntents = useMemo(
    () => intents.filter((intent) => intent.status === "awaiting_approval"),
    [intents],
  );
  const pendingRecommendations = useMemo(
    () => recommendations.filter((recommendation) => recommendation.status === "proposed"),
    [recommendations],
  );

  return (
    <>
      <PageHeader
        title="Governance & settings"
        subtitle="Approve external publishing and evidence-backed learning changes; inspect durable history"
        actions={<button onClick={() => void load()} disabled={loading} style={button}>Refresh</button>}
      />

      {error && (
        <div className="glass" style={{ ...card, marginBottom: "1rem", border: "1px solid rgba(248,113,113,0.5)", color: "#f87171" }}>
          {error}
        </div>
      )}

      <section style={{ marginBottom: "1.8rem" }}>
        <SectionTitle>Publish approvals ({pendingIntents.length})</SectionTitle>
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {loading ? <div style={{ color: "var(--color-muted)" }}>Loading durable publish intents…</div> : pendingIntents.length === 0 ? (
            <div className="glass" style={card}>No uploads are waiting for approval.</div>
          ) : pendingIntents.map((intent) => (
            <article key={intent._id} className="glass" style={card}>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <strong>{intent.title}</strong>
                <span className="status-chip">{intent.privacyStatus}</span>
              </div>
              <div style={{ fontSize: "0.74rem", color: "var(--color-muted)" }}>
                Channel {intent.channelId} · created {fmtDate(intent.createdAt)} · publish {fmtDate(intent.publishAt)} · artifact {intent.videoSha256.slice(0, 12)}…
              </div>
              <div style={row}>
                <button
                  style={{ ...button, background: "var(--color-accent)", color: "#0a0a0b" }}
                  disabled={busyId === intent._id}
                  onClick={() => {
                    if (!window.confirm(`Approve ${intent.privacyStatus} publishing for “${intent.title}”?`)) return;
                    void act("/api/publish-intents", {
                      action: "approve",
                      intentId: intent._id,
                      evidence: "approved in governance console",
                    }, intent._id);
                  }}
                >Approve upload</button>
                <button
                  style={{ ...button, color: "#f87171" }}
                  disabled={busyId === intent._id}
                  onClick={() => {
                    if (!window.confirm(`Cancel the pending upload for “${intent.title}”?`)) return;
                    void act("/api/publish-intents", { action: "cancel", intentId: intent._id }, intent._id);
                  }}
                >Cancel</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "1.8rem" }}>
        <SectionTitle>Learning proposals ({pendingRecommendations.length})</SectionTitle>
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {loading ? <div style={{ color: "var(--color-muted)" }}>Loading evidence-backed proposals…</div> : pendingRecommendations.length === 0 ? (
            <div className="glass" style={card}>No policy changes are waiting for approval.</div>
          ) : pendingRecommendations.map((recommendation) => (
            <article key={recommendation._id} className="glass" style={card}>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <strong>{recommendation.kind.replaceAll("_", " ")} → {recommendation.target.replaceAll("_", " ")}</strong>
                <span className="status-chip" style={{ color: recommendation.offlineEvaluation.passed ? "var(--color-ok)" : "#f87171" }}>
                  offline {recommendation.offlineEvaluation.passed ? "passed" : "failed"}
                </span>
              </div>
              <div style={{ fontSize: "0.74rem", color: "var(--color-muted)" }}>
                Policy v{recommendation.basePolicyVersion} → v{recommendation.proposedPolicyVersion} · {recommendation.dataWindowStart} to {recommendation.dataWindowEnd} · n={recommendation.offlineEvaluation.sampleSize}
              </div>
              <div style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>{recommendation.offlineEvaluation.notes}</div>
              <code style={{ fontSize: "0.7rem", color: "var(--color-muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {proposalSummary(recommendation.proposal)}
              </code>
              <div style={row}>
                <button
                  style={{ ...button, background: "var(--color-accent)", color: "#0a0a0b" }}
                  disabled={busyId === recommendation._id || !recommendation.offlineEvaluation.passed}
                  onClick={() => {
                    if (!window.confirm("Activate this evaluated policy version? The previous version remains in recommendation history.")) return;
                    void act("/api/learning-recommendations", {
                      action: "approve_and_activate",
                      recommendationId: recommendation._id,
                    }, recommendation._id);
                  }}
                >Approve & activate</button>
                <button
                  style={{ ...button, color: "#f87171" }}
                  disabled={busyId === recommendation._id}
                  onClick={() => void act("/api/learning-recommendations", {
                    action: "reject",
                    recommendationId: recommendation._id,
                  }, recommendation._id)}
                >Reject</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Recent durable history</SectionTitle>
        <div className="glass" style={card}>
          {intents.slice(0, 12).map((intent) => (
            <div key={intent._id} style={{ ...row, justifyContent: "space-between", fontSize: "0.76rem", borderBottom: "1px solid var(--color-border)", paddingBottom: "0.45rem" }}>
              <span>{intent.title}</span>
              <span style={{ color: "var(--color-muted)" }}>{intent.status} · {intent.attempts}/{intent.maxAttempts}</span>
            </div>
          ))}
          {intents.length === 0 && <span style={{ color: "var(--color-muted)" }}>No publish history yet.</span>}
        </div>
      </section>
    </>
  );
}
