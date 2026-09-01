"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewedDataStoryRunDesk } from "@/components/ReviewedDataStoryRunDesk";
import { useOperationsAccess } from "@/components/OperationsAccess";
import { editorialEvidenceSummary } from "@/lib/editorialDeskEvidence";
import styles from "./editorial-evidence.module.css";

type EvidencePacket = Record<string, unknown> & {
  subject?: string;
  contentFingerprint?: string;
  review?: { reviewerId?: string; reviewId?: string; reviewedAt?: string };
};

type StoredPacket = {
  _id: string;
  subject: string;
  contentFingerprint: string;
  reviewId: string;
  reviewedAt: string;
  createdAt: number;
  packet: EvidencePacket;
};

const sourceTemplate = JSON.stringify([
  {
    id: "source-example",
    name: "Primary source title",
    url: "https://example.org/source",
    snapshotSha256: "replace-with-the-64-character-reviewed-source-snapshot-sha256",
    kind: "primary",
  },
], null, 2);

const claimTemplate = JSON.stringify([
  {
    id: "claim-example",
    sourceIds: ["source-example"],
    approvedText: "Exact approved statement for the factual script.",
    context: "Why this statement is accurate and how it may be presented.",
  },
], null, 2);

function parseArray(raw: string, name: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a valid JSON array`);
  }
}

function formattedTimestamp(value: string | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function EvidenceHero({
  access,
  selected,
  packetCount,
}: {
  access: ReturnType<typeof useOperationsAccess>;
  selected: StoredPacket | null;
  packetCount: number;
}) {
  const summary = editorialEvidenceSummary(selected?.packet);
  const reviewerReady = Boolean(summary.reviewerId && summary.reviewId);
  return (
    <section className={styles.hero} aria-busy={access === "checking" || undefined}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Editorial evidence / proof matrix</p>
        <h1>Nothing enters the script without a receipt.</h1>
        <p>
          Snapshot the source. Approve the exact claim. Name the reviewer. The
          resulting fingerprint is the editorial object—not a model summary.
        </p>
        <div className={styles.boundaryNote}>
          <span aria-hidden="true">≋</span>
          <div><small>Authority boundary</small><strong>Evidence only · supervised runs only</strong></div>
        </div>
      </div>
      <div className={styles.proofMatrix}>
        <div className={styles.matrixHeader}><span>Selected immutable receipt</span><small>{selected?.subject ?? "No receipt selected"}</small></div>
        <div className={styles.matrixField}>
          <ProofNode index="01" label="Source snapshots" value={selected ? String(summary.sourceCount).padStart(2, "0") : "—"} state={selected ? "held" : "waiting"} />
          <ProofNode index="02" label="Approved claims" value={selected ? String(summary.claimCount).padStart(2, "0") : "—"} state={selected ? "held" : "waiting"} />
          <ProofNode index="03" label="Named reviewer" value={summary.reviewerId ?? "—"} state={reviewerReady ? "held" : "waiting"} />
          <div className={styles.matrixReceipt} data-state={selected ? "held" : "waiting"}>
            <span>IMMUTABLE</span>
            <strong>{selected ? "RECEIPT HELD" : "AWAITING PACKET"}</strong>
            <small>{selected?.contentFingerprint?.slice(0, 18) ?? "sha256 / pending"}</small>
          </div>
          <i className={styles.matrixLineA} aria-hidden="true" />
          <i className={styles.matrixLineB} aria-hidden="true" />
          <i className={styles.matrixLineC} aria-hidden="true" />
        </div>
      </div>
      <div className={styles.metricRail}>
        <EvidenceMetric index="01" label="Receipts" value={String(packetCount).padStart(2, "0")} detail="private archive" />
        <EvidenceMetric index="02" label="Snapshots" value={selected ? String(summary.sourceCount).padStart(2, "0") : "—"} detail="stored SHA-256" />
        <EvidenceMetric index="03" label="Claims" value={selected ? String(summary.claimCount).padStart(2, "0") : "—"} detail="approved language" />
        <EvidenceMetric index="04" label="Reviewer" value={summary.reviewerId ?? "Unassigned"} detail="named human" />
        <EvidenceMetric index="05" label="Authority" value={access === "owner" ? "Open" : access === "checking" ? "Checking" : "Locked"} detail="signed session" />
      </div>
    </section>
  );
}

function ProofNode({ index, label, value, state }: { index: string; label: string; value: string; state: "held" | "waiting" }) {
  return (
    <div className={styles.proofNode} data-state={state}>
      <span>{index}</span><div><small>{label}</small><strong>{value}</strong></div><i aria-hidden="true" />
    </div>
  );
}

function EvidenceMetric({ index, label, value, detail }: { index: string; label: string; value: string; detail: string }) {
  return <div className={styles.metric}><span>{index} / {label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function LockedEvidenceVault({ access }: { access: Exclude<ReturnType<typeof useOperationsAccess>, "owner"> }) {
  return (
    <section className={styles.lockedVault} aria-live={access === "checking" ? "polite" : undefined}>
      <div className={styles.vaultMark} aria-hidden="true"><span>SHA</span><i /><b /></div>
      <div className={styles.vaultCopy}>
        <p className={styles.eyebrow}>{access === "checking" ? "Resolving signed session" : "Evidence archive protected"}</p>
        <h2>{access === "checking" ? "Checking vault authority…" : "The proof vault is closed."}</h2>
        <p>{access === "checking" ? "The studio is checking this browser before requesting any private receipts." : "Open owner operations from the top bar to inspect source snapshots and review fingerprints. No private evidence request was sent."}</p>
      </div>
      <div className={styles.vaultRules}>
        <div><span>01</span><strong>No synthetic proof</strong><p>Search results and model summaries never count as source snapshots.</p></div>
        <div><span>02</span><strong>No silent approval</strong><p>Every persisted packet names the human review and timestamp.</p></div>
        <div><span>03</span><strong>No release authority</strong><p>Receipts cannot render, spend, schedule, or publish by themselves.</p></div>
      </div>
    </section>
  );
}

function BuilderHeading() {
  return (
    <div className={styles.builderHeading}>
      <span>NEW</span>
      <div><p>Immutable receipt builder</p><h2>Assemble the exact reviewed record.</h2><small>Changing any field clears the validated preview, so a saved receipt cannot drift from its fingerprint.</small></div>
    </div>
  );
}

/**
 * Private desk for the shared factual-evidence core. The browser performs
 * basic JSON validation; the authenticated API then creates/re-checks the
 * exact engine packet and its review fingerprint before this page may save it.
 */
export default function EditorialEvidencePage() {
  const operationsAccess = useOperationsAccess();
  const [subject, setSubject] = useState("");
  const [sources, setSources] = useState(sourceTemplate);
  const [claims, setClaims] = useState(claimTemplate);
  const [reviewerId, setReviewerId] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [reviewedAt, setReviewedAt] = useState("");
  const [reviewerConfirmed, setReviewerConfirmed] = useState(false);
  const [preview, setPreview] = useState<EvidencePacket | null>(null);
  const [packets, setPackets] = useState<StoredPacket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const invalidatePreview = useCallback(() => setPreview(null), []);
  const selected = useMemo(
    () => packets.find((packet) => packet._id === selectedId) ?? packets[0] ?? null,
    [packets, selectedId],
  );
  const selectedSummary = editorialEvidenceSummary(selected?.packet);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/editorial-evidence-packets", { cache: "no-store" });
    const result = await response.json() as { ok?: boolean; packets?: StoredPacket[]; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not load private evidence packets");
    setPackets(result.packets ?? []);
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

  const validate = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Fast client-side JSON-shape feedback precedes the authoritative engine
      // validation below, which creates the same schema/fingerprint object used
      // by the private Convex persistence mutation.
      const sourceEntries = parseArray(sources, "Sources");
      const claimEntries = parseArray(claims, "Claims");
      const response = await fetch("/api/editorial-evidence-packets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "validate",
          subject,
          sources: sourceEntries,
          claims: claimEntries,
          review: { reviewerId, reviewId, reviewedAt },
        }),
      });
      const result = await response.json() as { ok?: boolean; packet?: EvidencePacket; error?: string };
      if (!response.ok || !result.ok || !result.packet) throw new Error(result.error ?? "Evidence packet was rejected");
      setPreview(result.packet);
      setMessage("The exact private, reviewer-bound packet is valid. Confirm and save it when ready.");
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [claims, reviewId, reviewedAt, reviewerId, sources, subject]);

  const admit = useCallback(async () => {
    if (!preview) {
      setMessage("Validate the current material before saving it.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial-evidence-packets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "admit", packet: preview, reviewerConfirmed }),
      });
      const result = await response.json() as { ok?: boolean; packet?: StoredPacket; error?: string };
      if (!response.ok || !result.ok || !result.packet) throw new Error(result.error ?? "Evidence packet was not saved");
      await refresh();
      setSelectedId(result.packet._id);
      setMessage("Saved as an immutable private editorial-evidence receipt. It has not started a render, channel, spend, or publish action.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [preview, refresh, reviewerConfirmed]);

  const updateText = (set: (value: string) => void) => (value: string) => {
    invalidatePreview();
    set(value);
  };

  return (
    <div className={styles.desk}>
      <EvidenceHero access={operationsAccess} selected={selected} packetCount={packets.length} />

      {operationsAccess !== "owner" ? (
        <LockedEvidenceVault access={operationsAccess} />
      ) : (<>

      <div className={styles.workspace}>
        <aside className={`${styles.surface} ${styles.library}`}>
          <div className={styles.libraryHeader}>
            <strong>Saved review receipts</strong>
            <span>{packets.length} recorded</span>
          </div>
          {packets.length === 0 ? <span className={styles.emptyLibrary}>No private evidence packets saved yet.</span> : <div className={styles.recordList}>{packets.map((packet) => {
            const packetSummary = editorialEvidenceSummary(packet.packet);
            return (
              <button
                key={packet._id}
                type="button"
                onClick={() => setSelectedId(packet._id)}
                className={`${styles.recordButton} ${selected?._id === packet._id ? styles.recordButtonSelected : ""}`}
              >
                <strong className={styles.recordTitle}>{packet.subject}</strong>
                <span className={styles.recordDetail}>{packetSummary.sourceCount} source snapshots · {packetSummary.claimCount} approved claims</span>
                <code className={styles.recordFingerprint}>{packet.contentFingerprint}</code>
              </button>
            );
          })}</div>}
        </aside>

        <section className={`${styles.surface} ${styles.operatorPane}`}>
          <BuilderHeading />

          <section className={styles.formModule}>
            <div className={styles.moduleTitle}><span>01</span><div><strong>Story scope</strong><small>Name the one factual explainer this receipt covers.</small></div></div>
            <label className={styles.field}>Subject
              <input aria-label="Evidence packet subject" value={subject} onChange={(event) => updateText(setSubject)(event.target.value)} placeholder="What this factual explainer is about" />
            </label>
          </section>

          <section className={styles.formModule}>
            <div className={styles.moduleTitle}><span>02</span><div><strong>Source + claim sets</strong><small>Each source snapshot needs its SHA-256; each approved claim points back to it.</small></div></div>
            <div className={styles.evidenceInputs}>
              <label className={styles.field}>Reviewed sources JSON
                <textarea aria-label="Reviewed sources JSON" className={styles.textarea} value={sources} onChange={(event) => updateText(setSources)(event.target.value)} />
              </label>
              <label className={styles.field}>Approved claims JSON
                <textarea aria-label="Approved claims JSON" className={styles.textarea} value={claims} onChange={(event) => updateText(setClaims)(event.target.value)} />
              </label>
            </div>
          </section>

          <section className={styles.formModule}>
            <div className={styles.moduleTitle}><span>03</span><div><strong>Human review signature</strong><small>The named editor, review id, and timestamp become part of the fingerprinted packet.</small></div></div>
            <div className={styles.reviewGrid}>
              <label className={styles.field}>Reviewer id
                <input aria-label="Editorial reviewer id" value={reviewerId} onChange={(event) => updateText(setReviewerId)(event.target.value)} placeholder="editor-…" />
              </label>
              <label className={styles.field}>Review id
                <input aria-label="Editorial review id" value={reviewId} onChange={(event) => updateText(setReviewId)(event.target.value)} placeholder="review-…" />
              </label>
            </div>
            <label className={styles.field}>Review timestamp (UTC ISO 8601)
              <div className={styles.timestampRow}>
                <input aria-label="Editorial review timestamp" value={reviewedAt} onChange={(event) => updateText(setReviewedAt)(event.target.value)} placeholder="2026-08-20T12:34:56.000Z" />
                <button type="button" className={styles.utilityAction} onClick={() => updateText(setReviewedAt)(new Date().toISOString())}>Use now</button>
              </div>
            </label>
          </section>

          <section className={styles.commitModule}>
            <div className={styles.commitCopy}><span>04</span><div><strong>Validate, confirm, save</strong><small>The authoritative API rebuilds the exact packet before persistence.</small></div></div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.validateAction} disabled={busy} onClick={() => { void validate(); }}>Validate exact packet</button>
              <label className={styles.confirmation}>
                <input type="checkbox" checked={reviewerConfirmed} onChange={(event) => setReviewerConfirmed(event.target.checked)} />
                <span>I confirm this is the named editor’s approved review.</span>
              </label>
              <button type="button" className={styles.saveAction} disabled={busy || !preview || !reviewerConfirmed} onClick={() => { void admit(); }}>Save private receipt</button>
            </div>
          </section>

          {preview && <section className={styles.validatedPacket} aria-label="Validated packet preview">
            <span>VALIDATED</span><strong>Immutable packet ready for named confirmation</strong>
            <code>{String(preview.contentFingerprint)}</code>
            <details><summary>Inspect exact packet JSON</summary><pre>{JSON.stringify(preview, null, 2)}</pre></details>
          </section>}

          {selected && <section className={styles.savedAudit} aria-label="Saved packet audit">
            <div className={styles.savedAuditHeading}><span>ARCHIVED</span><strong>Selected saved receipt</strong><small>{selected.subject} · {selected.reviewId} · {new Date(selected.createdAt).toLocaleString()}</small></div>
            <div className={styles.receiptMetrics}>
              <span className={styles.receiptMetric}><small>Sources</small><strong>{selectedSummary.sourceCount} recorded</strong></span>
              <span className={styles.receiptMetric}><small>Claims</small><strong>{selectedSummary.claimCount} recorded</strong></span>
              <span className={styles.receiptMetric}><small>Reviewer</small><strong>{selectedSummary.reviewerId ?? "Not recorded"}</strong></span>
              <span className={styles.receiptMetric}><small>Reviewed</small><strong title={selectedSummary.reviewedAt}>{formattedTimestamp(selectedSummary.reviewedAt)}</strong></span>
            </div>
            <code className={styles.fingerprint}>{selected.contentFingerprint}</code>
            <details className={styles.auditDetails}><summary>Inspect persisted audit packet</summary><pre>{JSON.stringify(selected.packet, null, 2)}</pre></details>
          </section>}
        </section>
      </div>
      <div className={styles.supervisedLane}><ReviewedDataStoryRunDesk /></div>
      {message && <p role="status" className={`${styles.surface} ${styles.statusMessage}`} data-tone={message.startsWith("Saved") || message.startsWith("The exact") ? "success" : "error"}>{message}</p>}
      </>)}
    </div>
  );
}
