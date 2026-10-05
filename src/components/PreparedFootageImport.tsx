"use client";

import { useState, type FormEvent } from "react";

/** Manual completion bridge; the server binds ownership and verifies every output. */
export function PreparedFootageImport() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/plan-week/footage/materialize", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ channelSlug: form.get("channelSlug"), batchId: form.get("batchId"), itemId: form.get("itemId") }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error ?? "Could not request footage import.");
      setMessage(`Import verification queued (${result.triggerRunId}). Footage is available only after every scene passes verification.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request footage import.");
    } finally { setBusy(false); }
  }
  return <section className="studio-panel" style={{ padding: "1.5rem", marginTop: "1.5rem", maxWidth: "42rem" }}>
    <h2>Import completed prepared footage</h2>
    <p>Use the channel, batch, and item identifiers from your prepared plan after its scenes finish in Render Engine.</p>
    <form onSubmit={(event) => void submit(event)}>
      {[["channelSlug", "Channel slug"], ["batchId", "Batch ID"], ["itemId", "Item ID"]].map(([name, label]) =>
        <label key={name} style={{ display: "block", marginBottom: "0.75rem" }}>{label} <input style={{ display: "block", width: "100%", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "0.5rem", padding: "0.6rem", marginTop: "0.3rem", background: "rgba(255,255,255,0.04)" }} name={name} required maxLength={160} pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,159}" disabled={busy} /></label>)}
      <button className="studio-action studio-action-primary" type="submit" disabled={busy}>{busy ? "Requesting import…" : "Verify and import completed footage"}</button>
    </form>
    <p role="status">{message}</p>
  </section>;
}
