"use client";

import { useEffect, useRef, useState } from "react";
import { GENERATION_PROFILES, type GenerationProfile } from "@/engine/generationProfiles";
import {
  assessNovitaVideoProfileRuntime,
  novitaVideoProfileIdentity,
} from "@/engine/runtimeCapability";
import { useOperationsAccess } from "@/components/OperationsAccess";
import {
  NOVITA_RENDER_STATUS_TIMEOUT_MS,
  clearPersistedNovitaRenderJob,
  loadPersistedNovitaRenderJob,
  novitaRenderPollDelayMs,
  persistNovitaRenderJob,
  type PersistedNovitaRenderJob,
} from "@/lib/novitaRenderPolling";
import styles from "./novita-render.module.css";

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

type LiveRenderProgress = {
  phase: "image" | "video";
  status: RenderStatus["status"];
  outputs: number;
  total: number;
  jobId: string;
};

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
  const [renderProgress, setRenderProgress] = useState<LiveRenderProgress | null>(null);
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
        setRenderProgress({
          phase: status.phase,
          status: status.status,
          outputs: status.n_outputs,
          total: status.n_jobs,
          jobId: status.jobId,
        });
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
    setRenderProgress({
      phase: status.phase,
      status: "done",
      outputs: status.n_outputs,
      total: status.n_jobs,
      jobId: status.jobId,
    });
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
    setRenderProgress({
      phase: recoverableJob.phase,
      status: "queued",
      outputs: 0,
      total: shots.length,
      jobId: recoverableJob.jobId,
    });
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
      setRenderProgress((current) => current ? { ...current, status: "failed" } : current);
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
      setRenderProgress({ phase: "image", status: "queued", outputs: 0, total: shots.length, jobId: launch.jobId });
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
      setRenderProgress({ phase: "image", status: "done", outputs: status.n_outputs, total: status.n_jobs, jobId: status.jobId });
      finishTracking();
      setPhase("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : String(error));
      setRenderProgress((current) => current ? { ...current, status: "failed" } : current);
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
      setRenderProgress({ phase: "video", status: "queued", outputs: 0, total: shots.length, jobId: launch.jobId });
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
      setRenderProgress({ phase: "video", status: "done", outputs: status.n_outputs, total: status.n_jobs, jobId: status.jobId });
      finishTracking();
      setPhase("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : String(error));
      setRenderProgress((current) => current ? { ...current, status: "failed" } : current);
      setPhase("error");
    }
  }

  const busy = phase === "rendering-images" || phase === "rendering-video";
  const launchBlocked = busy || recoverableJob !== null || !exactLtx25X2Ready;

  if (operationsAccess !== "owner") {
    return (
      <main className={styles.page}>
        <RenderFleetHero
          access={operationsAccess}
          fleetHealth={null}
          ready={false}
          shotCount={0}
          profileId="production"
        />
        <LockedRenderConsole access={operationsAccess} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <RenderFleetHero
        access={operationsAccess}
        fleetHealth={fleetHealth}
        ready={exactLtx25X2Ready}
        shotCount={shots.length}
        profileId={profileId}
      />

      <section aria-label="Novita render admission readiness" className={styles.readiness}>
        <div className={styles.readinessHeader}>
          <div>
            <span className={styles.eyebrow}>Admission circuit · exact profile only</span>
            <h2>Render admission readiness</h2>
            <p>Paid work requires verified runtime, model, storage, and shutdown.</p>
          </div>
          <span
            aria-live="polite"
            className={styles.readinessState}
            data-state={fleetHealth === null ? "checking" : exactLtx25X2Ready ? "ready" : "blocked"}
          >
            {fleetHealth === null ? "Checking admission…" : exactLtx25X2Ready ? "Ready" : "Not attested"}
          </span>
        </div>
        <div className={styles.fleetStats}>
          <div>
            <span>Architecture ceiling</span>
            <strong>{fleetHealth?.architecturalGpuCeiling ?? 8} GPUs</strong>
            <small>Orchestration design limit</small>
          </div>
          <div>
            <span>Verified provider quota</span>
            <strong>{fleetHealth?.verifiedGpuQuota == null ? "—" : `${fleetHealth.verifiedGpuQuota} GPUs`}</strong>
            <small>Direct Trigger attestation</small>
          </div>
          <div>
            <span>Available now</span>
            <strong>{fleetHealth?.effectiveGpuLimit == null ? "—" : `${fleetHealth.effectiveGpuLimit} GPUs`}</strong>
            <small>
              {fleetHealth?.activeGpuCount == null ? "Current quota unavailable" : `${fleetHealth.activeGpuCount} active`}
            </small>
          </div>
        </div>
        <AdmissionTrace health={attestedFleetHealth} />
        {attestedFleetHealth ? (
          <div className={styles.attestationLedger}>
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
          <span className={styles.admissionNote} data-warning={fleetHealth !== null}>
            {fleetHealth === null
              ? "Reading direct render admission…"
              : fleetHealth.attestation.source === "studio-static"
                ? "Studio has no direct provider attestation. Trigger must verify this exact LTX 2.5 RTX 4090 x2 profile before paid work."
                : "Direct capacity could not be verified. Render admission remains server-gated."}
          </span>
        )}
        {fleetHealth && fleetHealth.blockers.length > 0 && (
          <span className={styles.blockers}>Blockers · {fleetHealth.blockers.map((blocker) => blocker.replaceAll("_", " ")).join(" · ")}</span>
        )}
      </section>

      {recoverableJob && (
        <section aria-label="Saved Novita render status" className={styles.savedJob}>
          <span className={styles.savedMark} aria-hidden="true">↻</span>
          <div>
            <span className={styles.eyebrow}>Saved render status</span>
            <strong>{recoverableJob.jobId}</strong>
            <small>{recoverableJob.phase} · {recoverableJob.profileId} · started {new Date(recoverableJob.startedAt).toLocaleString()}</small>
            <p>Only the sanitized job identity is stored. Every status request reauthorizes through Ops.</p>
          </div>
          <div className={styles.savedActions}>
            <button type="button" className={styles.primaryButton} onClick={() => void onResumeTracking()} disabled={busy}>
              {busy ? "Checking…" : "Resume status"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => {
                finishTracking();
                setPhase("idle");
                setRenderProgress(null);
                setMessage("Saved status tracking dismissed. This does not cancel the remote job.");
              }}
            >
              Dismiss tracking
            </button>
          </div>
        </section>
      )}

      <RenderProgressTheatre
        progress={renderProgress}
        phase={phase}
        message={message}
        shots={shots}
      />

      <section className={styles.workstation} aria-label="Render contract workstation">
        <div className={styles.shotDesk}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Storyboard contract</span><h2>Shot sequence</h2></div>
            <p>Each row creates one image and one verified video clip.</p>
          </div>
          <div className={styles.shotList}>
            {shots.map((shot, index) => (
              <article key={shot.id} className={styles.shotCard} data-ready={Boolean(shot.stillKey)}>
                <header>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><small>Sequence frame</small><strong>{shot.id}</strong></div>
                  <span className={styles.shotState}>{shot.stillKey ? "STILL SEALED" : "UNRENDERED"}</span>
                  <button type="button" onClick={() => removeShot(shot.id)} disabled={shots.length <= 1}>Remove</button>
                </header>
                <label className={styles.promptField}>
                  <span>Script line / image prompt</span>
                  <textarea
                    placeholder="Describe the exact visible shot—subject, action, setting, light, and composition"
                    value={shot.prompt}
                    onChange={(event) => updateShot(shot.id, { prompt: event.target.value })}
                    rows={3}
                  />
                </label>
                <div className={styles.shotControls}>
                  <label><span>Camera move</span><select value={shot.cameraMove} onChange={(event) => updateShot(shot.id, { cameraMove: event.target.value as CameraMove })}>{CAMERA_MOVES.map((cameraMove) => <option key={cameraMove} value={cameraMove}>{cameraMove}</option>)}</select></label>
                  <label><span>Shot scale</span><select value={shot.shotScale} onChange={(event) => updateShot(shot.id, { shotScale: event.target.value as ShotScale })}>{SHOT_SCALES.map((shotScale) => <option key={shotScale} value={shotScale}>{shotScale}</option>)}</select></label>
                  <label><span>Lens</span><input type="text" value={shot.lens} onChange={(event) => updateShot(shot.id, { lens: event.target.value })} /></label>
                  <label><span>Seconds</span><input type="number" min={1} max={30} value={shot.seconds} onChange={(event) => updateShot(shot.id, { seconds: Number(event.target.value) })} /></label>
                </div>
                <label className={styles.motionField}>
                  <span>Motion cue · subject or environment movement</span>
                  <input type="text" value={shot.motion} onChange={(event) => updateShot(shot.id, { motion: event.target.value })} placeholder="e.g. sparks fly from the anvil, cloak billows" />
                </label>
                {shot.cameraMove === "static" && !shot.motion.trim() && <span className={styles.warning}>Add a camera move or a motion cue before rendering video.</span>}
                {shot.stillKey && <span className={styles.ready}>Verified primary still ready</span>}
              </article>
            ))}
          </div>
          <button type="button" onClick={addShot} disabled={busy} className={styles.addShot}>+ Add another shot</button>
        </div>

        <aside className={styles.contractDesk}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Pinned controls</span><h2>Render contract</h2></div>
          </div>
          <div className={styles.directionFields}>
            <label><span>Global style</span><textarea value={style} onChange={(event) => updateImageGlobal(setStyle, event.target.value)} rows={3} placeholder="Visual language appended to every shot" /></label>
            <label><span>Negative (global)</span><textarea value={negative} onChange={(event) => updateImageGlobal(setNegative, event.target.value)} rows={3} /></label>
            <label><span>Director notes</span><textarea value={director} onChange={(event) => updateImageGlobal(setDirector, event.target.value)} rows={3} placeholder="Creative direction appended to every shot" /></label>
          </div>
          <div className={styles.profileFields}>
            <label><span>Approved profile</span><select value={profileId} onChange={(event) => updateProfile(event.target.value as ProfileId)} disabled={busy}><option value="draft">Draft</option><option value="production">Production</option><option value="hero">Hero</option></select></label>
            <label><span>Shard count (manual console cap 3)</span><input type="number" min={1} max={3} value={nshard} onChange={(event) => setNshard(Number(event.target.value))} disabled={busy} /></label>
          </div>
          <div className={styles.profileCards}>
            <article><span>Image · Z-Image Turbo</span><strong>{profile.image.width}×{profile.image.height}</strong><p>{profile.image.steps} steps · {profile.image.precision.toUpperCase()} · {profile.image.candidates} candidate(s)</p><small>Pinned revision · fallback disabled</small></article>
            <article><span>Video · LTX-2.5 distilled x2</span><strong>{profile.video.width}×{profile.video.height} · {profile.video.fps} fps</strong><p>{profile.video.steps} steps · {profile.video.precision.toUpperCase()}</p><small>{profile.video.stageOneWidth}×{profile.video.stageOneHeight} → 2× latent upscale · FP8-cast + CPU offload · fallback disabled</small></article>
          </div>
          {!nshardValid && <span className={styles.warning}>Shard count must be between 1 and 3.</span>}
          {!promptsValid && <span className={styles.warning}>Every shot needs a prompt before image rendering.</span>}
        </aside>
      </section>

      <section className={styles.launchDock} aria-label="Paid render launch controls">
        <div className={styles.launchChecks}>
          <LaunchCheck label="Fleet attested" ready={exactLtx25X2Ready} />
          <LaunchCheck label="Prompts complete" ready={promptsValid} />
          <LaunchCheck label="Motion declared" ready={motionValid} />
          <LaunchCheck label="Primary stills" ready={stillsReady} />
        </div>
        <div className={styles.launchCopy}>
          <span className={styles.eyebrow}>Explicit paid boundary</span>
          <strong>Nothing launches without your confirmation.</strong>
          <small>Each action starts paid Novita spot-GPU work. A confirmation names the phase, shot count, and pinned profile first.</small>
        </div>
        <div className={styles.launchActions}>
          <button type="button" onClick={onRenderImages} disabled={launchBlocked || !nshardValid || !promptsValid} className={styles.primaryButton}>
            {phase === "rendering-images" ? "Rendering images…" : "Launch Image Render"}
          </button>
          <button type="button" onClick={onRenderVideo} disabled={launchBlocked || !nshardValid || !promptsValid || !motionValid || !stillsReady} className={styles.primaryButton}>
            {phase === "rendering-video" ? "Rendering video…" : "Launch Video Render"}
          </button>
        </div>
      </section>
    </main>
  );
}

