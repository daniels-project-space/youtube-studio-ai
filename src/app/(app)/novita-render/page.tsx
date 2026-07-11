"use client";

import { useState, type CSSProperties } from "react";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * Novita Render Farm — interactive console. Editable shot-list repeater +
 * camera/director/script controls, writing directly into the orchestrator's
 * job schema (no translation layer). Calls the module functions server-side
 * via /api/novita-render (image | video). Mirrors src/lib/novitaRenderFarm.ts.
 */

const CAMERA_MOVES = [
  "static", "dolly_push", "dolly_pull", "crane_up", "crane_down",
  "orbit_left", "orbit_right", "truck_left", "truck_right", "handheld_drift",
] as const;
type CameraMove = (typeof CAMERA_MOVES)[number];

const SHOT_SCALES = ["wide", "medium", "close", "extreme_close", "establishing"] as const;
type ShotScale = (typeof SHOT_SCALES)[number];

interface ShotRow {
  id: string;
  prompt: string;
  cameraMove: CameraMove;
  shotScale: ShotScale;
  lens: string;
  seconds: number;
  motion: string;
}

function newShot(i: number): ShotRow {
  return { id: `shot${String(i).padStart(3, "0")}`, prompt: "", cameraMove: "static", shotScale: "medium", lens: "35mm", seconds: 5, motion: "" };
}

const QUALITY_TIERS = {
  image: { base40: { steps: 40, label: "Base · 40 steps" }, base20: { steps: 20, label: "Fast · 20 steps" } },
} as const;
type ImageTier = keyof typeof QUALITY_TIERS.image;

type Phase = "idle" | "rendering-images" | "rendering-video" | "done" | "error";

