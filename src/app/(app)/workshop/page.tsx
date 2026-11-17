"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MODULE_CATALOG, getModuleSpec } from "@/engine/moduleCatalog";
import { CONTENT_LANE_BY_FAMILY } from "@/engine/contentLane";
import { useOwnerId } from "@/lib/owner-context";
import { canonicalJson } from "@/lib/canonicalJson";
import styles from "./workshop.module.css";

type Entry = { block: string; version?: string; params?: Record<string, unknown> };

function ModuleParameters({ entry, onChange }: { entry: Entry; onChange: (params: Record<string, unknown>) => void }) {
  const fields = getModuleSpec(entry.block)?.params ?? [];
  if (!fields.length) return null;
  const params = entry.params ?? {};
  const update = (key: string, value: unknown) => {
    const next = { ...params };
    if (value === undefined || value === "") delete next[key]; else next[key] = value;
    onChange(next);
  };
  return <details className={styles.parameters}>
    <summary>Configure {getModuleSpec(entry.block)?.label ?? entry.block}</summary>
    {fields.map(field => {
      const value = params[field.key];
      const options = entry.block === "narration_tts" && field.key === "ttsProvider"
        ? field.options?.filter(option => option.value === "qwen3") : field.options;
      const displayed = value === undefined || value === null ? "" : String(value);
      return <label key={field.key} className={styles.parameter}>
        <span>{field.label}</span>
        {field.type === "select" || field.type === "toggle" ? <select value={displayed} onChange={event => {
          const next = event.target.value;
          update(field.key, field.type === "toggle" && next ? next === "true" : next);
        }}>
          <option value="">Use default</option>
          {field.type === "toggle" ? <><option value="true">Enabled</option><option value="false">Disabled</option></> : <>
            {displayed && !options?.some(option => option.value === displayed) && <option value={displayed} disabled>Previously saved: {displayed} (unsupported)</option>}
            {options?.map(option => <option key={option.value} value={option.value}>{entry.block === "narration_tts" && field.key === "ttsProvider" && option.value === "qwen3" ? "Qwen3-TTS" : option.label}</option>)}
          </>}
        </select> : <input type={field.type === "number" ? "number" : "text"} value={displayed}
          min={field.min} max={field.max} step={field.step} maxLength={field.type === "text" ? 500 : undefined}
          onChange={event => { const next = event.target.value; update(field.key, field.type === "number" && next ? Number(next) : next); }} />}
        {field.help && !(entry.block === "narration_tts" && field.key === "ttsProvider") && <small>{field.help}</small>}
      </label>;
    })}
  </details>;
}

