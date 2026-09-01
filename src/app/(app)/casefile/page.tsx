"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationsAccess } from "@/components/OperationsAccess";
import {
  casefileEvidenceLocks,
  type CasefileEvidenceEpisode,
} from "@/lib/editorialDeskEvidence";
import styles from "./casefile.module.css";

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

function CasefileHero({
  access,
  selected,
  episodeCount,
  activeStage,
  recordedLockCount,
  stageLabel,
}: {
  access: ReturnType<typeof useOperationsAccess>;
  selected: Episode | null;
  episodeCount: number;
  activeStage: number;
  recordedLockCount: number;
  stageLabel: string;
}) {
  return (
    <section className={styles.hero} aria-busy={access === "checking" || undefined}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Evidence</p>
        <h1>Casefiles</h1>
        <div className={styles.heroBoundary}>
          <span aria-hidden="true">⌁</span>
          <div>
            <small>Safety</small>
            <strong>No render · no spend · no publish</strong>
          </div>
        </div>
      </div>

      <div className={styles.chainPanel}>
        <div className={styles.chainHeader}>
          <span>Evidence route</span>
          <small>{selected?.caseId ?? "No case selected"}</small>
        </div>
        <ol className={styles.chain}>
          {stages.map(([status, label], index) => {
            const state = index < activeStage
              ? "recorded"
              : index === activeStage
                ? "current"
                : "waiting";
            return (
              <li key={status} data-state={state}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{label.replace(/^\d+\.\s*/, "")}</strong>
                  <small>{state === "recorded" ? "Fingerprint held" : state === "current" ? "Open gate" : "Sealed"}</small>
                </div>
                <i aria-hidden="true" />
              </li>
            );
          })}
        </ol>
        <div className={styles.caseSeal} aria-hidden="true">
          <span>CF</span>
          <i />
        </div>
      </div>

      <div className={styles.metricRail}>
        <CaseMetric index="01" label="Casefiles" value={String(episodeCount).padStart(2, "0")} detail="immutable records" />
        <CaseMetric index="02" label="Current gate" value={stageLabel.replace(/^\d+\.\s*/, "")} detail={selected ? humanizeStatus(selected.status) : "source intake"} />
        <CaseMetric index="03" label="Bindings" value={String(recordedLockCount).padStart(2, "0")} detail="stored receipts" />
        <CaseMetric index="04" label="Authority" value={access === "owner" ? "Open" : access === "checking" ? "Checking" : "Locked"} detail="signed owner session" />
      </div>
    </section>
  );
}

