"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ReviewedDataStoryRunDesk.module.css";

type Channel = { id: string; name: string; slug?: string; status?: string; family?: string };
type Pack = {
  id: string;
  contentFingerprint: string;
  topicFingerprint?: string;
  reviewerId?: string;
  reviewedAt?: string;
};

const ledgerTemplate = JSON.stringify({
  version: "data-story-source-ledger/v1",
  topic: "A narrowly sourced factual question for this channel",
  sources: [{
    id: "source-one",
    name: "Reviewed primary source",
    url: "https://example.org/source",
    snapshotSha256: "replace-with-the-64-character-reviewed-snapshot-sha256",
  }],
  claims: [
    { id: "claim-one", sourceId: "source-one", numericAnchor: "12%", context: "Exact reviewed framing." },
    { id: "claim-two", sourceId: "source-one", numericAnchor: "18%", context: "Second reviewed data point." },
    { id: "claim-three", sourceId: "source-one", numericAnchor: "24%", context: "Third reviewed data point." },
  ],
  review: {
    decision: "approved",
    reviewerId: "named-data-reviewer",
    reviewId: "ledger-review-id",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    reviewedLedgerFingerprint: "replace-with-the-ledger-fingerprint-after-validation",
  },
}, null, 2);

const packReviewTemplate = JSON.stringify({
  reviewerId: "named-pack-reviewer",
  reviewId: "pack-review-id",
  reviewedAt: "2026-01-01T00:00:00.000Z",
}, null, 2);

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be valid JSON object`);
  }
}

/**
 * A deliberately separate, supervised factual-run control. It does not use
 * automatic channel creation or calendar cadence: the operator names a saved
 * immutable ledger and then starts one review-paused run.
 */
export function ReviewedDataStoryRunDesk() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [channelId, setChannelId] = useState("");
  const [packId, setPackId] = useState("");
  const [ledger, setLedger] = useState(ledgerTemplate);
  const [packReview, setPackReview] = useState(packReviewTemplate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === channelId),
    [channelId, channels],
  );
  const selectedPack = useMemo(
    () => packs.find((pack) => pack.id === packId),
    [packId, packs],
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/reviewed-data-story-runs", { cache: "no-store" });
    const result = await response.json() as { ok?: boolean; channels?: Channel[]; packs?: Pack[]; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not load reviewed data-story options");
    const nextChannels = result.channels ?? [];
    const nextPacks = result.packs ?? [];
    setChannels(nextChannels);
    setPacks(nextPacks);
    setChannelId((current) => nextChannels.some((channel) => channel.id === current) ? current : (nextChannels[0]?.id ?? ""));
    setPackId((current) => nextPacks.some((pack) => pack.id === current) ? current : (nextPacks[0]?.id ?? ""));
  }, []);

  useEffect(() => {
    // Schedule the external authenticated read after the initial paint. This
    // keeps state updates out of the effect's synchronous setup path.
    const timer = window.setTimeout(() => {
      void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const savePack = useCallback(async () => {
    if (!channelId) {
      setMessage("Choose a sealed source-data-story channel before saving a ledger.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reviewed-data-story-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_pack",
          channelId,
          dataStorySourceLedger: parseObject(ledger, "Source ledger"),
          review: parseObject(packReview, "Pack review"),
        }),
      });
      const result = await response.json() as { ok?: boolean; pack?: Pack; error?: string };
      if (!response.ok || !result.ok || !result.pack) throw new Error(result.error ?? "The reviewed ledger was rejected");
      await refresh();
      setPackId(result.pack.id);
      setMessage("Saved an immutable reviewed source ledger. It has not started a run, provider call, or publish action.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [channelId, ledger, packReview, refresh]);

  const prepareLedgerFingerprint = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const current = parseObject(ledger, "Source ledger");
      const response = await fetch("/api/reviewed-data-story-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare_ledger", dataStorySourceLedger: current }),
      });
      const result = await response.json() as { ok?: boolean; reviewedLedgerFingerprint?: string; error?: string };
      if (!response.ok || !result.ok || !result.reviewedLedgerFingerprint) {
        throw new Error(result.error ?? "Could not prepare the ledger fingerprint");
      }
      const review = current.review && typeof current.review === "object" && !Array.isArray(current.review)
        ? current.review as Record<string, unknown>
        : {};
      setLedger(JSON.stringify({
        ...current,
        review: { ...review, reviewedLedgerFingerprint: result.reviewedLedgerFingerprint },
      }, null, 2));
      setMessage("Prepared the immutable ledger fingerprint. Confirm the named reviewer, review id, and timestamp before saving.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [ledger]);

  const start = useCallback(async () => {
    if (!channelId || !packId) {
      setMessage("Choose both a sealed channel and a saved reviewed ledger.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reviewed-data-story-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", channelId, packId }),
      });
      const result = await response.json() as { ok?: boolean; state?: "created" | "reused"; runId?: string; error?: string };
      if (!response.ok || !result.ok || !result.runId) throw new Error(result.error ?? "Could not create the supervised run");
      setMessage(
        `${result.state === "reused" ? "Reopened the existing" : "Created a"} supervised run (${result.runId}). ` +
        "It will pause after the retained narration and Episode Graph review; it has no public publish authority.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [channelId, packId]);

  return (
    <section className={styles.desk} aria-labelledby="reviewed-data-story-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Supervised factual lane</p>
          <h2 id="reviewed-data-story-heading">Move one receipt into a review-paused episode.</h2>
          <p>
            Save a human-reviewed, source-first ledger for one sealed channel, then intentionally start one
            private review-paused episode. Cadence never selects this content and a saved ledger never publishes by itself.
          </p>
        </div>
        <span className={styles.badge}>Manual admission</span>
      </header>

      <div className={styles.laneTrace} aria-label="Reviewed Data Story admission route">
        <div data-state={selectedChannel ? "ready" : "waiting"}><span>01</span><strong>Sealed channel</strong><small>{selectedChannel ? selectedChannel.name : "Choose route"}</small><i /></div>
        <div data-state={selectedPack ? "ready" : "waiting"}><span>02</span><strong>Reviewed ledger</strong><small>{selectedPack ? "Receipt held" : "Save evidence"}</small><i /></div>
        <div data-state="manual"><span>03</span><strong>Private run</strong><small>Owner starts once</small><i /></div>
        <div data-state="pause"><span>04</span><strong>Human pause</strong><small>Narration + graph</small><i /></div>
      </div>

      <div className={styles.grid}>
        <label>
          <span>Sealed channel</span>
          <select aria-label="Reviewed data-story channel" value={channelId} onChange={(event) => setChannelId(event.target.value)} disabled={busy}>
            {channels.length === 0 && <option value="">No compatible channel is available</option>}
            {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.slug}</option>)}
          </select>
          <small>{selectedChannel ? "The server rechecks its exact route, Show Profile, and v4 review boundary." : "Create a sealed supervised source-data-story channel first."}</small>
        </label>
        <label>
          <span>Saved reviewed ledger</span>
          <select aria-label="Reviewed data-story evidence pack" value={packId} onChange={(event) => setPackId(event.target.value)} disabled={busy}>
            {packs.length === 0 && <option value="">No reviewed ledgers saved</option>}
            {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.contentFingerprint.slice(0, 12)}… · {pack.reviewerId ?? "reviewer recorded"}</option>)}
          </select>
          <small>{selectedPack ? `Immutable receipt ${selectedPack.contentFingerprint.slice(0, 18)}…` : "Save a reviewed source ledger below before starting a run."}</small>
        </label>
      </div>

      <details className={styles.details}>
        <summary><span>Ledger intake</span> Save a new reviewed source ledger</summary>
        <p>Use exact source snapshots and named review receipts. The server derives the route, Show Profile, topic binding, and pack fingerprint; it rejects unreviewed or mismatched data.</p>
        <label>
          <span>Source ledger JSON</span>
          <textarea aria-label="Reviewed data-story source ledger JSON" value={ledger} onChange={(event) => setLedger(event.target.value)} disabled={busy} />
        </label>
        <label>
          <span>Pack review JSON</span>
          <textarea aria-label="Reviewed data-story pack review JSON" value={packReview} onChange={(event) => setPackReview(event.target.value)} disabled={busy} />
        </label>
        <div className={styles.detailActions}>
          <button type="button" onClick={() => { void prepareLedgerFingerprint(); }} disabled={busy}>Prepare ledger fingerprint</button>
          <button type="button" onClick={() => { void savePack(); }} disabled={busy || !channelId}>Save immutable reviewed ledger</button>
        </div>
      </details>

      <div className={styles.actions}>
        <button type="button" onClick={() => { void start(); }} disabled={busy || !channelId || !packId}>Start private review-paused episode</button>
        <span>There is no automatic retry loop, public publishing, or generic calendar fallback.</span>
      </div>
      {message && <p className={styles.message} role="status">{message}</p>}
    </section>
  );
}
