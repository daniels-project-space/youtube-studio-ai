"use client";

import { useState, type CSSProperties } from "react";
import { GENERATION_PROFILES, type GenerationProfile } from "@/engine/generationProfiles";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

const CAMERA_MOVES = [
  "static", "dolly_push", "dolly_pull", "crane_up", "crane_down",
  "orbit_left", "orbit_right", "truck_left", "truck_right", "handheld_drift",
] as const;
type CameraMove = (typeof CAMERA_MOVES)[number];

const SHOT_SCALES = ["wide", "medium", "close", "extreme_close", "establishing"] as const;
type ShotScale = (typeof SHOT_SCALES)[number];
type ProfileId = GenerationProfile["id"];

interface ShotRow {
  id: string;
  prompt: string;
  cameraMove: CameraMove;
  shotScale: ShotScale;
  lens: string;
  seconds: number;
  motion: string;
  stillKey?: string;
}

interface RenderLaunch {
  ok: true;
  jobId: string;
  phase: "image" | "video";
  profileId: ProfileId;
  status: "queued";
}

interface RenderStatus {
  ok: boolean;
  jobId: string;
  phase: "image" | "video";
  status: "queued" | "launching" | "running" | "done" | "failed";
  n_outputs: number;
  n_jobs: number;
  missingKeys: string[];
  failedIds: string[];
  stillKeys?: string[];
  footageKeys?: string[];
  error?: string | null;
}

type Phase = "idle" | "rendering-images" | "rendering-video" | "done" | "error";