function CaseMetric({ index, label, value, detail }: { index: string; label: string; value: string; detail: string }) {
  return (
    <div className={styles.metric}>
      <span>{index} / {label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function LockedCasefileRoom({ access }: { access: Exclude<ReturnType<typeof useOperationsAccess>, "owner"> }) {
  return (
    <section className={styles.lockedRoom} aria-live={access === "checking" ? "polite" : undefined}>
      <div className={styles.lockedSeal} aria-hidden="true"><span>PRIVATE</span><i /></div>
      <div className={styles.lockedCopy}>
        <p className={styles.eyebrow}>{access === "checking" ? "Resolving signed session" : "Chain of custody protected"}</p>
        <h2>{access === "checking" ? "Checking case-room authority…" : "The case room is sealed."}</h2>
        <p>
          {access === "checking"
            ? "The studio is checking the current browser session before requesting any private episode records."
            : "Open owner operations from the top bar to inspect immutable evidence packets. No private casefile request was sent."}
        </p>
      </div>
      <div className={styles.lockedProtocol}>
        <div><span>01</span><strong>Sources stay private</strong><p>Case packets and rights locators are not loaded in viewer mode.</p></div>
        <div><span>02</span><strong>Reviews stay human</strong><p>No evidence or cinematic approval is inferred from access state.</p></div>
        <div><span>03</span><strong>Rendering stays elsewhere</strong><p>This room cannot spend, dispatch a GPU, or publish.</p></div>
      </div>
    </section>
  );
}

function OperatorHeading({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <div className={styles.operatorHeading}>
      <span>{index}</span>
      <div>
        <p>Current evidence gate</p>
        <h2>{title}</h2>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function ModuleHeading({ tag, title }: { tag: string; title: string }) {
  return (
    <div className={styles.moduleHeading}>
      <span>{tag}</span>
      <h3>{title}</h3>
    </div>
  );
}

/** Private editor desk for the immutable Casefile → cinematic render handoff. */
export default function CasefilePage() {
  const operationsAccess = useOperationsAccess();
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

  useEffect(() => {
    if (operationsAccess !== "owner") return;
    const timer = window.setTimeout(() => {
      void refresh().catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [operationsAccess, refresh]);

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
    <div className={styles.desk}>
      <CasefileHero
        access={operationsAccess}
        selected={selected}
        episodeCount={episodes.length}
        activeStage={activeStage}
        recordedLockCount={recordedLockCount}
        stageLabel={selectedStageLabel}
      />

      {operationsAccess !== "owner" ? (
        <LockedCasefileRoom access={operationsAccess} />
      ) : (<>

      {selected && <section className={styles.ledger} aria-label="Recorded Casefile evidence bindings">
        <div className={styles.ledgerHeader}>
          <div>
            <h2>Recorded bindings for this case</h2>
            <p>Saved evidence for {selected.caseId}.</p>
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
        <aside className={`${styles.surface} ${styles.library}`}>
          <div className={styles.libraryHeader}>
            <strong>Casefiles</strong>
            <span>{episodes.length} recorded</span>
          </div>
          {episodes.length === 0 ? <span className={styles.emptyLibrary}>No source-admitted Casefile episodes yet.</span> : <div className={styles.recordList}>{episodes.map((episode) => (
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

        <section className={`${styles.surface} ${styles.operatorPane}`}>
          {!selected && <>
            <OperatorHeading index="01" title="Add sources" detail="Paste the reviewed source packet." />
            <textarea aria-label="Casefile source packet JSON" className={styles.textarea} value={sourcePacket} onChange={(event) => setSourcePacket(event.target.value)} placeholder='{"version":"casefile-source-packet/v1", ...}' />
            <button type="button" className={styles.primaryAction} disabled={actionDisabled} onClick={() => { try { void submit("admit_source", { sourcePacket: parseObject(sourcePacket, "Source packet") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>
              Admit source packet
            </button>
          </>}

          {selected?.status === "source_admitted" && <>
            <OperatorHeading index="02" title="Lock the plan" detail="Attach the reviewed story spine." />
            <textarea aria-label="Casefile planning package JSON" className={styles.textarea} value={planning} onChange={(event) => setPlanning(event.target.value)} placeholder='{ "sceneManifest": { ... }, "shotList": [ ... ] }' />
            <button type="button" className={styles.primaryAction} disabled={actionDisabled} onClick={() => { try { void submit("attach_planning", { episodeId: selected._id, ...parsePlanning(planning) }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Lock planning artifacts</button>
          </>}

          {selected?.status === "awaiting_evidence_review" && <>
            <OperatorHeading index="03" title="Map claims to shots" detail="Bind each claim to its planned scene." />
            <textarea aria-label="Casefile evidence map JSON" className={styles.textarea} value={evidenceMap} onChange={(event) => setEvidenceMap(event.target.value)} placeholder='{"version":"casefile-evidence-shot-map/v1", ...}' />
            <button type="button" className={styles.primaryAction} disabled={actionDisabled} onClick={() => { try { void submit("admit_evidence_map", { episodeId: selected._id, evidenceShotMapInput: parseObject(evidenceMap, "Evidence map") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Admit evidence map</button>
          </>}

          {selected?.status === "awaiting_cinematic_direction" && <>
            <section className={styles.optionalModule}>
              <ModuleHeading tag="Optional binding" title="Reviewed narration + evidence ledger" />
              <p className={styles.moduleCopy}>
                Use this stricter factual route only when the editor has reviewed the full timed Story Spine and a narrative-evidence ledger. The system binds every narration shot to the approved Casefile claims and sources, then carries the ledger through cinematic review and final QA. This desk cannot render, spend, or publish.
              </p>
              {selected.workflow?.sourceBoundStorySpine ? <>
                <strong className={styles.recordedText}>Source-bound Story Spine attached</strong>
                {selected.workflow.sourceBoundStorySpine.storySpineFingerprint && <code className={styles.fingerprint}>{selected.workflow.sourceBoundStorySpine.storySpineFingerprint}</code>}
              </> : <>
                <textarea aria-label="Source-bound Story Spine JSON" className={`${styles.textarea} ${styles.textareaTall}`} value={sourceBoundStorySpine} onChange={(event) => setSourceBoundStorySpine(event.target.value)} placeholder='{"version":"story-spine/v1", "timedScript": { ... }, "narrativeBeats": [ ... ], "shotList": [ ... ], ...}' />
                <button type="button" className={styles.secondaryAction} disabled={actionDisabled} onClick={() => { try { void submit("attach_source_bound_story_spine", { episodeId: selected._id, storySpine: parseObject(sourceBoundStorySpine, "Source-bound Story Spine") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze source-bound Story Spine</button>
              </>}
              {selected.workflow?.narrativeEvidenceLedger ? <>
                <strong className={styles.recordedText}>Reviewed Narrative Evidence Ledger attached</strong>
                {selected.workflow.narrativeEvidenceLedger.contentFingerprint && <code className={styles.fingerprint}>{selected.workflow.narrativeEvidenceLedger.contentFingerprint}</code>}
                <small className={styles.moduleNote}>It will be derived into the signed cinematic direction; replacing it requires a fresh Casefile revision.</small>
              </> : <>
                <textarea aria-label="Narrative evidence annotations JSON" className={`${styles.textarea} ${styles.textareaTall}`} value={narrativeEvidenceLedger} onChange={(event) => setNarrativeEvidenceLedger(event.target.value)} placeholder='{"claims":[{"id":"…", "approvedText":"…", "assertionState":"…", "confidence":"…", "uncertainty":{…}, "causalRole":"…", "supports":[{"sourceIds":[…], "upstreamClaimIds":[…]}], "allowedVisualTreatments":[…]}], "relations":[]}' />
                <textarea aria-label="Narrative evidence editorial review JSON" className={`${styles.textarea} ${styles.textareaCompact}`} value={narrativeEvidenceReview} onChange={(event) => setNarrativeEvidenceReview(event.target.value)} placeholder='{"reviewerId":"reviewer-…", "reviewId":"narrative-ledger-review-…", "reviewedAt":"2026-08-20T12:00:00.000Z"}' />
                <button type="button" className={styles.secondaryAction} disabled={actionDisabled || !selected.workflow?.sourceBoundStorySpine} onClick={() => { try { const input = parseObject(narrativeEvidenceLedger, "Narrative evidence annotations"); void submit("attach_narrative_evidence_ledger", { episodeId: selected._id, claims: requiredClaims(input), ...(input.relations === undefined ? {} : { relations: requiredRelations(input.relations) }), review: parseObject(narrativeEvidenceReview, "Narrative evidence review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze Narrative Evidence Ledger</button>
                {!selected.workflow?.sourceBoundStorySpine && <small className={styles.warning}>Freeze the matching source-bound Story Spine first. This prevents a ledger from being attached to a different narration timeline.</small>}
              </>}
            </section>
            <section className={styles.optionalModule}>
              <ModuleHeading tag="Optional binding" title="Reviewed reference mechanics" />
              <p className={styles.moduleCopy}>
                Supply original craft rules for the opening, rhythm, narration, cuts, audio, recurring identity, and exclusions. This intake accepts text only—never reference video, frames, audio, scripts, or an automatic similarity comparison. The server derives the current attributed documentary contract and binds the packet to this exact Story Spine before it is frozen.
              </p>
              {selected.workflow?.referenceMechanicsPacket ? <>
                <strong className={styles.recordedText}>Reviewed mechanics packet attached</strong>
                {selected.workflow.referenceMechanicsPacket.contentFingerprint && <code className={styles.fingerprint}>{selected.workflow.referenceMechanicsPacket.contentFingerprint}</code>}
                <small className={styles.moduleNote}>It will be signed into the cinematic sequence; replacing it requires a fresh immutable episode revision.</small>
              </> : <>
                <textarea aria-label="Reference mechanics annotations JSON" className={`${styles.textarea} ${styles.textareaTall}`} value={referenceMechanics} onChange={(event) => setReferenceMechanics(event.target.value)} placeholder={'{\n  "openingPromisePayoff": { "guidance": "State one source-bound question, then earn its answer later.", "sourceIds": ["fern"] },\n  "beatVisualRhythm": { "guidance": "Change the visual only when the evidence relationship changes.", "sourceIds": ["fern"] },\n  "narrationPaceClarity": { "guidance": "Keep the causal claim legible before underscoring it.", "sourceIds": ["fern"] },\n  "cutSceneFunction": { "guidance": "Each cut reveals a fact, relationship, or consequence.", "sourceIds": ["fern"] },\n  "audioRelationship": { "guidance": "Keep narration intelligible over restrained ambience.", "sourceIds": ["fern"] },\n  "recurringIdentity": { "guidance": "Use this channel’s own faceless cast and evidence treatment.", "sourceIds": ["fern"] },\n  "exclusions": { "guidance": "No copied cases, visual identity, footage, scripts, voices, or unsupported reconstructions.", "sourceIds": ["fern"] }\n}'} />
                <textarea aria-label="Reference mechanics editorial review JSON" className={`${styles.textarea} ${styles.textareaCompact}`} value={referenceMechanicsReview} onChange={(event) => setReferenceMechanicsReview(event.target.value)} placeholder='{"id":"reference-mechanics-review-...","reviewerId":"reviewer-...","reviewedAt":"2026-08-20T12:00:00.000Z"}' />
                <button type="button" className={styles.secondaryAction} disabled={actionDisabled} onClick={() => { try { void submit("attach_reference_mechanics", { episodeId: selected._id, mechanics: parseObject(referenceMechanics, "Reference mechanics"), review: parseObject(referenceMechanicsReview, "Reference mechanics review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze reviewed mechanics packet</button>
              </>}
            </section>
            <OperatorHeading index="04" title="Draft coverage" detail="Set the visual world, cast, shots, and cuts." />
            <textarea aria-label="Cinematic direction JSON" className={styles.textarea} value={direction} onChange={(event) => setDirection(event.target.value)} placeholder='{"version":"cinematic-case-direction/v1", ...}' />
            <button type="button" className={styles.primaryAction} disabled={actionDisabled} onClick={() => { try { void submit("draft_cinematic_sequence", { episodeId: selected._id, direction: parseObject(direction, "Cinematic direction") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Create review draft</button>
          </>}

          {selected?.status === "awaiting_cinematic_review" && <>
            <OperatorHeading index="05" title="Final review" detail="Approve the exact evidence map and cut." />
            {selected.workflow?.cinematicDraft?.sequenceContentFingerprint && <code className={styles.fingerprint}>{selected.workflow.cinematicDraft.sequenceContentFingerprint}</code>}
            <section className={styles.optionalModule}>
              <ModuleHeading tag="Required media proof" title="Bind approved source-proof media" />
              <p className={styles.moduleCopy}>
                For every source-proof shot, attach the exact approved asset, rights locator, SHA-256, and approval receipt. The server derives the source packet and provenance binding; this desk cannot substitute a different source or approve generated evidence.
              </p>
              {sourceProofMediaAttached ? <>
                <strong className={styles.recordedText}>Approved source-proof media are frozen into this review draft</strong>
                <small className={styles.moduleNote}>Replacing an asset requires a fresh immutable Casefile revision and a new cinematic review.</small>
              </> : <>
                <textarea aria-label="Source-proof media attachments JSON" className={`${styles.textarea} ${styles.textareaMedia}`} value={sourceProofMedia} onChange={(event) => setSourceProofMedia(event.target.value)} placeholder={'[{\n  "shotId": "cinematic-shot-…",\n  "sourceId": "source-…",\n  "assetId": "asset-…",\n  "rightsEvidenceLocator": "https://…",\n  "assetUrl": "https://…",\n  "assetSha256": "…",\n  "approvalReceiptId": "source-proof-receipt-…"\n}]'} />
                <button type="button" className={styles.secondaryAction} disabled={actionDisabled} onClick={() => { try { void submit("attach_source_proof_media", { episodeId: selected._id, attachments: parseSourceProofAttachments(sourceProofMedia) }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Freeze approved source-proof media</button>
              </>}
            </section>
            <textarea aria-label="Cinematic editorial review JSON" className={styles.textarea} value={review} onChange={(event) => setReview(event.target.value)} placeholder='{"id":"cinematic-sequence-review-...", "decision":"approved", ...}' />
            <button type="button" className={styles.primaryAction} disabled={actionDisabled} onClick={() => { try { void submit("finalize_cinematic_sequence", { episodeId: selected._id, editorialReview: parseObject(review, "Cinematic review") }); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Finalize render package</button>
          </>}

          {selected?.status === "render_admitted" && <>
            <OperatorHeading index="05" title="Render package admitted" detail={`This episode now has a fingerprint-bound LTX-ready multi-shot plan with ${selected.workflow?.cinematicAdmission?.generatedSceneCount ?? 0} generated scenes.`} />
            <p className={styles.admittedNote}>It remains private review only. Rendering still needs a separately approved, budgeted Novita action and final independent footage review.</p>
          </>}
        </section>
      </div>
      {message && <p role="status" className={`${styles.surface} ${styles.statusMessage}`} data-tone={message.startsWith("Saved") ? "success" : "error"}>{message}</p>}
      </>)}
    </div>
  );
}
