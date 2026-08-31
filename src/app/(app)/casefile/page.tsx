"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  casefileEvidenceLocks,
  type CasefileEvidenceEpisode,
} from "@/lib/editorialDeskEvidence";
import styles from "../editorial-desk.module.css";

type Episode = CasefileEvidenceEpisode & {
  _id: string;
  caseId: string;
  status: string;
  updatedAt: number;
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

function requiredClaims(input: Record<string, unknown>): unknown[] {
  if (!Array.isArray(input.claims)) throw new Error("Narrative evidence annotations need a claims array");
  return input.claims;
}

function requiredRelations(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Narrative evidence relations must be an array when supplied");
  return value;
}

const sourceProofAttachmentFields = [
  "shotId",
  "sourceId",
  "assetId",
  "rightsEvidenceLocator",
  "assetUrl",
  "assetSha256",
  "approvalReceiptId",
] as const;

function parseSourceProofAttachments(raw: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Source-proof media attachments must be valid JSON array");
  }
  if (!Array.isArray(parsed)) throw new Error("Source-proof media attachments must be a JSON array");
  return parsed.map((attachment, index) => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      throw new Error(`Source-proof attachment ${index + 1} must be an object`);
    }
    const input = attachment as Record<string, unknown>;
    const unexpectedFields = Object.keys(input).filter(
      (key) => !sourceProofAttachmentFields.includes(key as (typeof sourceProofAttachmentFields)[number]),
    );
    if (unexpectedFields.length) {
      throw new Error(`Source-proof attachment ${index + 1} cannot include ${unexpectedFields.join(", ")}; packet/provenance fields are server-derived`);
    }
    const missingFields = sourceProofAttachmentFields.filter((key) => input[key] === undefined);
    if (missingFields.length) throw new Error(`Source-proof attachment ${index + 1} is missing ${missingFields.join(", ")}`);
    return input;
  });
}

function humanizeStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function updatedLabel(updatedAt: number): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.valueOf())
    ? "Updated time unavailable"
    : `Updated ${date.toLocaleString()}`;
}

