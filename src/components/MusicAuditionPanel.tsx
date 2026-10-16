"use client";

import { useCallback, useEffect, useState } from "react";
import { assessMusicAuditionApprovalReadiness } from "@/engine/musicAuditionReview";

type Section = { id: string; label: string; instruction: string };
type NativeQuality = {
  version: string;
  measurements: Record<MeasurementKey, number>;
  openingHighBand: { startSec: number; durationSec: number; meanDbfs: number };
  postOpeningHighBand: { startSec: number; durationSec: number; meanDbfs: number };
};
type SavedReview = {
  reviewedAt: number;
  sectionReviews: { sectionId: string; score: number; evidence: string }[];
  audition: { emotionalDepthScore: number; arrangementDepthScore: number; hollowOrGeneric: boolean; verdict: "fail"; notes: string };
};
type Desk = {
  ok: boolean;
  error?: string;
  checkpoint?: { id?: string; decision: "awaiting" | "approved" | "rejected" | "blocked"; blockedReason?: string; savedReview?: SavedReview } | null;
  review?: {
    nativeWavUrl?: string; audioLabel?: string; durationSec?: number; sampleRateHz?: number; channels?: number;
    nativeQuality?: NativeQuality; sections?: Section[]; technicalQualityPass?: boolean;
    approvalThresholds?: { minimumSectionScore: number; minimumEmotionalDepthScore: number; minimumArrangementDepthScore: number };
  };
};

const measurementKeys = [
  "integratedLufs", "truePeakDbtp", "lraLu", "crestDb", "clippedSamples",
  "maximumConsecutiveCeilingSamples", "dcOffsetAbsolute", "silenceFraction", "mechanicalArtifactScore", "openingHighBandDropDb",
] as const;
type MeasurementKey = typeof measurementKeys[number];

const measurementLabels: Record<MeasurementKey, string> = {
  integratedLufs: "integrated LUFS",
  truePeakDbtp: "true peak dBTP",
  lraLu: "loudness range LU",
  crestDb: "crest dB",
  clippedSamples: "clipped samples",
  maximumConsecutiveCeilingSamples: "ceiling run",
  dcOffsetAbsolute: "DC offset",
  silenceFraction: "silence fraction",
  mechanicalArtifactScore: "spectral fault score",
  openingHighBandDropDb: "opening HF drop dB",
};

