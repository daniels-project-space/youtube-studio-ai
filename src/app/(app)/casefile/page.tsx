"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Episode = {
  _id: string;
  caseId: string;
  status: string;
  updatedAt: number;
  workflow?: {
    cinematicDraft?: { sequenceContentFingerprint?: string };
    cinematicAdmission?: { generatedSceneCount?: number; release?: string };
  };
};

const stages = [
  ["source_admitted", "1. Source packet"],
  ["awaiting_evidence_review", "2. Planning handoff"],
  ["awaiting_cinematic_direction", "3. Evidence map"],
  ["awaiting_cinematic_review", "4. Cinematic review"],
  ["render_admitted", "5. Render package"],
] as const;

const textarea: React.CSSProperties = {
  width: "100%", minHeight: 180, resize: "vertical", borderRadius: 10,
  border: "1px solid var(--border, #273142)", background: "#0c111b", color: "#e8edf5",
  padding: 12, font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
};
const card: React.CSSProperties = {
  border: "1px solid var(--border, #273142)", borderRadius: 14, padding: 18,
  background: "linear-gradient(140deg, rgba(19,26,38,.94), rgba(10,15,24,.94))",
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be valid JSON object`);
  }
}

function parsePlanning(raw: string): { sceneManifest: Record<string, unknown>; shotList: unknown[] } {
  const parsed = parseObject(raw, "Planning package");
  if (!parsed.sceneManifest || typeof parsed.sceneManifest !== "object" || Array.isArray(parsed.sceneManifest)) {
    throw new Error("Planning package needs sceneManifest");
  }
  if (!Array.isArray(parsed.shotList)) throw new Error("Planning package needs shotList array");
  return { sceneManifest: parsed.sceneManifest as Record<string, unknown>, shotList: parsed.shotList };
}

/** Private editor desk for the immutable Casefile → cinematic render handoff. */
export default function CasefilePage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourcePacket, setSourcePacket] = useState("");
  const [planning, setPlanning] = useState("");
  const [evidenceMap, setEvidenceMap] = useState("");
  const [direction, setDirection] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/casefile-episodes", { cache: "no-store" });
    const payload = await response.json() as { ok?: boolean; episodes?: Episode[]; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Could not load Casefile episodes");
    setEpisodes(payload.episodes ?? []);
  }, []);

  useEffect(() => { void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))); }, [refresh]);

  const selected = useMemo(
    () => episodes.find((episode) => episode._id === selectedId) ?? episodes[0] ?? null,
    [episodes, selectedId],
  );

  const submit = useCallback(async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/casefile-episodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json() as { ok?: boolean; episode?: Episode; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Casefile handoff was rejected");
      await refresh();
      if (result.episode?._id) setSelectedId(result.episode._id);
      setMessage("Saved. The next transition remains locked until its matching human review material is supplied.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const activeStage = stages.findIndex(([status]) => status === selected?.status);
  const actionDisabled = busy;

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 22px 80px", display: "grid", gap: 18 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, color: "#84a8ff", fontSize: 12, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase" }}>Private editorial workflow</p>
        <h1 style={{ margin: 0, fontSize: 30 }}>Casefile cinematic desk</h1>
        <p style={{ margin: 0, maxWidth: 850, color: "#aeb9cb", lineHeight: 1.55 }}>
          Build an evidence-led Fern-style sequence in two phases: lock real sources and causal shot coverage first, then approve the faceless-mannequin multi-shot treatment. This desk cannot render, spend, or publish.
        </p>
      </header>

      <section style={{ ...card, display: "grid", gap: 12 }} aria-label="Casefile workflow status">
        <strong>Immutable handoff path</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stages.map(([status, label], index) => (
            <span key={status} style={{ borderRadius: 999, padding: "6px 10px", fontSize: 12, background: index <= activeStage ? "#28487e" : "#182131", color: index <= activeStage ? "#e5efff" : "#8290a5" }}>{label}</span>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(230px, .36fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <aside style={{ ...card, display: "grid", gap: 10 }}>
          <strong>Episodes</strong>
          {episodes.length === 0 ? <span style={{ color: "#8d9aad", fontSize: 13 }}>No source-admitted Casefile episodes yet.</span> : episodes.map((episode) => (
            <button key={episode._id} type="button" onClick={() => setSelectedId(episode._id)} style={{ textAlign: "left", border: "1px solid #293448", borderRadius: 9, padding: 10, cursor: "pointer", color: "#e7edf8", background: selected?._id === episode._id ? "#182d4d" : "#101722" }}>
              <strong style={{ display: "block", fontSize: 13 }}>{episode.caseId}</strong>
              <small style={{ color: "#9eadc1" }}>{episode.status.replaceAll("_", " ")}</small>
            </button>
          ))}
        </aside>

        <section style={{ ...card, display: "grid", gap: 14 }}>
          {!selected && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>1. Admit a source packet</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>Paste the editor-approved Casefile Source Packet. The server checks every claim’s primary source, visual rights usage, and the review fingerprint before it stores anything.</p>
            <textarea aria-label="Casefile source packet JSON" style={textarea} value={sourcePacket} onChange={(event) => setSourcePacket(event.target.value)} placeholder='{"version":"casefile-source-packet/v1", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("admit_source", { sourcePacket: parseObject(sourcePacket, "Source packet") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>
              Admit source packet
            </button>
          </>}

          {selected?.status === "source_admitted" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>2. Attach locked planning artifacts</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>Paste the private Story Spine output as <code>{'{ "sceneManifest": {...}, "shotList": [...] }'}</code>. This freezes the exact targets the evidence editor will approve.</p>
            <textarea aria-label="Casefile planning package JSON" style={textarea} value={planning} onChange={(event) => setPlanning(event.target.value)} placeholder='{ "sceneManifest": { ... }, "shotList": [ ... ] }' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("attach_planning", { episodeId: selected._id, ...parsePlanning(planning) }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Lock planning artifacts</button>
          </>}

          {selected?.status === "awaiting_evidence_review" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>3. Admit claim-to-shot evidence map</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>Paste the evidence editor’s signed map. Each factual claim must bind to the exact Scene Manifest/ShotPlan ids and retain a no-gore, no-unsupported-recreation policy.</p>
            <textarea aria-label="Casefile evidence map JSON" style={textarea} value={evidenceMap} onChange={(event) => setEvidenceMap(event.target.value)} placeholder='{"version":"casefile-evidence-shot-map/v1", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("admit_evidence_map", { episodeId: selected._id, evidenceShotMapInput: parseObject(evidenceMap, "Evidence map") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Admit evidence map</button>
          </>}

          {selected?.status === "awaiting_cinematic_direction" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>4. Draft cinematic coverage</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>Paste the compact direction card: causal question, visual world, and original faceless mannequin wardrobe/silhouette locks. The system writes the actual multi-shot, tension, cut, and continuity draft.</p>
            <textarea aria-label="Cinematic direction JSON" style={textarea} value={direction} onChange={(event) => setDirection(event.target.value)} placeholder='{"version":"cinematic-case-direction/v1", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("draft_cinematic_sequence", { episodeId: selected._id, direction: parseObject(direction, "Cinematic direction") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Create review draft</button>
          </>}

          {selected?.status === "awaiting_cinematic_review" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>5. Finalize cinematic review</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>The editor review must bind the current source packet, evidence map, and draft sequence fingerprint. Any wardrobe, timing, claim, or cut change requires a new review.</p>
            {selected.workflow?.cinematicDraft?.sequenceContentFingerprint && <code style={{ color: "#9fc0ff", overflowWrap: "anywhere" }}>{selected.workflow.cinematicDraft.sequenceContentFingerprint}</code>}
            <textarea aria-label="Cinematic editorial review JSON" style={textarea} value={review} onChange={(event) => setReview(event.target.value)} placeholder='{"id":"cinematic-sequence-review-...", "decision":"approved", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("finalize_cinematic_sequence", { episodeId: selected._id, editorialReview: parseObject(review, "Cinematic review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Finalize render package</button>
          </>}

          {selected?.status === "render_admitted" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>Render package admitted</h2>
            <p style={{ margin: 0, color: "#b6c8e4", lineHeight: 1.55 }}>This episode now has a fingerprint-bound LTX-ready multi-shot plan with {selected.workflow?.cinematicAdmission?.generatedSceneCount ?? 0} generated scenes. It remains private review only. Rendering still needs a separately approved, budgeted Novita action and final independent footage review.</p>
          </>}
        </section>
      </div>
      {message && <p role="status" style={{ ...card, margin: 0, color: message.startsWith("Saved") ? "#9be2b3" : "#ffb8b8" }}>{message}</p>}
    </main>
  );
}