export default function WorkshopPage() {
  const ownerId = useOwnerId();
  const drafts = useQuery(api.workshopPipelineDrafts.list, { ownerId });
  const snapshots = useQuery(api.workshopPipelineDrafts.listSnapshots, { ownerId });
  const saveDraft = useMutation(api.workshopPipelineDrafts.save);
  const createSnapshot = useMutation(api.workshopPipelineDrafts.snapshot);
  const removeSnapshot = useMutation(api.workshopPipelineDrafts.removeSnapshot);
  const [draftId, setDraftId] = useState<Id<"workshopPipelineDrafts"> | undefined>();
  const [revision, setRevision] = useState<number | undefined>();
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(MODULE_CATALOG[0]?.block ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshotId, setSnapshotId] = useState<Id<"workshopPipelineSnapshots"> | undefined>();
  const [family, setFamily] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ signature: string; ok: boolean; error?: string; result?: { lane: string; reservedMaxCostUsd: number; unpinnedModules: string[]; warnings: string[] } }>();
  const checkSignature = JSON.stringify({ family, entries });
  const selectedSnapshot = snapshots?.find(snapshot => snapshot._id === snapshotId);
  const snapshotChanges = selectedSnapshot ? Array.from({ length: Math.max(selectedSnapshot.entries.length, entries.length) }, (_, index) => {
    const before = selectedSnapshot.entries[index], after = entries[index];
    return canonicalJson(before ?? null) === canonicalJson(after ?? null) ? null : { index, before, after };
  }).filter(change => change !== null) : [];

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
  async function snapshotDraft() {
    const saved = drafts?.find(draft => draft._id === draftId);
    if (!saved || saved.revision !== revision || saved.name !== name || (saved.family ?? "") !== family || canonicalJson(saved.entries) !== canonicalJson(entries)) {
      setMessage("Save or reload this draft before creating a snapshot.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const result = await createSnapshot({ ownerId, draftId: saved._id, expectedRevision: saved.revision });
      setSnapshotId(result.snapshotId);
      setMessage(result.reused ? "This saved revision already has a snapshot." : "Design snapshot saved. It has not been tested or approved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the snapshot."); }
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
          {drafts.map(draft => <li key={draft._id}><button type="button" style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", textAlign: "left" }} onClick={() => {
            setDraftId(draft._id); setRevision(draft.revision); setName(draft.name);
            setEntries(draft.entries as Entry[]); setFamily(draft.family ?? ""); setCheck(undefined); setMessage("");
          }}>{draft.name} · revision {draft.revision}</button></li>)}
        </ul>}
        <h3>Design snapshots</h3>
        {snapshots === undefined ? <p>Loading snapshots…</p> : snapshots.length === 0 ? <p>No snapshots yet.</p> : <ul>
          {snapshots.map(snapshot => <li key={snapshot._id}><button type="button" style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", textAlign: "left" }} onClick={() => setSnapshotId(snapshot._id)}>{snapshot.name} · revision {snapshot.draftRevision}</button></li>)}
        </ul>}
        {selectedSnapshot && <div>
          <p style={{ overflowWrap: "anywhere" }}><strong>{selectedSnapshot.name}</strong> · {selectedSnapshot.family?.replaceAll("_", " ")}</p>
          <p>Untested design snapshot · {selectedSnapshot.fingerprint.slice(0, 12)}</p>
          <ol>{selectedSnapshot.entries.map((entry, index) => <li key={`${index}-${entry.block}`}>
            {getModuleSpec(entry.block)?.label ?? entry.block}{entry.version ? ` · ${entry.version}` : " · unpinned"}
          </li>)}</ol>
          {selectedSnapshot.name !== name && <p>Name: {selectedSnapshot.name} → {name || "unset"}</p>}
          {selectedSnapshot.family !== (family || undefined) && <p>Format: {selectedSnapshot.family?.replaceAll("_", " ") ?? "unset"} → {family.replaceAll("_", " ") || "unset"}</p>}
          {snapshotChanges.length === 0 && selectedSnapshot.name === name && selectedSnapshot.family === (family || undefined) ? <p>The open draft matches this snapshot.</p> : <div>
            <p>{snapshotChanges.length} module position(s) differ from the open draft.</p>
            {snapshotChanges.map(change => <details key={change.index}>
              <summary>Module {change.index + 1}: {change.before?.block ?? "empty"} → {change.after?.block ?? "empty"}</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ snapshot: change.before ?? null, draft: change.after ?? null }, null, 2)}</pre>
            </details>)}
          </div>}
          <button type="button" onClick={() => {
            setDraftId(undefined); setRevision(undefined); setName(`${selectedSnapshot.name} copy`.slice(0, 120));
            setFamily(selectedSnapshot.family ?? ""); setEntries(structuredClone(selectedSnapshot.entries) as Entry[]); setCheck(undefined); setMessage("");
          }}>Load as new draft</button>
          <button type="button" disabled={busy} onClick={async () => {
            if (!window.confirm(`Delete the untested snapshot “${selectedSnapshot.name}”? The draft will not change.`)) return;
            setBusy(true); setMessage("");
            try { await removeSnapshot({ ownerId, snapshotId: selectedSnapshot._id, fingerprint: selectedSnapshot.fingerprint }); setSnapshotId(undefined); setMessage("Snapshot deleted."); }
            catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the snapshot."); }
            finally { setBusy(false); }
          }}>Delete snapshot</button>
        </div>}
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
            <ModuleParameters entry={entry} onChange={params => setEntries(current => current.map((item, i) => i === index ? { ...item, params } : item))} />
          </li>)}
        </ol>}
        <button type="button" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save draft"}</button>
        {draftId && <button type="button" disabled={busy || !family || !entries.length} onClick={snapshotDraft}>Create snapshot</button>}
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