export default function NovitaRenderPage() {
  const [shots, setShots] = useState<ShotRow[]>([newShot(1)]);
  const [style, setStyle] = useState("");
  const [negative, setNegative] = useState("blurry, low quality, watermark, text, deformed");
  const [director, setDirector] = useState("");
  const [imageTier, setImageTier] = useState<ImageTier>("base40");
  const [videoFrames, setVideoFrames] = useState(41); // 8n+1
  const [videoFps, setVideoFps] = useState(24);
  const [nshard, setNshard] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");
  const [stillKeys, setStillKeys] = useState<string[]>([]);

  function updateShot(id: string, patch: Partial<ShotRow>) {
    setShots((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addShot() {
    setShots((rows) => [...rows, newShot(rows.length + 1)]);
  }
  function removeShot(id: string) {
    setShots((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }

  const framesValid = (videoFrames - 1) % 8 === 0;
  const nshardValid = nshard >= 1 && nshard <= 3;

  async function callRenderApi(action: "image" | "video") {
    const body = {
      prefix: "novita-render-console",
      shots,
      style, negative, director,
      steps: QUALITY_TIERS.image[imageTier].steps,
      fps: videoFps,
      width: 1024, height: 576,
      nshard,
      jobs: "val" as const,
      stillKeys,
    };
    const res = await fetch("/api/novita-render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async function onRenderImages() {
    setPhase("rendering-images");
    setMessage("Submitting shot list to the Novita render farm…");
    try {
      const result = await callRenderApi("image");
      setStillKeys(result.stillKeys ?? []);
      setMessage(`${result.outputs ?? 0} still(s) rendered in ${result.durationSec ?? "?"}s.`);
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function onRenderVideo() {
    setPhase("rendering-video");
    setMessage("Submitting shot list + stills for image-to-video…");
    try {
      const result = await callRenderApi("video");
      setMessage(`${result.outputs ?? 0} clip(s) rendered in ${result.durationSec ?? "?"}s.`);
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const busy = phase === "rendering-images" || phase === "rendering-video";

  return (
    <>
      <PageHeader
        title="Novita Render Farm"
        subtitle="Camera / director / script console for the 8×4090 Novita spot-pod render farm — shot list writes directly into the orchestrator job schema."
      />

      <SectionTitle>Shot list</SectionTitle>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        {shots.map((s, i) => (
          <div key={s.id} style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.35rem" }}>
              <span style={LABEL}>Shot {i + 1} · {s.id}</span>
              <button type="button" onClick={() => removeShot(s.id)} disabled={shots.length <= 1} style={SMALL_BTN}>Remove</button>
            </div>
            <textarea
              placeholder="Script line / image prompt for this shot"
              value={s.prompt}
              onChange={(e) => updateShot(s.id, { prompt: e.target.value })}
              rows={2}
              style={TEXTAREA}
            />
            <div style={ROW}>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Camera move</span>
                <select value={s.cameraMove} onChange={(e) => updateShot(s.id, { cameraMove: e.target.value as CameraMove })} style={SELECT}>
                  {CAMERA_MOVES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Shot scale</span>
                <select value={s.shotScale} onChange={(e) => updateShot(s.id, { shotScale: e.target.value as ShotScale })} style={SELECT}>
                  {SHOT_SCALES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Lens</span>
                <input type="text" value={s.lens} onChange={(e) => updateShot(s.id, { lens: e.target.value })} style={INPUT} />
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Seconds</span>
                <input type="number" min={1} max={30} value={s.seconds} onChange={(e) => updateShot(s.id, { seconds: Number(e.target.value) })} style={INPUT} />
              </label>
            </div>
            <label style={{ ...FIELD, marginTop: "0.4rem" }}>
              <span style={FIELD_LABEL}>Motion cue (what actually moves — subject/particles, independent of camera)</span>
              <input type="text" value={s.motion} onChange={(e) => updateShot(s.id, { motion: e.target.value })} style={INPUT} placeholder="e.g. sparks fly from the anvil, cloak billows" />
            </label>
            {s.cameraMove === "static" && !s.motion.trim() && (
              <span style={WARN}>No motion cue — this shot needs a cameraMove or a motion description before it can render as video.</span>
            )}
          </div>
        ))}
        <button type="button" onClick={addShot} style={SECONDARY_BTN}>+ Add shot</button>
      </div>

      <div style={{ height: "1.4rem" }} />
      <SectionTitle>Global controls</SectionTitle>
      <div style={GRID}>
        <div style={CARD}>
          <span style={LABEL}>Style</span>
          <textarea value={style} onChange={(e) => setStyle(e.target.value)} rows={2} style={TEXTAREA} placeholder="Global style suffix appended to every shot prompt" />
        </div>
        <div style={CARD}>
          <span style={LABEL}>Negative (global)</span>
          <textarea value={negative} onChange={(e) => setNegative(e.target.value)} rows={2} style={TEXTAREA} />
        </div>
        <div style={CARD}>
          <span style={LABEL}>Director notes</span>
          <textarea value={director} onChange={(e) => setDirector(e.target.value)} rows={2} style={TEXTAREA} placeholder="Global creative direction, appended to every shot" />
        </div>
      </div>

      <div style={{ height: "1.4rem" }} />
      <SectionTitle>Quality tier</SectionTitle>
      <div style={ROW}>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Image base tier</span>
          <select value={imageTier} onChange={(e) => setImageTier(e.target.value as ImageTier)} style={SELECT}>
            <option value="base40">{QUALITY_TIERS.image.base40.label}</option>
            <option value="base20">{QUALITY_TIERS.image.base20.label}</option>
          </select>
        </label>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Video frames (8n+1)</span>
          <input type="number" value={videoFrames} onChange={(e) => setVideoFrames(Number(e.target.value))} style={INPUT} />
        </label>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Video fps</span>
          <input type="number" value={videoFps} onChange={(e) => setVideoFps(Number(e.target.value))} style={INPUT} />
        </label>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Shard count (≤3)</span>
          <input type="number" min={1} max={3} value={nshard} onChange={(e) => setNshard(Number(e.target.value))} style={INPUT} />
        </label>
      </div>
      {!framesValid && <span style={WARN}>Video frames must be 8n+1 (e.g. 9, 17, 25, 41, 121).</span>}
      {!nshardValid && <span style={WARN}>Shard count must be between 1 and 3 (Novita account cap).</span>}

      <div style={{ height: "1.4rem" }} />
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onRenderImages} disabled={busy} style={PRIMARY_BTN}>
          {phase === "rendering-images" ? "Rendering images…" : "Render Images"}
        </button>
        <button type="button" onClick={onRenderVideo} disabled={busy || stillKeys.length === 0} style={PRIMARY_BTN}>
          {phase === "rendering-video" ? "Rendering video…" : "Render Video"}
        </button>
        {message && <span style={{ fontSize: "0.82rem", color: phase === "error" ? "#e5484d" : "var(--color-muted)" }}>{message}</span>}
      </div>
    </>
  );
}

const CARD: CSSProperties = { background: "var(--color-surface-solid)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.7rem 0.8rem", display: "grid", gap: "0.4rem" };
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.6rem" };
const ROW: CSSProperties = { display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.4rem" };
const FIELD: CSSProperties = { display: "grid", gap: "0.25rem", minWidth: 140, flex: "1 1 140px" };
const FIELD_LABEL: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.04em", color: "var(--color-faint)", textTransform: "uppercase" };
const LABEL: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.66rem", letterSpacing: "0.04em", color: "var(--color-gold)", textTransform: "uppercase" };
const INPUT: CSSProperties = { padding: "0.4rem 0.55rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-fg)", font: "inherit", fontSize: "0.82rem" };
const SELECT: CSSProperties = { ...INPUT };
const TEXTAREA: CSSProperties = { ...INPUT, resize: "vertical", width: "100%" };
const WARN: CSSProperties = { fontSize: "0.72rem", color: "#e5484d", display: "block", marginTop: "0.3rem" };
const PRIMARY_BTN: CSSProperties = { padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", background: "var(--color-accent-soft)", color: "var(--color-fg)", font: "inherit", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" };
const SECONDARY_BTN: CSSProperties = { padding: "0.45rem 0.9rem", borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-muted)", font: "inherit", fontSize: "0.8rem", cursor: "pointer", justifySelf: "start" };
const SMALL_BTN: CSSProperties = { padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-faint)", font: "inherit", fontSize: "0.7rem", cursor: "pointer" };
