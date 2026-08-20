"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

const card: React.CSSProperties = {
  border: "1px solid var(--border, #273142)",
  borderRadius: 14,
  padding: 18,
  background: "linear-gradient(140deg, rgba(19,26,38,.94), rgba(10,15,24,.94))",
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 170,
  resize: "vertical",
  borderRadius: 10,
  border: "1px solid var(--border, #273142)",
  background: "#0c111b",
  color: "#e8edf5",
  padding: 12,
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
};

function parseArray(raw: string, name: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a valid JSON array`);
  }
}

/**
 * Private desk for the shared factual-evidence core. The browser performs
 * basic JSON validation; the authenticated API then creates/re-checks the
 * exact engine packet and its review fingerprint before this page may save it.
 */
export default function EditorialEvidencePage() {
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

  const refresh = useCallback(async () => {
    const response = await fetch("/api/editorial-evidence-packets", { cache: "no-store" });
    const result = await response.json() as { ok?: boolean; packets?: StoredPacket[]; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not load private evidence packets");
    setPackets(result.packets ?? []);
  }, []);

  // One read-only load on mount. The desk is not connected to channel creation,
  // rendering, paid providers, or publishing.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))); }, [refresh]);

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
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 22px 80px", display: "grid", gap: 18 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, color: "#84a8ff", fontSize: 12, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase" }}>Private editorial workflow</p>
        <h1 style={{ margin: 0, fontSize: 30 }}>Factual evidence desk</h1>
        <p style={{ margin: 0, maxWidth: 870, color: "#aeb9cb", lineHeight: 1.55 }}>
          Turn a human-reviewed source set and approved claims into one immutable evidence receipt for supervised factual explainers. Casefile’s source-use rights and reconstruction rules remain separate. This desk cannot create a channel, render, spend, or publish.
        </p>
      </header>

      <section style={{ ...card, display: "grid", gap: 8 }} aria-label="Evidence desk safety rail">
        <strong>Private-only admission</strong>
        <span style={{ color: "#b6c8e4", fontSize: 13, lineHeight: 1.5 }}>Every saved packet is fingerprint-bound to its exact sources, claims, reviewer id, review id, and timestamp. Editing any reviewed material requires a new validation and a new review receipt.</span>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(230px, .36fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <aside style={{ ...card, display: "grid", gap: 10 }}>
          <strong>Saved review receipts</strong>
          {packets.length === 0 ? <span style={{ color: "#8d9aad", fontSize: 13 }}>No private evidence packets saved yet.</span> : packets.map((packet) => (
            <button key={packet._id} type="button" onClick={() => setSelectedId(packet._id)} style={{ textAlign: "left", border: "1px solid #293448", borderRadius: 9, padding: 10, cursor: "pointer", color: "#e7edf8", background: selected?._id === packet._id ? "#182d4d" : "#101722" }}>
              <strong style={{ display: "block", fontSize: 13 }}>{packet.subject}</strong>
              <small style={{ color: "#9eadc1" }}>{packet.reviewId}</small>
              <small style={{ display: "block", color: "#71819a", marginTop: 3 }}>{packet.contentFingerprint.slice(0, 12)}…</small>
            </button>
          ))}
        </aside>

        <section style={{ ...card, display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>Build a review receipt</h2>
          <p style={{ margin: 0, color: "#aeb9cb", fontSize: 13, lineHeight: 1.5 }}>Use immutable source snapshots. The source SHA-256 is required; it is not a model summary or a search result.</p>

          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Subject
            <input aria-label="Evidence packet subject" value={subject} onChange={(event) => updateText(setSubject)(event.target.value)} placeholder="What this factual explainer is about" style={{ borderRadius: 8, border: "1px solid #273142", background: "#0c111b", color: "#e8edf5", padding: "10px 11px" }} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Reviewed sources JSON
            <textarea aria-label="Reviewed sources JSON" style={textarea} value={sources} onChange={(event) => updateText(setSources)(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Approved claims JSON
            <textarea aria-label="Approved claims JSON" style={textarea} value={claims} onChange={(event) => updateText(setClaims)(event.target.value)} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Reviewer id
              <input aria-label="Editorial reviewer id" value={reviewerId} onChange={(event) => updateText(setReviewerId)(event.target.value)} placeholder="editor-…" style={{ borderRadius: 8, border: "1px solid #273142", background: "#0c111b", color: "#e8edf5", padding: "10px 11px" }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Review id
              <input aria-label="Editorial review id" value={reviewId} onChange={(event) => updateText(setReviewId)(event.target.value)} placeholder="review-…" style={{ borderRadius: 8, border: "1px solid #273142", background: "#0c111b", color: "#e8edf5", padding: "10px 11px" }} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Review timestamp (UTC ISO 8601)
            <div style={{ display: "flex", gap: 8 }}>
              <input aria-label="Editorial review timestamp" value={reviewedAt} onChange={(event) => updateText(setReviewedAt)(event.target.value)} placeholder="2026-08-20T12:34:56.000Z" style={{ minWidth: 0, flex: 1, borderRadius: 8, border: "1px solid #273142", background: "#0c111b", color: "#e8edf5", padding: "10px 11px" }} />
              <button type="button" onClick={() => updateText(setReviewedAt)(new Date().toISOString())}>Use now</button>
            </div>
          </label>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" disabled={busy} onClick={() => { void validate(); }}>Validate exact packet</button>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#b6c8e4", fontSize: 13 }}>
              <input type="checkbox" checked={reviewerConfirmed} onChange={(event) => setReviewerConfirmed(event.target.checked)} />
              I confirm this is the named editor’s approved review.
            </label>
            <button type="button" disabled={busy || !preview || !reviewerConfirmed} onClick={() => { void admit(); }}>Save private receipt</button>
          </div>

          {preview && <section style={{ border: "1px solid #315a91", borderRadius: 10, padding: 12, background: "#0d1a2c", display: "grid", gap: 7 }} aria-label="Validated packet preview">
            <strong style={{ fontSize: 13, color: "#b9d6ff" }}>Validated immutable packet</strong>
            <code style={{ color: "#9fc0ff", overflowWrap: "anywhere", fontSize: 12 }}>{String(preview.contentFingerprint)}</code>
            <details><summary style={{ cursor: "pointer", color: "#b6c8e4", fontSize: 13 }}>Inspect exact packet JSON</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11, color: "#d9e5f5" }}>{JSON.stringify(preview, null, 2)}</pre></details>
          </section>}

          {selected && <section style={{ borderTop: "1px solid #273142", paddingTop: 14, display: "grid", gap: 6 }} aria-label="Saved packet audit">
            <strong style={{ fontSize: 14 }}>Selected saved receipt</strong>
            <span style={{ color: "#aeb9cb", fontSize: 13 }}>{selected.subject} · {selected.reviewId} · {new Date(selected.createdAt).toLocaleString()}</span>
            <code style={{ color: "#9fc0ff", overflowWrap: "anywhere", fontSize: 12 }}>{selected.contentFingerprint}</code>
            <details><summary style={{ cursor: "pointer", color: "#b6c8e4", fontSize: 13 }}>Inspect persisted audit packet</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11, color: "#d9e5f5" }}>{JSON.stringify(selected.packet, null, 2)}</pre></details>
          </section>}
        </section>
      </div>
      {message && <p role="status" style={{ ...card, margin: 0, color: message.startsWith("Saved") || message.startsWith("The exact") ? "#9be2b3" : "#ffb8b8" }}>{message}</p>}
    </main>
  );
}