/** Owner-facing native-WAV desk. Only human observations leave this component. */
export function MusicAuditionPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<Desk | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sectionReviews, setSectionReviews] = useState<Record<string, { score: string; evidence: string }>>({});
  const [emotionalDepthScore, setEmotionalDepthScore] = useState("");
  const [arrangementDepthScore, setArrangementDepthScore] = useState("");
  const [hollowOrGeneric, setHollowOrGeneric] = useState(false);
  const [notes, setNotes] = useState("");
  const sections = data?.review?.sections;
  const approvalReadiness = assessMusicAuditionApprovalReadiness({
    sections: sections ?? [], sectionReviews, emotionalDepthScore, arrangementDepthScore,
    hollowOrGeneric, notes, thresholds: data?.review?.approvalThresholds,
    technicalQualityPass: data?.review?.technicalQualityPass,
  });
  const { reviewComplete: completeReview, approvalReady } = approvalReadiness;
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/music-audition-checkpoints?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      const next = await response.json() as Desk;
      setData(next);
      if (next.review?.sections) {
        setSectionReviews((current) => Object.fromEntries(next.review!.sections!.map((section) => [section.id, current[section.id] ?? { score: "", evidence: "" }])));
      }
    } catch (error) {
      setData({ ok: false, error: error instanceof Error ? error.message : "Could not load music audition" });
    }
  }, [runId]);
  useEffect(() => {
    // Defer the remote desk load so this effect subscribes to an asynchronous
    // external source instead of synchronously cascading a local state update.
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const reject = useCallback(async () => {
    if (!data?.checkpoint?.id || rejecting || !completeReview) return;
    setRejecting(true);
    try {
      const response = await fetch("/api/music-audition-checkpoints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject", checkpointId: data.checkpoint.id, runId,
          sectionReviews: (sections ?? []).map((section) => ({ sectionId: section.id, score: Number(sectionReviews[section.id]?.score), evidence: sectionReviews[section.id]?.evidence ?? "" })),
          audition: { emotionalDepthScore: Number(emotionalDepthScore), arrangementDepthScore: Number(arrangementDepthScore), hollowOrGeneric, verdict: "fail", notes },
        }),
      });
      const body = await response.json() as Desk;
      if (!response.ok || !body.ok) setData({ ...data, error: body.error ?? "Music rejection was not accepted" }); else await load();
    } finally { setRejecting(false); }
  }, [completeReview, data, emotionalDepthScore, arrangementDepthScore, hollowOrGeneric, load, notes, rejecting, runId, sectionReviews, sections]);
  const approve = useCallback(async () => {
    if (!data?.checkpoint?.id || approving || !approvalReady) return;
    setApproving(true);
    try {
      const response = await fetch("/api/music-audition-checkpoints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve", checkpointId: data.checkpoint.id, runId,
          sectionReviews: (data.review?.sections ?? []).map((section) => ({ sectionId: section.id, score: Number(sectionReviews[section.id]?.score), evidence: sectionReviews[section.id]?.evidence ?? "" })),
          audition: { emotionalDepthScore: Number(emotionalDepthScore), arrangementDepthScore: Number(arrangementDepthScore), hollowOrGeneric, verdict: hollowOrGeneric ? "fail" : "pass", notes },
        }),
      });
      const body = await response.json() as Desk;
      if (!response.ok || !body.ok) setData({ ...data, error: body.error ?? "Music approval was not accepted" }); else await load();
    } finally { setApproving(false); }
  }, [approvalReady, approving, arrangementDepthScore, data, emotionalDepthScore, hollowOrGeneric, notes, runId, sectionReviews, load]);
  if (!data?.checkpoint) return null;
  const inputStyle = { minWidth: 0, width: "100%", padding: "0.45rem 0.55rem" };
  return <section className="glass" style={{ padding: "1rem 1.15rem", marginBottom: "1.25rem" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
      <h2 style={{ fontSize: "1rem", margin: 0 }}>Music audition</h2>
      <span style={{ color: data.checkpoint.decision === "approved" ? "var(--color-success)" : "var(--color-amber)", fontSize: "0.78rem" }}>{data.checkpoint.decision}</span>
    </div>
    <p style={{ color: "var(--color-muted)", margin: "0.35rem 0 0", fontSize: "0.88rem" }}>Native worker WAV · {data.review?.sampleRateHz ? `${data.review.sampleRateHz / 1000} kHz` : "format loading"} · {data.review?.channels ?? 2} channels</p>
    {data.review?.nativeWavUrl && <>
      <p>{data.review.audioLabel ?? "Native worker WAV"}</p>
      <audio controls preload="metadata" src={data.review.nativeWavUrl} style={{ width: "100%", marginTop: "0.75rem" }} />
    </>}
    {data.error && <p style={{ color: "var(--color-failed)", marginBottom: 0 }}>{data.error}</p>}
    {data.checkpoint.decision === "awaiting" && completeReview && !approvalReady && <p role="status" style={{ color: "var(--color-amber)", fontSize: "0.78rem", margin: "0.55rem 0 0" }}>
      {data.review?.technicalQualityPass !== true ? "Native WAV technical quality gate failed." : "Human review does not meet this program's sealed quality thresholds."}
    </p>}
    {data.checkpoint.decision === "rejected" && data.checkpoint.savedReview && <details style={{ marginTop: "0.8rem" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.88rem" }}>Saved owner feedback</summary>
      <p style={{ color: "var(--color-muted)", fontSize: "0.78rem" }}>Emotional depth {data.checkpoint.savedReview.audition.emotionalDepthScore.toFixed(2)} · arrangement depth {data.checkpoint.savedReview.audition.arrangementDepthScore.toFixed(2)} · hollow or generic {data.checkpoint.savedReview.audition.hollowOrGeneric ? "yes" : "no"}</p>
      <p style={{ fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{data.checkpoint.savedReview.audition.notes}</p>
      <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.78rem" }}>{data.checkpoint.savedReview.sectionReviews.map((item) => <li key={item.sectionId}>{item.sectionId}: {item.score.toFixed(2)} · {item.evidence}</li>)}</ul>
    </details>}
    {data.checkpoint.decision === "awaiting" && <>
      <details style={{ marginTop: "0.8rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.88rem" }}>Native WAV QC (measured from this take)</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginTop: "0.75rem" }}>
          {measurementKeys.map((key) => <div key={key} style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}><span>{measurementLabels[key]}</span><strong style={{ display: "block", color: "var(--color-foreground)", marginTop: "0.18rem", fontSize: "0.88rem" }}>{data.review?.nativeQuality?.measurements[key] ?? "measuring…"}</strong></div>)}
        </div>
        {data.review?.nativeQuality && <p style={{ color: "var(--color-muted)", fontSize: "0.76rem", margin: "0.7rem 0 0" }}>High-band continuity: {data.review.nativeQuality.openingHighBand.meanDbfs} dBFS at {data.review.nativeQuality.openingHighBand.startSec.toFixed(2)}s → {data.review.nativeQuality.postOpeningHighBand.meanDbfs} dBFS at {data.review.nativeQuality.postOpeningHighBand.startSec.toFixed(2)}s. A large drop blocks approval.</p>}
        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.8rem" }}>
          {(data.review?.sections ?? []).map((section) => <div key={section.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: "0.5rem", alignItems: "end", paddingBottom: "0.55rem", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <strong style={{ fontSize: "0.8rem" }}>{section.label}</strong>
              <p style={{ color: "var(--color-muted)", fontSize: "0.76rem", lineHeight: 1.45, margin: "0.18rem 0 0" }}>{section.instruction}</p>
            </div>
            <label style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>score<input aria-label={`${section.id} score`} type="number" min="0" max="1" step="0.01" value={sectionReviews[section.id]?.score ?? ""} onChange={(event) => setSectionReviews((current) => ({ ...current, [section.id]: { ...current[section.id], score: event.target.value } }))} style={inputStyle} /></label>
            <label style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>evidence<input aria-label={`${section.id} evidence`} value={sectionReviews[section.id]?.evidence ?? ""} onChange={(event) => setSectionReviews((current) => ({ ...current, [section.id]: { ...current[section.id], evidence: event.target.value } }))} style={inputStyle} /></label>
          </div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(140px, 1fr))", gap: "0.5rem", marginTop: "0.8rem" }}>
          <label style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}>emotional depth<input aria-label="emotional depth" type="number" min="0" max="1" step="0.01" value={emotionalDepthScore} onChange={(event) => setEmotionalDepthScore(event.target.value)} style={inputStyle} /></label>
          <label style={{ fontSize: "0.76rem", color: "var(--color-muted)" }}>arrangement depth<input aria-label="arrangement depth" type="number" min="0" max="1" step="0.01" value={arrangementDepthScore} onChange={(event) => setArrangementDepthScore(event.target.value)} style={inputStyle} /></label>
        </div>
        <label style={{ display: "block", fontSize: "0.76rem", color: "var(--color-muted)", marginTop: "0.5rem" }}>review notes<textarea aria-label="review notes" value={notes} onChange={(event) => setNotes(event.target.value)} style={{ ...inputStyle, minHeight: "3.25rem", resize: "vertical" }} /></label>
        <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.8rem", marginTop: "0.5rem" }}><input type="checkbox" checked={hollowOrGeneric} onChange={(event) => setHollowOrGeneric(event.target.checked)} /> sounds hollow or generic (fails approval)</label>
      </details>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem" }}>
        <button type="button" disabled={approving || !approvalReady} onClick={() => void approve()}>{approving ? "Recording QC…" : "Approve QC"}</button>
        <button type="button" disabled={rejecting || !completeReview} onClick={() => void reject()}>{rejecting ? "Rejecting…" : "Reject"}</button>
      </div>
    </>}
  </section>;
}
