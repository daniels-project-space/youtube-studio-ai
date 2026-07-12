/**
 * VIDEOCRAFT (NOVITA LTX-2.3) — GOLDEN image-to-video module. A thin,
 * self-describing wrapper around the proven Novita render-farm bridge
 * (src/lib/novitaRenderFarm.ts): every shot's rendered still is animated on
 * Novita RTX 4090 spot pods running LTX-2.3 22B int8 via Wan2GP at
 * 1920×1088 / 40 steps / guidance 4.0 (engine params fixed pod-side), with
 * NAS-staged weights, per-pod VERIFIED autoclose, and R2-idempotent resume.
 * Emits {footageClips, footageKeys} — the same contract as gen_footage, so
 * timeline_assemble (and any downstream block) consumes it unmodified.
 *
 * BRIDGE — LIVE at http://87.106.233.113/novita-bridge/render (nginx → VPS
 * service; override via NOVITA_RENDER_API). Protocol:
 *   POST {base}/video  {prefix, jobs:[{id,stillKey,cameraMove,shotScale,lens,
 *                       motion,frames,fps,negative,seed?}], nshard, jobsSel,
 *                       maxConcurrent} → {jobId}
 *   GET  {base}/status?jobId=… → {status:"running"|"done"|"failed",
 *                       footageKeys, n_outputs, n_jobs,
 *                       workers:[{name,done,closed}], error}
 * The bridge runs a slot-aware queue — the Novita account cap is 3 concurrent
 * pods, so bursts above the cap wait for a free slot instead of failing.
 *
 * QUALITY GATES (why this is golden):
 *  - freeze-detection QA on every clip (the still-frame fix) — a clip that
 *    doesn't actually move is rejected and re-rendered, never shipped;
 *  - video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds
 *    round to the nearest valid frame count, never truncated silently;
 *  - every shot MUST carry a stillKey + a motion cue (cameraMove !== 'static'
 *    OR a non-empty motion field) — validate() fails loud otherwise;
 *  - dims are %32 (VAE tiling) — the golden 1920×1088 tier is fixed pod-side;
 *  - NO cross-engine fallback — a failed shard retries the SAME LTX pod
 *    pattern, then fails loud;
 *  - R2-idempotent resume — workers skip clips already in R2, so a requeue
 *    or spot-reclaim relaunch never double-renders;
 *  - nshard capped at 3 (account pod limit), per-pod VERIFIED autoclose.
 *
 * CAMERA GRAMMAR — the 10 canonical CameraMove values: static, dolly_push,
 * dolly_pull, crane_up, crane_down, orbit_left, orbit_right, truck_left,
 * truck_right, handheld_drift. Per-shot: stillKey (from imagecraft-novita),
 * cameraMove, shotScale, lens, motion (what moves IN-frame, independent of
 * camera), seconds (→ 8n+1 frames at cfg.fps), negative, seed. Global:
 * negative / fps. Camera + motion + duration is the whole director surface —
 * the look was locked at image time by imagecraft-novita.
 */
import { bootstrapSecrets } from "./bootstrap";
import { renderVideo, validate, type NovitaRenderCfg, type NovitaRenderResult } from "./novitaRenderFarm";

export { validate, secondsToFrames } from "./novitaRenderFarm";
export type { NovitaRenderCfg, NovitaRenderResult, Shot, CameraMove, ShotScale } from "./novitaRenderFarm";

/**
 * VIDEOCRAFT_NOVITA_MODULE — the self-describing contract. Mirrors
 * NOVITA_RENDER_FARM_MODULE's shape (key/title/stage/does/produces/requires/
 * optional/needs/rules) so this module is consistent with the golden set.
 */
export const VIDEOCRAFT_NOVITA_MODULE = {
  key: "videocraft-novita",
  title: "Videocraft (Novita LTX-2.3)",
  stage: "visual",
  does: "Animates every shot's R2 still into a camera-move clip on Novita RTX 4090 spot pods (LTX-2.3 22B int8 via Wan2GP, 1920×1088, 40 steps, guidance 4.0) through the live VPS bridge: slot-aware 3-pod queue, freeze-detection QA, verified pod autoclose, R2-idempotent resume. A thin GOLDEN wrapper over novitaRenderFarm's video phase — output is drop-in gen_footage/timeline_assemble compatible.",
  produces: {
    kind: "shot_footage",
    file: "R2-backed clips (mp4, H.264) under the render prefix",
    duration: "per-shot, shots[].seconds rounded to 8n+1 frames at fps",
    returns: "{ ok, phase:'video', footageClips, footageKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — every shot needs prompt + stillKey + a motion cue (cameraMove !== 'static' or a motion field)",
  },
  optional: { // sensible golden defaults
    negative: "string — global negative prompt (per-shot negatives append to it)",
    fps: "video frames-per-second (default 24)",
    nshard: "Novita pods to shard across, ≤3 (account cap)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 3)",
  },
  needs: { // environment
    secrets: ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    tools: ["VPS render bridge (NOVITA_RENDER_API — live nginx path /novita-bridge/render)"],
    note: "Renders run on Novita 4090 pods driven by the VPS orchestrator — this module talks HTTP only, never spawns python in Vercel/Trigger. Engine params (1920×1088 / 40 steps / guidance 4.0) are fixed pod-side.",
  },
  rules: [
    "Freeze-detection QA (the still-frame fix) — a clip that doesn't move is rejected and re-rendered, never shipped.",
    "Video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds round to the nearest valid count, never truncated silently.",
    "Every shot needs a stillKey (a rendered still to animate) AND a motion cue — validate() fails loud otherwise.",
    "Dims are a multiple of 32 (VAE tiling) — the golden 1920×1088 tier is fixed pod-side.",
    "nshard is capped at 3 (Novita account pod limit) — validate() fails loud above it, no silent clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME LTX pod pattern, then fails loud.",
    "R2-idempotent resume — workers skip clips already in R2, so a spot-reclaim requeue never double-renders.",
  ],
} as const;

/** True when the Novita render farm is usable (NOVITA_API_KEY in env, hydrating the vault first if needed). */
export async function hasVideocraftNovita(): Promise<boolean> {
  if (process.env.NOVITA_API_KEY) return true;
  try {
    await bootstrapSecrets();
  } catch {
    /* vault unreachable — the env check below decides */
  }
  return !!process.env.NOVITA_API_KEY;
}

/**
 * Render the VIDEO phase for every shot that has a stillKey. Validates (fail
 * loud, all violations at once — stillKey, motion cue, 8n+1, pod cap), then
 * POSTs the shot list to the live bridge and polls to completion. Returns
 * {footageClips, footageKeys} — the same shape gen_footage emits, so
 * timeline_assemble works unmodified.
 */
export async function craftClips(cfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  validate(cfg, "video");
  return renderVideo(cfg);
}
