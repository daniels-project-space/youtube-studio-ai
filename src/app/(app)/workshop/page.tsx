"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MODULE_CATALOG } from "@/engine/moduleCatalog";
import { CONTENT_LANE_BY_FAMILY } from "@/engine/contentLane";
import { useOwnerId } from "@/lib/owner-context";
import styles from "./workshop.module.css";

type Entry = { block: string; version?: string; params?: Record<string, unknown> };

export default function WorkshopPage() {
  const ownerId = useOwnerId();
  const drafts = useQuery(api.workshopPipelineDrafts.list, { ownerId });
  const saveDraft = useMutation(api.workshopPipelineDrafts.save);
  const [draftId, setDraftId] = useState<Id<"workshopPipelineDrafts"> | undefined>();
  const [revision, setRevision] = useState<number | undefined>();
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(MODULE_CATALOG[0]?.block ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [family, setFamily] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ signature: string; ok: boolean; error?: string; result?: { lane: string; reservedMaxCostUsd: number; unpinnedModules: string[]; warnings: string[] } }>();
  const checkSignature = JSON.stringify({ family, entries });

  function reset() { setDraftId(undefined); setRevision(undefined); setName(""); setEntries([]); setFamily(""); setCheck(undefined); setMessage(""); }
  async function save() {
    setBusy(true); setMessage("");
    try {
      const id = await saveDraft({ ownerId, ...(draftId ? { draftId, expectedRevision: revision } : {}), name, ...(family ? { family } : {}), entries });
      setDraftId(id);
      setRevision(draftId ? (revision ?? 0) + 1 : 1);
      setMessage("Draft saved. It has not been tested or approved for a channel.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the draft."); }
    finally { setBusy(false); }
  }
  function move(index: number, direction: number) {
    const next = [...entries], target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!]; setEntries(next);
  }
  async function checkCompatibility() {
    const signature = checkSignature;
    setChecking(true); setCheck(undefined);
    try {
      const response = await fetch("/api/workshop/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: signature });
      const data = await response.json() as { ok: boolean; error?: string; result?: { lane: string; reservedMaxCostUsd: number; unpinnedModules: string[]; warnings: string[] } };
      setCheck({ signature, ...data });
    } catch { setCheck({ signature, ok: false, error: "Could not reach the compatibility checker." }); }
    finally { setChecking(false); }
  }
  const box = { padding: "1rem", border: "1px solid var(--color-border)", borderRadius: "0.75rem" };
  return <section className={styles.workshop}>
    <header><h1>Pipeline workshop</h1><p>Build a private draft from the module catalog. Saving does not change a channel.</p>
      <Link href="/golden">Explore module responsibilities</Link></header>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))", gap: "1rem" }}>
      <section style={box}><h2>Saved drafts</h2>
        <button type="button" onClick={reset}>New draft</button>
        {drafts === undefined ? <p>Loading drafts…</p> : drafts.length === 0 ? <p>No saved drafts yet.</p> : <ul>
          {drafts.map(draft => <li key={draft._id}><button type="button" onClick={() => {
            setDraftId(draft._id); setRevision(draft.revision); setName(draft.name);
            setEntries(draft.entries as Entry[]); setFamily(draft.family ?? ""); setCheck(undefined); setMessage("");
          }}>{draft.name} · revision {draft.revision}</button></li>)}
        </ul>}
      </section>
      <section style={box}><h2>{draftId ? "Edit draft" : "New draft"}</h2>
        <label>Draft name <input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
        <div style={{ marginTop: "1rem" }}><label>Module <select value={selected} onChange={event => setSelected(event.target.value)}>
          {MODULE_CATALOG.map(module => <option key={module.block} value={module.block}>{module.label}</option>)}
        </select></label>{" "}<button type="button" disabled={!selected || entries.length >= 100} onClick={() => setEntries([...entries, { block: selected, params: {} }])}>Add module</button></div>
        <p>{MODULE_CATALOG.find(module => module.block === selected)?.description}</p>
        {entries.length === 0 ? <p>Add modules in the order they should run.</p> : <ol>
          {entries.map((entry, index) => <li key={`${index}-${entry.block}`} style={{ marginBottom: "0.5rem" }}>
            {MODULE_CATALOG.find(module => module.block === entry.block)?.label ?? entry.block}{" "}
            <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${entry.block} up`}>↑</button>{" "}
            <button type="button" disabled={index === entries.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${entry.block} down`}>↓</button>{" "}
            <button type="button" onClick={() => setEntries(entries.filter((_, i) => i !== index))} aria-label={`Remove ${entry.block}`}>Remove</button>
          </li>)}
        </ol>}
        <button type="button" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save draft"}</button>
        {message && <p role="status">{message}</p>}
        <h3>Check compatibility</h3>
        <label>Video format <select value={family} onChange={event => setFamily(event.target.value)}>
          <option value="">Choose a format</option>
          {Object.keys(CONTENT_LANE_BY_FAMILY).map(key => <option key={key} value={key}>{key.replaceAll("_", " ")}</option>)}
        </select></label>{" "}
        <button type="button" disabled={checking || !family || !entries.length} onClick={checkCompatibility}>{checking ? "Checking…" : "Check pipeline"}</button>
        {check && check.signature === checkSignature && <div role="status">
          {check.ok && check.result ? <>
            <p>Structural and production-policy checks passed for {check.result.lane.replaceAll("_", " ")}.</p>
            <p>Configured maximum reservation: ${check.result.reservedMaxCostUsd.toFixed(2)}; actual cost may differ.</p>
            {check.result.unpinnedModules.length > 0 && <p>{check.result.unpinnedModules.length} module version(s) are not pinned; this is not a retained release.</p>}
            {check.result.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}
          </> : <p>Compatibility check: {check.error ?? "Unknown error"}</p>}
        </div>}
        {check && check.signature !== checkSignature && <p>The draft or format changed; check it again.</p>}
        <p>This check does not run a private trial, verify providers or approve a release.</p>
      </section>
    </div>
  </section>;
}
