"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GENERATION_PROFILES, type GenerationProfile } from "@/engine/generationProfiles";
import {
  assessNovitaVideoProfileRuntime,
  novitaVideoProfileIdentity,
} from "@/engine/runtimeCapability";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { OwnerOnlyNotice } from "@/components/OwnerOnlyNotice";
import { useOperationsAccess } from "@/components/OperationsAccess";
import {
  NOVITA_RENDER_STATUS_TIMEOUT_MS,
  clearPersistedNovitaRenderJob,
  loadPersistedNovitaRenderJob,
  novitaRenderPollDelayMs,
  persistNovitaRenderJob,
  type PersistedNovitaRenderJob,
} from "@/lib/novitaRenderPolling";

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

interface NovitaFleetHealth {
  ok: boolean;
  ready: boolean;
  checkedAt: string | null;
  architecturalGpuCeiling: number;
  verifiedGpuQuota: number | null;
  effectiveGpuLimit: number | null;
  activeGpuCount: number | null;
  blockers: string[];
  attestation: {
    /** Only Trigger may set this to direct-trigger after a direct-controller check. */
    source: "direct-trigger" | "studio-static" | "unavailable";
    profileIdentity: string | null;
    exactLtx25Rtx4090X2: boolean;
  };
  contract: {
    version: string;
    dispatchReady: boolean;
    workerImageReady: boolean;
  } | null;
  models: {
    gemma: { name: string; localCacheVerified: boolean };
    zImage: { name: string; localCacheVerified: boolean };
    ltx: {
      name: string;
      localCacheVerified: boolean;
      distilledTwoStageX2Verified: boolean;
      rtx4090ProfileBenchmarked: boolean;
    };
  } | null;
  storage: {
    persistentModelVolumeVerified: boolean;
    volumeSizeGb: number;
  } | null;
  controls: {
    capacityAwareWaves: boolean;
    r2CheckpointRecovery: boolean;
    idleShutdownSeconds: number;
    verifiedReaper: boolean;
    statusBatchSeconds: number;
  } | null;
}