function RenderFleetHero({
  access,
  fleetHealth,
  ready,
  shotCount,
  profileId,
}: {
  access: ReturnType<typeof useOperationsAccess>;
  fleetHealth: NovitaFleetHealth | null;
  ready: boolean;
  shotCount: number;
  profileId: ProfileId;
}) {
  const activeCount = fleetHealth?.activeGpuCount;
  const state = access !== "owner" ? "locked" : fleetHealth === null ? "checking" : ready ? "ready" : "held";
  return (
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>GPU rendering</p>
        <h1>Novita Render Farm</h1>
        <div className={styles.heroRule}>
          <span aria-hidden="true">⌁</span>
          <div><small>Dispatch</small><strong>Inspect · confirm spend · render</strong></div>
        </div>
      </div>
      <figure className={styles.fleetMap} data-state={state}>
        <figcaption><span>RTX 4090 spot topology</span><small>{state.toUpperCase()}</small></figcaption>
        <div className={styles.fleetField}>
          <i className={styles.fleetOrbitA} aria-hidden="true" />
          <i className={styles.fleetOrbitB} aria-hidden="true" />
          <div className={styles.fleetCore}>
            <span>FLEET</span><strong>{fleetHealth?.effectiveGpuLimit ?? "—"}</strong><small>available now</small>
          </div>
          {Array.from({ length: 8 }, (_, index) => (
            <span
              key={index}
              className={styles.gpuNode}
              data-index={index}
              data-state={activeCount == null ? "unknown" : index < activeCount ? "active" : "idle"}
              aria-label={`GPU slot ${index + 1}: ${activeCount == null ? "not attested" : index < activeCount ? "active" : "idle"}`}
            >{String(index + 1).padStart(2, "0")}</span>
          ))}
          <div className={`${styles.fleetNode} ${styles.nodeContract}`}><span>01</span><div><small>Contract</small><strong>Signed payload</strong></div></div>
          <div className={`${styles.fleetNode} ${styles.nodeCheckpoint}`}><span>02</span><div><small>Recovery</small><strong>R2 checkpoint</strong></div></div>
        </div>
      </figure>
      <div className={styles.metricRail}>
        <HeroMetric label="Architecture" value={`${fleetHealth?.architecturalGpuCeiling ?? 8} GPU`} note="orchestration ceiling" />
        <HeroMetric label="Provider quota" value={fleetHealth?.verifiedGpuQuota == null ? "—" : `${fleetHealth.verifiedGpuQuota} GPU`} note="direct attestation" />
        <HeroMetric label="Active" value={activeCount == null ? "—" : String(activeCount)} note="provider reported" />
        <HeroMetric label="Sequence" value={access === "owner" ? `${shotCount} shot${shotCount === 1 ? "" : "s"}` : "Private"} note="current contract" />
        <HeroMetric label="Profile" value={access === "owner" ? profileId : "Sealed"} note={ready ? "benchmark admitted" : "dispatch held"} />
      </div>
    </header>
  );
}

function HeroMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className={styles.heroMetric}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function AdmissionTrace({ health }: { health: NovitaFleetHealth | null }) {
  const stages = [
    { index: "01", label: "Dispatch contract", detail: "Direct Trigger receipt", ready: health?.contract?.dispatchReady === true },
    { index: "02", label: "Pinned model cache", detail: "Gemma · Z-Image · LTX", ready: Boolean(health?.models?.gemma.localCacheVerified && health.models.zImage.localCacheVerified && health.models.ltx.localCacheVerified) },
    { index: "03", label: "Persistent recovery", detail: "Model disk + R2 checkpoint", ready: Boolean(health?.storage?.persistentModelVolumeVerified && health.controls?.r2CheckpointRecovery) },
    { index: "04", label: "Verified shutdown", detail: "Idle reaper armed", ready: health?.controls?.verifiedReaper === true },
  ];
  return (
    <div className={styles.admissionTrace} aria-label="Render admission circuit">
      {stages.map((stage) => (
        <div key={stage.index} data-state={stage.ready ? "ready" : health ? "held" : "unknown"}>
          <span>{stage.index}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div><i aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

function RenderProgressTheatre({
  progress,
  phase,
  message,
  shots,
}: {
  progress: LiveRenderProgress | null;
  phase: Phase;
  message: string;
  shots: readonly ShotRow[];
}) {
  const total = Math.max(progress?.total ?? shots.length, 1);
  const outputRatio = Math.min(1, (progress?.outputs ?? 0) / total);
  const percent = !progress ? 0
    : progress.status === "queued" ? 12
      : progress.status === "launching" ? 28
        : progress.status === "running" ? Math.round(38 + outputRatio * 50)
          : progress.status === "done" ? 100
            : Math.max(12, Math.round(38 + outputRatio * 50));
  const stageState = (index: number) => {
    if (!progress) return "idle";
    if (progress.status === "failed") return index <= Math.ceil(percent / 25) ? "failed" : "idle";
    const threshold = [5, 20, 38, 88, 100][index];
    return percent >= threshold ? "done" : percent >= threshold - 18 ? "active" : "idle";
  };
  const stages = ["Contract sealed", "Fleet dispatch", `${progress?.phase === "video" ? "Clip" : "Still"} render`, "Output verify", "R2 checkpoint"];
  return (
    <section className={styles.progressTheatre} data-state={phase} aria-label="Live render progress" aria-live="polite">
      <header>
        <div><span className={styles.eyebrow}>Live render progress</span><h2>{progress ? `${progress.phase === "image" ? "Image" : "Video"} job · ${progress.status}` : "Render stage standing by"}</h2></div>
        <div className={styles.progressIdentity}><small>{progress?.jobId ?? "NO JOB IN FLIGHT"}</small><strong>{percent}%</strong></div>
      </header>
      <div className={styles.progressRail}><i style={{ width: `${percent}%` }} /></div>
      <div className={styles.progressStages}>
        {stages.map((stage, index) => <div key={stage} data-state={stageState(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{stage}</strong><i aria-hidden="true" /></div>)}
      </div>
      <div className={styles.outputStage}>
        <div className={styles.outputSlots}>
          {shots.map((shot, index) => {
            const done = Boolean(shot.stillKey) || Boolean(progress && progress.status === "done") || index < (progress?.outputs ?? 0);
            return <span key={shot.id} data-state={done ? "done" : progress?.status === "running" && index === (progress.outputs ?? 0) ? "active" : "idle"}><i aria-hidden="true" />{shot.id}</span>;
          })}
        </div>
        <p data-error={phase === "error"}>{message || "The signed job receipt, provider status, verified output count, and checkpoint state will appear here during a launch."}</p>
      </div>
    </section>
  );
}

function LaunchCheck({ label, ready }: { label: string; ready: boolean }) {
  return <span data-ready={ready}><i aria-hidden="true" />{label}</span>;
}

function LockedRenderConsole({ access }: { access: Exclude<ReturnType<typeof useOperationsAccess>, "owner"> }) {
  return (
    <section className={styles.lockedConsole} aria-busy={access === "checking" || undefined}>
      <div className={styles.lockedMark} aria-hidden="true"><span>GPU</span><i /><b /></div>
      <div className={styles.lockedCopy}>
        <p className={styles.eyebrow}>{access === "checking" ? "Checking access" : "Paid compute"}</p>
        <h2>{access === "checking" ? "Checking owner…" : "Owner verification required"}</h2>
        <p>{access === "checking" ? "Reading this browser session." : "Fleet capacity, jobs, and prompts remain unloaded."}</p>
        {access !== "checking" ? <a href="/api/operations/authorize" className="studio-button">Verify with YouTube</a> : null}
      </div>
      <div className={styles.lockedRules}>
        <div><span>01</span><strong>Private capacity</strong></div>
        <div><span>02</span><strong>Private prompts</strong></div>
        <div><span>03</span><strong>Explicit spend</strong></div>
      </div>
    </section>
  );
}