/** Private editor desk for the immutable Casefile → cinematic render handoff. */
export default function CasefilePage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourcePacket, setSourcePacket] = useState("");
  const [planning, setPlanning] = useState("");
  const [evidenceMap, setEvidenceMap] = useState("");
  const [referenceMechanics, setReferenceMechanics] = useState("");
  const [referenceMechanicsReview, setReferenceMechanicsReview] = useState("");
  const [sourceBoundStorySpine, setSourceBoundStorySpine] = useState("");
  const [narrativeEvidenceLedger, setNarrativeEvidenceLedger] = useState("");
  const [narrativeEvidenceReview, setNarrativeEvidenceReview] = useState("");
  const [direction, setDirection] = useState("");
  const [sourceProofMedia, setSourceProofMedia] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/casefile-episodes", { cache: "no-store" });
    const payload = await response.json() as { ok?: boolean; episodes?: Episode[]; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Could not load Casefile episodes");
    setEpisodes(payload.episodes ?? []);
  }, []);

  // One-shot mount fetch: refresh has stable [] deps so this effect runs once; setEpisodes/setMessage
  // fire only after the fetch settles (success or error), not synchronously in the effect body, and
  // there is no render-triggered loop. This is the standard "fetch data on mount" effect pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#fetching-data); restructuring it to satisfy
  // the compiler's static setState-in-effect heuristic would require moving the fetch into a separate
  // custom hook/module or an experimental useEffectEvent, which is out of scope for a mechanical lint cleanup.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const evidenceLocks = casefileEvidenceLocks(selected);
  const recordedLockCount = evidenceLocks.filter((lock) => lock.recorded).length;
  const sourceProofMediaAttached = evidenceLocks.some(
    (lock) => lock.label === "Source-proof media" && lock.recorded,
  );
  const selectedStageLabel = selected
    ? stages.find(([status]) => status === selected.status)?.[1] ?? humanizeStatus(selected.status)
    : "New source packet";

  return (
    <main className={styles.desk}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Private editorial workflow</p>
        <h1>Casefile cinematic desk</h1>
        <p>
          Build an evidence-led cinematic sequence in two phases: lock real sources and causal shot coverage first, then approve the faceless-mannequin multi-shot treatment. This desk cannot render, spend, or publish.
        </p>
      </header>

      <section className={styles.summary} aria-label="Casefile workflow status">
        <div className={styles.summaryCopy}>
          <small>Selected handoff</small>
          <strong>{selected?.caseId ?? "Start with a source packet"}</strong>
          <span>{selected ? `Currently at ${selectedStageLabel}.` : "No case is selected yet; only a reviewed source packet can open one."}</span>
        </div>
        <div className={styles.stageRail} aria-label="Immutable handoff path">
          {stages.map(([status, label], index) => (
            <div
              key={status}
              className={`${styles.stage} ${index <= activeStage ? styles.stageReached : ""} ${index === activeStage ? styles.stageCurrent : ""}`}
            >
              <strong>{label}</strong>
              <span>{index < activeStage ? "Recorded" : index === activeStage ? "Current gate" : "Not reached"}</span>
            </div>
          ))}
        </div>
      </section>

      {selected && <section className={styles.ledger} aria-label="Recorded Casefile evidence bindings">
        <div className={styles.ledgerHeader}>
          <div>
            <h2>Recorded bindings for this case</h2>
            <p>These are the exact evidence and review records persisted on {selected.caseId}. A missing record is shown as missing, not treated as an automatic failure.</p>
          </div>
          <span className={styles.ledgerCount}>{recordedLockCount} recorded</span>
        </div>
        <div className={styles.lockGrid}>
          {evidenceLocks.map((lock) => (
            <div key={lock.label} className={`${styles.lock} ${lock.recorded ? styles.lockRecorded : styles.lockMissing}`}>
              <span className={styles.lockTitle}>{lock.label}</span>
              <span className={styles.lockDetail}>{lock.detail}</span>
              {lock.value && <code className={styles.lockValue} title={lock.value}>{lock.value}</code>}
            </div>
          ))}
        </div>
      </section>}

      <div className={styles.workspace}>
        <aside style={{ ...card }} className={styles.library}>
          <div className={styles.libraryHeader}>
            <strong>Casefiles</strong>
            <span>{episodes.length} recorded</span>
          </div>
          {episodes.length === 0 ? <span style={{ color: "#8d9aad", fontSize: 13 }}>No source-admitted Casefile episodes yet.</span> : <div className={styles.recordList}>{episodes.map((episode) => (
              <button
                key={episode._id}
                type="button"
                onClick={() => setSelectedId(episode._id)}
                className={`${styles.recordButton} ${selected?._id === episode._id ? styles.recordButtonSelected : ""}`}
              >
                <strong className={styles.recordTitle}>{episode.caseId}</strong>
                <span className={styles.recordDetail}>{humanizeStatus(episode.status)} · {updatedLabel(episode.updatedAt)}</span>
                {episode.sourcePacketFingerprint && <code className={styles.recordFingerprint}>{episode.sourcePacketFingerprint}</code>}
              </button>
          ))}</div>}
        </aside>

        <section style={{ ...card }} className={styles.operatorPane}>
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
            <section style={{ border: "1px solid #294468", borderRadius: 11, padding: 14, display: "grid", gap: 10, background: "rgba(17,37,62,.32)" }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Optional: bind the reviewed narration and evidence ledger</h2>
              <p style={{ margin: 0, color: "#b9c8da", fontSize: 13, lineHeight: 1.5 }}>
                Use this stricter factual route only when the editor has reviewed the full timed Story Spine and a narrative-evidence ledger. The system binds every narration shot to the approved Casefile claims and sources, then carries the ledger through cinematic review and final QA. This desk cannot render, spend, or publish.
              </p>
              {selected.workflow?.sourceBoundStorySpine ? <>
                <strong style={{ color: "#9be2b3", fontSize: 13 }}>Source-bound Story Spine attached</strong>
                {selected.workflow.sourceBoundStorySpine.storySpineFingerprint && <code style={{ color: "#9fc0ff", overflowWrap: "anywhere" }}>{selected.workflow.sourceBoundStorySpine.storySpineFingerprint}</code>}
              </> : <>
                <textarea aria-label="Source-bound Story Spine JSON" style={{ ...textarea, minHeight: 260 }} value={sourceBoundStorySpine} onChange={(event) => setSourceBoundStorySpine(event.target.value)} placeholder='{"version":"story-spine/v1", "timedScript": { ... }, "narrativeBeats": [ ... ], "shotList": [ ... ], ...}' />
                <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("attach_source_bound_story_spine", { episodeId: selected._id, storySpine: parseObject(sourceBoundStorySpine, "Source-bound Story Spine") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze source-bound Story Spine</button>
              </>}
              {selected.workflow?.narrativeEvidenceLedger ? <>
                <strong style={{ color: "#9be2b3", fontSize: 13 }}>Reviewed Narrative Evidence Ledger attached</strong>
                {selected.workflow.narrativeEvidenceLedger.contentFingerprint && <code style={{ color: "#9fc0ff", overflowWrap: "anywhere" }}>{selected.workflow.narrativeEvidenceLedger.contentFingerprint}</code>}
                <small style={{ color: "#9eadc1" }}>It will be derived into the signed cinematic direction; replacing it requires a fresh Casefile revision.</small>
              </> : <>
                <textarea aria-label="Narrative evidence annotations JSON" style={{ ...textarea, minHeight: 260 }} value={narrativeEvidenceLedger} onChange={(event) => setNarrativeEvidenceLedger(event.target.value)} placeholder='{"claims":[{"id":"…", "approvedText":"…", "assertionState":"…", "confidence":"…", "uncertainty":{…}, "causalRole":"…", "supports":[{"sourceIds":[…], "upstreamClaimIds":[…]}], "allowedVisualTreatments":[…]}], "relations":[]}' />
                <textarea aria-label="Narrative evidence editorial review JSON" style={{ ...textarea, minHeight: 110 }} value={narrativeEvidenceReview} onChange={(event) => setNarrativeEvidenceReview(event.target.value)} placeholder='{"reviewerId":"reviewer-…", "reviewId":"narrative-ledger-review-…", "reviewedAt":"2026-08-20T12:00:00.000Z"}' />
                <button type="button" disabled={actionDisabled || !selected.workflow?.sourceBoundStorySpine} onClick={() => { try { const input = parseObject(narrativeEvidenceLedger, "Narrative evidence annotations"); void submit("attach_narrative_evidence_ledger", { episodeId: selected._id, claims: requiredClaims(input), ...(input.relations === undefined ? {} : { relations: requiredRelations(input.relations) }), review: parseObject(narrativeEvidenceReview, "Narrative evidence review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze Narrative Evidence Ledger</button>
                {!selected.workflow?.sourceBoundStorySpine && <small style={{ color: "#f4c785" }}>Freeze the matching source-bound Story Spine first. This prevents a ledger from being attached to a different narration timeline.</small>}
              </>}
            </section>
            <section style={{ border: "1px solid #294468", borderRadius: 11, padding: 14, display: "grid", gap: 10, background: "rgba(17,37,62,.32)" }}>
              <h2 style={{ margin: 0, fontSize: 17 }}>Optional: attach reviewed reference mechanics</h2>
              <p style={{ margin: 0, color: "#b9c8da", fontSize: 13, lineHeight: 1.5 }}>
                Supply original craft rules for the opening, rhythm, narration, cuts, audio, recurring identity, and exclusions. This intake accepts text only—never reference video, frames, audio, scripts, or an automatic similarity comparison. The server derives the current attributed documentary contract and binds the packet to this exact Story Spine before it is frozen.
              </p>
              {selected.workflow?.referenceMechanicsPacket ? <>
                <strong style={{ color: "#9be2b3", fontSize: 13 }}>Reviewed mechanics packet attached</strong>
                {selected.workflow.referenceMechanicsPacket.contentFingerprint && <code style={{ color: "#9fc0ff", overflowWrap: "anywhere" }}>{selected.workflow.referenceMechanicsPacket.contentFingerprint}</code>}
                <small style={{ color: "#9eadc1" }}>It will be signed into the cinematic sequence; replacing it requires a fresh immutable episode revision.</small>
              </> : <>
                <textarea aria-label="Reference mechanics annotations JSON" style={{ ...textarea, minHeight: 260 }} value={referenceMechanics} onChange={(event) => setReferenceMechanics(event.target.value)} placeholder={'{\n  "openingPromisePayoff": { "guidance": "State one source-bound question, then earn its answer later.", "sourceIds": ["fern"] },\n  "beatVisualRhythm": { "guidance": "Change the visual only when the evidence relationship changes.", "sourceIds": ["fern"] },\n  "narrationPaceClarity": { "guidance": "Keep the causal claim legible before underscoring it.", "sourceIds": ["fern"] },\n  "cutSceneFunction": { "guidance": "Each cut reveals a fact, relationship, or consequence.", "sourceIds": ["fern"] },\n  "audioRelationship": { "guidance": "Keep narration intelligible over restrained ambience.", "sourceIds": ["fern"] },\n  "recurringIdentity": { "guidance": "Use this channel’s own faceless cast and evidence treatment.", "sourceIds": ["fern"] },\n  "exclusions": { "guidance": "No copied cases, visual identity, footage, scripts, voices, or unsupported reconstructions.", "sourceIds": ["fern"] }\n}'} />
                <textarea aria-label="Reference mechanics editorial review JSON" style={{ ...textarea, minHeight: 110 }} value={referenceMechanicsReview} onChange={(event) => setReferenceMechanicsReview(event.target.value)} placeholder='{"id":"reference-mechanics-review-...","reviewerId":"reviewer-...","reviewedAt":"2026-08-20T12:00:00.000Z"}' />
                <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("attach_reference_mechanics", { episodeId: selected._id, mechanics: parseObject(referenceMechanics, "Reference mechanics"), review: parseObject(referenceMechanicsReview, "Reference mechanics review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze reviewed mechanics packet</button>
              </>}
            </section>
            <h2 style={{ margin: 0, fontSize: 19 }}>4. Draft cinematic coverage</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>Paste the compact direction card: causal question, visual world, and original faceless mannequin wardrobe/silhouette locks. The system writes the actual multi-shot, tension, cut, and continuity draft.</p>
            <textarea aria-label="Cinematic direction JSON" style={textarea} value={direction} onChange={(event) => setDirection(event.target.value)} placeholder='{"version":"cinematic-case-direction/v1", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("draft_cinematic_sequence", { episodeId: selected._id, direction: parseObject(direction, "Cinematic direction") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Create review draft</button>
          </>}

          {selected?.status === "awaiting_cinematic_review" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>5. Finalize cinematic review</h2>
            <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13 }}>The editor review must bind the current source packet, evidence map, and draft sequence fingerprint. Any wardrobe, timing, claim, or cut change requires a new review.</p>
            {selected.workflow?.cinematicDraft?.sequenceContentFingerprint && <code style={{ color: "#9fc0ff", overflowWrap: "anywhere" }}>{selected.workflow.cinematicDraft.sequenceContentFingerprint}</code>}
            <section style={{ border: "1px solid #294468", borderRadius: 11, padding: 14, display: "grid", gap: 10, background: "rgba(17,37,62,.32)" }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Bind approved source-proof media</h3>
              <p style={{ margin: 0, color: "#b9c8da", fontSize: 13, lineHeight: 1.5 }}>
                For every source-proof shot, attach the exact approved asset, rights locator, SHA-256, and approval receipt. The server derives the source packet and provenance binding; this desk cannot substitute a different source or approve generated evidence.
              </p>
              {sourceProofMediaAttached ? <>
                <strong style={{ color: "#9be2b3", fontSize: 13 }}>Approved source-proof media are frozen into this review draft</strong>
                <small style={{ color: "#9eadc1" }}>Replacing an asset requires a fresh immutable Casefile revision and a new cinematic review.</small>
              </> : <>
                <textarea aria-label="Source-proof media attachments JSON" style={{ ...textarea, minHeight: 220 }} value={sourceProofMedia} onChange={(event) => setSourceProofMedia(event.target.value)} placeholder={'[{\n  "shotId": "cinematic-shot-…",\n  "sourceId": "source-…",\n  "assetId": "asset-…",\n  "rightsEvidenceLocator": "https://…",\n  "assetUrl": "https://…",\n  "assetSha256": "…",\n  "approvalReceiptId": "source-proof-receipt-…"\n}]'} />
                <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("attach_source_proof_media", { episodeId: selected._id, attachments: parseSourceProofAttachments(sourceProofMedia) }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze approved source-proof media</button>
              </>}
            </section>
            <textarea aria-label="Cinematic editorial review JSON" style={textarea} value={review} onChange={(event) => setReview(event.target.value)} placeholder='{"id":"cinematic-sequence-review-...", "decision":"approved", ...}' />
            <button type="button" disabled={actionDisabled} onClick={() => { try { void submit("finalize_cinematic_sequence", { episodeId: selected._id, editorialReview: parseObject(review, "Cinematic review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Finalize render package</button>
          </>}

          {selected?.status === "render_admitted" && <>
            <h2 style={{ margin: 0, fontSize: 19 }}>Render package admitted</h2>
            <p style={{ margin: 0, color: "#b6c8e4", lineHeight: 1.55 }}>This episode now has a fingerprint-bound LTX-ready multi-shot plan with {selected.workflow?.cinematicAdmission?.generatedSceneCount ?? 0} generated scenes. It remains private review only. Rendering still needs a separately approved, budgeted Novita action and final independent footage review.</p>
          </>}
        </section>
      </div>
      {message && <p role="status" className={styles.statusMessage} style={{ ...card, color: message.startsWith("Saved") ? "#9be2b3" : "#ffb8b8" }}>{message}</p>}
    </main>
  );
}