const UNAVAILABLE_FLEET_HEALTH: NovitaFleetHealth = {
  ok: false,
  ready: false,
  checkedAt: null,
  architecturalGpuCeiling: 8,
  verifiedGpuQuota: null,
  effectiveGpuLimit: null,
  activeGpuCount: null,
  blockers: ["fleet_readiness_unavailable"],
  attestation: {
    source: "unavailable",
    profileIdentity: null,
    exactLtx25Rtx4090X2: false,
  },
  contract: null,
  models: null,
  storage: null,
  controls: null,
};

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

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitUntilVisible(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  if (document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve, reject) => {
    function cleanup() {
      document.removeEventListener("visibilitychange", visible);
      signal.removeEventListener("abort", abort);
    }
    function visible() {
      if (document.visibilityState === "hidden") return;
      cleanup();
      resolve();
    }
    function abort() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }
    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function isFleetHealth(value: unknown): value is NovitaFleetHealth {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<NovitaFleetHealth>;
  const attestation = health.attestation as Partial<NovitaFleetHealth["attestation"]> | undefined;
  return (
    typeof health.ok === "boolean" &&
    typeof health.ready === "boolean" &&
    Number.isInteger(health.architecturalGpuCeiling) &&
    (health.verifiedGpuQuota === null || Number.isInteger(health.verifiedGpuQuota)) &&
    (health.effectiveGpuLimit === null || Number.isInteger(health.effectiveGpuLimit)) &&
    (health.activeGpuCount === null || Number.isInteger(health.activeGpuCount)) &&
    Array.isArray(health.blockers) &&
    health.blockers.every((blocker) => typeof blocker === "string") &&
    (attestation?.source === "direct-trigger" || attestation?.source === "studio-static" || attestation?.source === "unavailable") &&
    (attestation?.profileIdentity === null || typeof attestation?.profileIdentity === "string") &&
    typeof attestation?.exactLtx25Rtx4090X2 === "boolean"
  );
}

/**
 * A generic `ready` bit is never sufficient for an LTX claim. It must be the
 * direct Trigger attestation for this exact pinned x2 profile, including its
 * 4090 benchmark proof. Static Studio metadata deliberately fails this gate.
 */
function hasExactLtx25X2Attestation(
  health: NovitaFleetHealth | null,
  profile: GenerationProfile,
): boolean {
  // The browser must not promote a remote health boolean into production
  // admission. The same local, digest/profile allow-list used by the worker
  // launcher has to admit this profile too; it intentionally remains false
  // until a real benchmark seal is recorded.
  if (!assessNovitaVideoProfileRuntime(profile).ready) return false;
  const ltx = health?.models?.ltx;
  return health?.ready === true
    && health.attestation.source === "direct-trigger"
    && health.attestation.profileIdentity === novitaVideoProfileIdentity(profile)
    && health.attestation.exactLtx25Rtx4090X2 === true
    && ltx?.distilledTwoStageX2Verified === true
    && ltx.rtx4090ProfileBenchmarked === true;
}

export default function NovitaRenderPage() {
  const operationsAccess = useOperationsAccess();
  const [shots, setShots] = useState<ShotRow[]>([newShot(1)]);
  const [style, setStyle] = useState("");
  const [negative, setNegative] = useState("blurry, low quality, watermark, text, deformed");
  const [director, setDirector] = useState("");
  const [profileId, setProfileId] = useState<ProfileId>("production");
  const [nshard, setNshard] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [fleetHealth, setFleetHealth] = useState<NovitaFleetHealth | null>(null);
  const [recoverableJob, setRecoverableJob] = useState<PersistedNovitaRenderJob | null>(null);
  const activePoll = useRef<AbortController | null>(null);
  const profile = GENERATION_PROFILES[profileId];
  const exactLtx25X2Ready = hasExactLtx25X2Attestation(fleetHealth, profile);
  const attestedFleetHealth = exactLtx25X2Ready ? fleetHealth : null;

  useEffect(() => {
    if (operationsAccess !== "owner") return;
    const restoreTimer = window.setTimeout(() => {
      try {
        setRecoverableJob(loadPersistedNovitaRenderJob(window.localStorage));
      } catch {
        setRecoverableJob(null);
      }
    }, 0);
    return () => {
      window.clearTimeout(restoreTimer);
      activePoll.current?.abort();
    };
  }, [operationsAccess]);

  useEffect(() => {
    if (operationsAccess !== "owner") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/novita-render?health=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!controller.signal.aborted) {
          setFleetHealth(isFleetHealth(payload) ? payload : UNAVAILABLE_FLEET_HEALTH);
        }
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setFleetHealth(UNAVAILABLE_FLEET_HEALTH);
        }
      }
    })();
    return () => controller.abort();
  }, [operationsAccess]);

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

  async function pollRender(
    launch: RenderLaunch,
    startedAt: number,
  ): Promise<RenderStatus> {
    activePoll.current?.abort();
    const controller = new AbortController();
    activePoll.current = controller;
    let priorProgress = "";
    let unchangedPolls = 0;
    try {
      for (;;) {
        if (document.visibilityState === "hidden") {
          setMessage(`Tracking ${launch.phase} job ${launch.jobId} is paused while this tab is hidden…`);
          await waitUntilVisible(controller.signal);
        }
        const response = await fetch(
          `/api/novita-render?jobId=${encodeURIComponent(launch.jobId)}&profileId=${encodeURIComponent(launch.profileId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const status = await response.json().catch(() => null) as (RenderStatus & { error?: string }) | null;
        if (response.status === 401 || response.status === 403) {
          throw new Error("Operator access expired. Unlock Ops, then resume this saved render status check.");
        }
        if (!response.ok || !status) {
          throw new Error(status?.error ?? `render status failed with HTTP ${response.status}`);
        }
        if (status.jobId !== launch.jobId || status.phase !== launch.phase) {
          throw new Error("render bridge returned a mismatched job identity");
        }
        if (status.status === "failed") {
          finishTracking();
          throw new Error(status.error ?? `${status.phase} render failed`);
        }
        if (status.status === "done") return status;
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > NOVITA_RENDER_STATUS_TIMEOUT_MS) {
          throw new Error(`${status.phase} render is still active after 24 hours; status tracking remains saved for a later retry`);
        }
        const progress = `${status.status}:${status.n_outputs}:${status.n_jobs}`;
        unchangedPolls = progress === priorProgress ? unchangedPolls + 1 : 0;
        priorProgress = progress;
        const delayMs = novitaRenderPollDelayMs({
          statusBatchSeconds: fleetHealth?.controls?.statusBatchSeconds,
          elapsedMs,
          unchangedPolls,
        });
        setMessage(
          `${status.phase} job ${status.jobId} is ${status.status} (${status.n_outputs}/${status.n_jobs}); checking again in ${Math.round(delayMs / 1_000)}s…`,
        );
        await abortableSleep(delayMs, controller.signal);
      }
    } finally {
      if (activePoll.current === controller) activePoll.current = null;
    }
  }

  function rememberLaunch(launch: RenderLaunch, startedAt: number): boolean {
    const handle: PersistedNovitaRenderJob = {
      version: 1,
      jobId: launch.jobId,
      phase: launch.phase,
      profileId: launch.profileId,
      startedAt,
    };
    setRecoverableJob(handle);
    try {
      persistNovitaRenderJob(window.localStorage, handle);
      return true;
    } catch {
      return false;
    }
  }

  function finishTracking() {
    try {
      clearPersistedNovitaRenderJob(window.localStorage);
    } catch {
      // The remote job is already terminal; storage denial must not trap UI.
    }
    setRecoverableJob(null);
  }

  function applyCompletedStatus(status: RenderStatus) {
    if (status.phase === "image") {
      const stillKeys = status.stillKeys ?? [];
      setShots((rows) => rows.map((shot) => {
        const stillKey = stillKeys.find((key) => key.endsWith(`/${shot.id}-c01.png`));
        return stillKey ? { ...shot, stillKey } : shot;
      }));
      setMessage(`${status.n_outputs} verified still(s) rendered and stored. Matching visible shots are ready for video.`);
    } else {
      const footageKeys = status.footageKeys ?? [];
      setMessage(`${footageKeys.length} verified clip(s) rendered and stored.`);
    }
    finishTracking();
    setPhase("done");
  }

  async function onResumeTracking() {
    if (!recoverableJob) return;
    setProfileId(recoverableJob.profileId);
    setPhase(recoverableJob.phase === "image" ? "rendering-images" : "rendering-video");
    setMessage(`Resuming authenticated status tracking for ${recoverableJob.jobId}…`);
    try {
      const status = await pollRender(
        { ok: true, status: "queued", ...recoverableJob },
        recoverableJob.startedAt,
      );
      applyCompletedStatus(status);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
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
      const startedAt = Date.now();
      const recoverySaved = rememberLaunch(launch, startedAt);
      setMessage(
        recoverySaved
          ? `Image job ${launch.jobId} accepted; waiting for verified outputs…`
          : `Image job ${launch.jobId} accepted, but browser recovery storage is unavailable; keep this tab open…`,
      );
      const status = await pollRender(launch, startedAt);
      const stillKeys = status.stillKeys ?? [];
      const withStills = shots.map((shot) => {
        const stillKey = stillKeys.find((key) => key.endsWith(`/${shot.id}-c01.png`));
        if (!stillKey) throw new Error(`image render did not return a primary still for ${shot.id}`);
        return { ...shot, stillKey };
      });
      setShots(withStills);
      setMessage(`${status.n_outputs} verified still(s) rendered. Primary stills are ready for video.`);
      finishTracking();
      setPhase("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
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
      const startedAt = Date.now();
      const recoverySaved = rememberLaunch(launch, startedAt);
      setMessage(
        recoverySaved
          ? `Video job ${launch.jobId} accepted; waiting for verified outputs…`
          : `Video job ${launch.jobId} accepted, but browser recovery storage is unavailable; keep this tab open…`,
      );
      const status = await pollRender(launch, startedAt);
      const footageKeys = status.footageKeys ?? [];
      if (footageKeys.length !== shots.length) {
        throw new Error(`video render returned ${footageKeys.length}/${shots.length} clips`);
      }
      setMessage(`${footageKeys.length} verified clip(s) rendered and stored.`);
      finishTracking();
      setPhase("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }

  const busy = phase === "rendering-images" || phase === "rendering-video";
  const launchBlocked = busy || recoverableJob !== null || !exactLtx25X2Ready;

  if (operationsAccess !== "owner") {
    return (
      <>
        <PageHeader
          title="Novita Render Farm"
          subtitle="Signed, pinned-profile jobs on the capacity-aware Novita spot fleet."
        />
        <OwnerOnlyNotice
          access={operationsAccess}
          desk="the Novita render console"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Novita Render Farm"
        subtitle="Operator console for signed, pinned-profile image and image-to-video jobs on the capacity-aware Novita spot fleet."
      />

      <section aria-label="Novita render admission readiness" style={{ ...CARD, marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={LABEL}>Render admission readiness</span>
          <span
            aria-live="polite"
            style={{
              fontSize: "0.74rem",
              fontWeight: 700,
              color: fleetHealth === null ? "var(--color-muted)" : exactLtx25X2Ready ? "#30a46c" : "#e5484d",
            }}
          >
            {fleetHealth === null ? "Checking admission…" : exactLtx25X2Ready ? "Ready" : "Not attested"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: "0.5rem" }}>
          <div style={FLEET_STAT}>
            <span style={FIELD_LABEL}>Architecture ceiling</span>
            <strong>{fleetHealth?.architecturalGpuCeiling ?? 8} GPUs</strong>
            <span style={FAINT}>Orchestration design limit</span>
          </div>
          <div style={FLEET_STAT}>
            <span style={FIELD_LABEL}>Verified provider quota</span>
            <strong>{fleetHealth?.verifiedGpuQuota == null ? "—" : `${fleetHealth.verifiedGpuQuota} GPUs`}</strong>
            <span style={FAINT}>Direct Trigger attestation</span>
          </div>
          <div style={FLEET_STAT}>
            <span style={FIELD_LABEL}>Available now</span>
            <strong>{fleetHealth?.effectiveGpuLimit == null ? "—" : `${fleetHealth.effectiveGpuLimit} GPUs`}</strong>
            <span style={FAINT}>
              {fleetHealth?.activeGpuCount == null ? "Current quota unavailable" : `${fleetHealth.activeGpuCount} active`}
            </span>
          </div>
        </div>
        {attestedFleetHealth ? (
          <div style={{ display: "grid", gap: "0.25rem", fontSize: "0.72rem", color: "var(--color-muted)" }}>
            <span>
              Contract {attestedFleetHealth.contract?.version ?? "unverified"} · dispatch {attestedFleetHealth.contract?.dispatchReady ? "ready" : "blocked"} · worker image {attestedFleetHealth.contract?.workerImageReady ? "prewarmed" : "unverified"}
            </span>
            <span>
              Models · Gemma {attestedFleetHealth.models?.gemma.localCacheVerified ? "cached" : "unverified"} · Z-Image {attestedFleetHealth.models?.zImage.localCacheVerified ? "cached" : "unverified"} · LTX {attestedFleetHealth.models?.ltx.distilledTwoStageX2Verified && attestedFleetHealth.models?.ltx.rtx4090ProfileBenchmarked ? "2.5 x2 benchmarked" : "2.5 x2 unverified"}
            </span>
            <span>
              Storage · {attestedFleetHealth.storage?.persistentModelVolumeVerified ? `${attestedFleetHealth.storage.volumeSizeGb} GB persistent model disk verified` : "unverified"}
            </span>
            <span>
              Controls · {attestedFleetHealth.controls?.capacityAwareWaves ? "capacity-aware waves" : "waves unverified"} · {attestedFleetHealth.controls?.r2CheckpointRecovery ? "R2 recovery" : "recovery unverified"} · {attestedFleetHealth.controls?.verifiedReaper ? "verified reaper" : "reaper unverified"} · {attestedFleetHealth.controls?.idleShutdownSeconds ?? "—"}s idle shutdown
            </span>
          </div>
        ) : (
          <span style={fleetHealth === null ? FAINT : WARN}>
            {fleetHealth === null
              ? "Reading direct render admission…"
              : fleetHealth.attestation.source === "studio-static"
                ? "Studio has no direct provider attestation. Trigger must verify this exact LTX 2.5 RTX 4090 x2 profile before paid work."
                : "Direct capacity could not be verified. Render admission remains server-gated."}
          </span>
        )}
        {fleetHealth && fleetHealth.blockers.length > 0 && (
          <span style={FAINT}>Blockers · {fleetHealth.blockers.map((blocker) => blocker.replaceAll("_", " ")).join(" · ")}</span>
        )}
      </section>

      {recoverableJob && (
        <section aria-label="Saved Novita render status" style={{ ...CARD, marginBottom: "1rem" }}>
          <span style={LABEL}>Saved render status</span>
          <strong style={{ fontSize: "0.84rem" }}>{recoverableJob.jobId}</strong>
          <span style={FAINT}>
            {recoverableJob.phase} · {recoverableJob.profileId} · started {new Date(recoverableJob.startedAt).toLocaleString()}
          </span>
          <span style={FAINT}>Only the sanitized job identity is stored. Every status request reauthorizes through Ops.</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" style={PRIMARY_BTN} onClick={() => void onResumeTracking()} disabled={busy}>
              {busy ? "Checking…" : "Resume status"}
            </button>
            <button
              type="button"
              style={SECONDARY_BTN}
              disabled={busy}
              onClick={() => {
                finishTracking();
                setPhase("idle");
                setMessage("Saved status tracking dismissed. This does not cancel the remote job.");
              }}
            >
              Dismiss tracking
            </button>
          </div>
        </section>
      )}

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
          <span style={FIELD_LABEL}>Shard count (manual console cap 3)</span>
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
          <span style={LABEL}>Video · LTX-2.5 distilled x2</span>
          <span style={SPEC}>{profile.video.width}×{profile.video.height} · {profile.video.fps} fps · {profile.video.steps} steps · {profile.video.precision.toUpperCase()}</span>
          <span style={FAINT}>{profile.video.stageOneWidth}×{profile.video.stageOneHeight} → 2× latent upscale · FP8-cast + CPU offload · fallback disabled</span>
        </div>
      </div>
      {!nshardValid && <span style={WARN}>Shard count must be between 1 and 3.</span>}
      {!promptsValid && <span style={WARN}>Every shot needs a prompt before image rendering.</span>}

      <div style={{ height: "1.4rem" }} />
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onRenderImages} disabled={launchBlocked || !nshardValid || !promptsValid} style={PRIMARY_BTN}>
          {phase === "rendering-images" ? "Rendering images…" : "Launch Image Render"}
        </button>
        <button type="button" onClick={onRenderVideo} disabled={launchBlocked || !nshardValid || !promptsValid || !motionValid || !stillsReady} style={PRIMARY_BTN}>
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
const FLEET_STAT: CSSProperties = { display: "grid", gap: "0.18rem", padding: "0.55rem 0.65rem", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-bg)" };
const PRIMARY_BTN: CSSProperties = { padding: "0.55rem 1.1rem", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)", background: "var(--color-accent-soft)", color: "var(--color-fg)", font: "inherit", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" };
const SECONDARY_BTN: CSSProperties = { padding: "0.45rem 0.9rem", borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-muted)", font: "inherit", fontSize: "0.8rem", cursor: "pointer", justifySelf: "start" };
const SMALL_BTN: CSSProperties = { padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-faint)", font: "inherit", fontSize: "0.7rem", cursor: "pointer" };
