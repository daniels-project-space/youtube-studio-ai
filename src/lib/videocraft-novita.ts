/**
 * VIDEOCRAFT (NOVITA LTX-2.3) — GOLDEN image-to-video module. A thin,
 * self-describing wrapper around the proven Novita render-farm bridge
 * (src/lib/novitaRenderFarm.ts): every shot's rendered still is animated on
 * Novita RTX 4090 spot pods running the pinned LTX-2.3 22B checkpoint in full
 * BF16, with model revision and render settings fixed by an approved profile,
 * NAS-staged weights, per-pod VERIFIED autoclose, and R2-idempotent resume.
 * Emits {footageClips, footageKeys} — the same contract as gen_footage, so
 * timeline_assemble (and any downstream block) consumes it unmodified.
 *
 * BRIDGE — authenticated HTTPS at NOVITA_RENDER_FARM_API. Launch requests use
 * bearer authentication plus a timestamped HMAC signature. Protocol:
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
 *  - dims are %32 (VAE tiling) and fixed by the selected approved profile;
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
import { hasNovitaRenderBridge, renderVideo, validate, type NovitaRenderCfg, type NovitaRenderResult } from "./novitaRenderFarm";

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
  does: "Animates every shot's R2 still on Novita RTX 4090 spot pods with the pinned LTX-2.3 22B checkpoint in full BF16. An explicit immutable draft, production, or hero profile fixes revision, dimensions, FPS, steps, guidance, and precision; the signed bridge enforces that exact contract.",
  produces: {
    kind: "shot_footage",
    file: "R2-backed clips (mp4, H.264) under the render prefix",
    duration: "per-shot, shots[].seconds rounded to 8n+1 frames at fps",
    returns: "{ ok, phase:'video', footageClips, footageKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — every shot needs prompt + stillKey + a motion cue (cameraMove !== 'static' or a motion field)",
    profile: "approved immutable video-phase generation profile",
  },
  optional: { // sensible golden defaults
    negative: "string — global negative prompt (per-shot negatives append to it)",
    nshard: "Novita pods to shard across, ≤3 (account cap)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 3)",
  },
  needs: { // environment
    secrets: ["NOVITA_RENDER_FARM_TOKEN"],
    tools: ["signed HTTPS render bridge (NOVITA_RENDER_FARM_API)"],
    note: "Provider and R2 credentials remain on the GPU control plane; Vercel and Trigger receive only a scoped bridge token.",
  },
  rules: [
    "Freeze-detection QA (the still-frame fix) — a clip that doesn't move is rejected and re-rendered, never shipped.",
    "Video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds round to the nearest valid count, never truncated silently.",
    "Every shot needs a stillKey (a rendered still to animate) AND a motion cue — validate() fails loud otherwise.",
    "Dims are a multiple of 32 (VAE tiling) and fixed by the selected approved profile.",
    "nshard is capped at 3 (Novita account pod limit) — validate() fails loud above it, no silent clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME LTX pod pattern, then fails loud.",
    "R2-idempotent resume — workers skip clips already in R2, so a spot-reclaim requeue never double-renders.",
  ],
} as const;

/** True when the scoped, signed Novita render bridge is configured and valid. */
export async function hasVideocraftNovita(): Promise<boolean> {
  return hasNovitaRenderBridge();
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