function newShot(i: number): ShotRow {
  return {
    id: `shot${String(i).padStart(3, "0")}`,
    prompt: "",
    cameraMove: "static",
    shotScale: "medium",
    lens: "35mm",
    seconds: 5,
    motion: "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function NovitaRenderPage() {
  const [shots, setShots] = useState<ShotRow[]>([newShot(1)]);
  const [style, setStyle] = useState("");
  const [negative, setNegative] = useState("blurry, low quality, watermark, text, deformed");
  const [director, setDirector] = useState("");
  const [profileId, setProfileId] = useState<ProfileId>("production");
  const [nshard, setNshard] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const profile = GENERATION_PROFILES[profileId];

  function clearAllStills() {
    setShots((rows) => rows.map((row) => ({ ...row, stillKey: undefined })));
  }

  function updateShot(id: string, patch: Partial<ShotRow>) {
    setShots((rows) => rows.map((row) => {
      if (row.id !== id) return row;
      return {
        ...row,
        ...patch,
        ...(patch.prompt !== undefined ? { stillKey: undefined } : {}),
      };
    }));
  }

  function addShot() {
    setShots((rows) => [...rows, newShot(rows.length + 1)]);
  }

  function removeShot(id: string) {
    setShots((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== id) : rows));
  }

  function updateProfile(next: ProfileId) {
    setProfileId(next);
    clearAllStills();
  }

  function updateImageGlobal(setter: (value: string) => void, value: string) {
    setter(value);
    clearAllStills();
  }

  const nshardValid = nshard >= 1 && nshard <= 3;
  const promptsValid = shots.every((shot) => shot.prompt.trim().length > 0);
  const motionValid = shots.every(
    (shot) => shot.cameraMove !== "static" || shot.motion.trim().length > 0,
  );
  const stillsReady = shots.every((shot) => Boolean(shot.stillKey));

  async function callRenderApi(action: "image" | "video"): Promise<RenderLaunch> {
    const response = await fetch("/api/novita-render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        profileId,
        shots,
        style,
        negative,
        director,
        nshard,
      }),
    });
    const payload = await response.json().catch(() => null) as (RenderLaunch & { error?: string }) | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? `render launch failed with HTTP ${response.status}`);
    }
    return payload;
  }

  async function pollRender(launch: RenderLaunch): Promise<RenderStatus> {
    const startedAt = Date.now();
    for (;;) {
      const response = await fetch(
        `/api/novita-render?jobId=${encodeURIComponent(launch.jobId)}&profileId=${encodeURIComponent(launch.profileId)}`,
        { cache: "no-store" },
      );
      const status = await response.json().catch(() => null) as (RenderStatus & { error?: string }) | null;
      if (!response.ok || !status) {
        throw new Error(status?.error ?? `render status failed with HTTP ${response.status}`);
      }
      if (status.jobId !== launch.jobId || status.phase !== launch.phase) {
        throw new Error("render bridge returned a mismatched job identity");
      }
      if (status.status === "failed") {
        throw new Error(status.error ?? `${status.phase} render failed`);
      }
      if (status.status === "done") return status;
      if (Date.now() - startedAt > 24 * 60 * 60 * 1_000) {
        throw new Error(`${status.phase} render timed out after 24 hours`);
      }
      setMessage(`${status.phase} job ${status.jobId} is ${status.status} (${status.n_outputs}/${status.n_jobs})…`);
      await sleep(10_000);
    }
  }

  function confirmPaidLaunch(kind: "image" | "video"): boolean {
    return window.confirm(
      `Start a paid Novita spot-GPU ${kind} render for ${shots.length} shot(s) using the ${profileId} profile?`,
    );
  }

  async function onRenderImages() {
    if (!confirmPaidLaunch("image")) return;
    setPhase("rendering-images");
    setMessage("Signing and submitting the immutable image contract…");
    try {
      const launch = await callRenderApi("image");
      setMessage(`Image job ${launch.jobId} accepted; waiting for verified outputs…`);
      const status = await pollRender(launch);
      const stillKeys = status.stillKeys ?? [];
      const withStills = shots.map((shot) => {
        const stillKey = stillKeys.find((key) => key.endsWith(`/${shot.id}-c01.png`));
        if (!stillKey) throw new Error(`image render did not return a primary still for ${shot.id}`);
        return { ...shot, stillKey };
      });
      setShots(withStills);
      setMessage(`${status.n_outputs} verified still(s) rendered. Primary stills are ready for video.`);
      setPhase("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }

  async function onRenderVideo() {
    if (!confirmPaidLaunch("video")) return;
    setPhase("rendering-video");
    setMessage("Signing and submitting the immutable image-to-video contract…");
    try {
      const launch = await callRenderApi("video");
      setMessage(`Video job ${launch.jobId} accepted; waiting for verified outputs…`);
      const status = await pollRender(launch);
      const footageKeys = status.footageKeys ?? [];
      if (footageKeys.length !== shots.length) {
        throw new Error(`video render returned ${footageKeys.length}/${shots.length} clips`);
      }
      setMessage(`${footageKeys.length} verified clip(s) rendered and stored.`);
      setPhase("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }

  const busy = phase === "rendering-images" || phase === "rendering-video";

  return (
    <>
      <PageHeader
        title="Novita Render Farm"
        subtitle="Operator console for signed, pinned-profile image and image-to-video jobs on the three-slot Novita spot fleet."
      />

      <SectionTitle>Shot list</SectionTitle>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        {shots.map((shot, index) => (
          <div key={shot.id} style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.35rem" }}>
              <span style={LABEL}>Shot {index + 1} · {shot.id}</span>
              <button type="button" onClick={() => removeShot(shot.id)} disabled={shots.length <= 1} style={SMALL_BTN}>Remove</button>
            </div>
            <textarea
              placeholder="Script line / image prompt for this shot"
              value={shot.prompt}
              onChange={(event) => updateShot(shot.id, { prompt: event.target.value })}
              rows={2}
              style={TEXTAREA}
            />
            <div style={ROW}>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Camera move</span>
                <select value={shot.cameraMove} onChange={(event) => updateShot(shot.id, { cameraMove: event.target.value as CameraMove })} style={SELECT}>
                  {CAMERA_MOVES.map((cameraMove) => <option key={cameraMove} value={cameraMove}>{cameraMove}</option>)}
                </select>
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Shot scale</span>
                <select value={shot.shotScale} onChange={(event) => updateShot(shot.id, { shotScale: event.target.value as ShotScale })} style={SELECT}>
                  {SHOT_SCALES.map((shotScale) => <option key={shotScale} value={shotScale}>{shotScale}</option>)}
                </select>
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Lens</span>
                <input type="text" value={shot.lens} onChange={(event) => updateShot(shot.id, { lens: event.target.value })} style={INPUT} />
              </label>
              <label style={FIELD}>
                <span style={FIELD_LABEL}>Seconds</span>
                <input type="number" min={1} max={30} value={shot.seconds} onChange={(event) => updateShot(shot.id, { seconds: Number(event.target.value) })} style={INPUT} />
              </label>
            </div>
            <label style={{ ...FIELD, marginTop: "0.4rem" }}>
              <span style={FIELD_LABEL}>Motion cue (subject or environment movement)</span>
              <input type="text" value={shot.motion} onChange={(event) => updateShot(shot.id, { motion: event.target.value })} style={INPUT} placeholder="e.g. sparks fly from the anvil, cloak billows" />
            </label>
            {shot.cameraMove === "static" && !shot.motion.trim() && (
              <span style={WARN}>Add a camera move or a motion cue before rendering video.</span>
            )}
            {shot.stillKey && <span style={READY}>Verified primary still ready</span>}
          </div>
        ))}
        <button type="button" onClick={addShot} disabled={busy} style={SECONDARY_BTN}>+ Add shot</button>
      </div>

      <div style={{ height: "1.4rem" }} />
      <SectionTitle>Global controls</SectionTitle>
      <div style={GRID}>
        <div style={CARD}>
          <span style={LABEL}>Style</span>
          <textarea value={style} onChange={(event) => updateImageGlobal(setStyle, event.target.value)} rows={2} style={TEXTAREA} placeholder="Global style suffix appended to every shot prompt" />
        </div>
        <div style={CARD}>
          <span style={LABEL}>Negative (global)</span>
          <textarea value={negative} onChange={(event) => updateImageGlobal(setNegative, event.target.value)} rows={2} style={TEXTAREA} />
        </div>
        <div style={CARD}>
          <span style={LABEL}>Director notes</span>
          <textarea value={director} onChange={(event) => updateImageGlobal(setDirector, event.target.value)} rows={2} style={TEXTAREA} placeholder="Global creative direction appended to every shot" />
        </div>
      </div>

      <div style={{ height: "1.4rem" }} />
      <SectionTitle>Immutable generation profile</SectionTitle>
      <div style={ROW}>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Approved profile</span>
          <select value={profileId} onChange={(event) => updateProfile(event.target.value as ProfileId)} style={SELECT} disabled={busy}>
            <option value="draft">Draft</option>
            <option value="production">Production</option>
            <option value="hero">Hero</option>
          </select>
        </label>
        <label style={FIELD}>
          <span style={FIELD_LABEL}>Shard count (fleet cap 3)</span>
          <input type="number" min={1} max={3} value={nshard} onChange={(event) => setNshard(Number(event.target.value))} style={INPUT} disabled={busy} />
        </label>
      </div>
      <div style={{ ...GRID, marginTop: "0.65rem" }}>
        <div style={CARD}>
          <span style={LABEL}>Image · Z-Image Turbo</span>
          <span style={SPEC}>{profile.image.width}×{profile.image.height} · {profile.image.steps} steps · {profile.image.precision.toUpperCase()} · {profile.image.candidates} candidate(s)</span>
          <span style={FAINT}>Pinned revision · fallback disabled</span>
        </div>
        <div style={CARD}>
          <span style={LABEL}>Video · LTX-2.3</span>
          <span style={SPEC}>{profile.video.width}×{profile.video.height} · {profile.video.fps} fps · {profile.video.steps} steps · {profile.video.precision.toUpperCase()}</span>
          <span style={FAINT}>Shot seconds compile to valid 8n+1 frames · fallback disabled</span>
        </div>
      </div>
      {!nshardValid && <span style={WARN}>Shard count must be between 1 and 3.</span>}
      {!promptsValid && <span style={WARN}>Every shot needs a prompt before image rendering.</span>}

      <div style={{ height: "1.4rem" }} />
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onRenderImages} disabled={busy || !nshardValid || !promptsValid} style={PRIMARY_BTN}>
          {phase === "rendering-images" ? "Rendering images…" : "Launch Image Render"}
        </button>
        <button type="button" onClick={onRenderVideo} disabled={busy || !nshardValid || !promptsValid || !motionValid || !stillsReady} style={PRIMARY_BTN}>
          {phase === "rendering-video" ? "Rendering video…" : "Launch Video Render"}
        </button>
        {message && <span style={{ fontSize: "0.82rem", color: phase === "error" ? "#e5484d" : "var(--color-muted)" }}>{message}</span>}
      </div>
      <span style={FAINT}>Each launch requires confirmation because it starts paid spot-GPU work.</span>
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
const READY: CSSProperties = { fontSize: "0.72rem", color: "#30a46c", display: "block", marginTop: "0.2rem" };
const SPEC: CSSProperties = { fontSize: "0.82rem", color: "var(--color-fg)" };
const FAINT: CSSProperties = { fontSize: "0.7rem", color: "var(--color-faint)", display: "block", marginTop: "0.2rem" };
const PRIMARY_BTN: CSSProperties = { padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", background: "var(--color-accent-soft)", color: "var(--color-fg)", font: "inherit", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" };
const SECONDARY_BTN: CSSProperties = { padding: "0.45rem 0.9rem", borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-muted)", font: "inherit", fontSize: "0.8rem", cursor: "pointer", justifySelf: "start" };
const SMALL_BTN: CSSProperties = { padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-faint)", font: "inherit", fontSize: "0.7rem", cursor: "pointer" };
