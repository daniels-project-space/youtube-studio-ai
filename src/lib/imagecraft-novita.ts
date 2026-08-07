/**
 * IMAGECRAFT (NOVITA Z-IMAGE) — GOLDEN still-image module. A thin,
 * self-describing wrapper around the proven Novita render-farm bridge
 * (src/lib/novitaRenderFarm.ts): every shot's still is rendered on Novita
 * RTX 4090 spot pods running the pinned Z-Image Turbo checkpoint in full BF16,
 * with resolution and candidate count selected by an approved immutable profile,
 * with NAS-staged weights (no cold model pulls), per-pod VERIFIED autoclose,
 * and R2-idempotent resume. Standalone and composable — the stillKeys it
 * returns feed videocraft-novita (image-to-video) or any downstream block.
 *
 * BRIDGE — authenticated HTTPS at NOVITA_RENDER_FARM_API. Launch requests use
 * bearer authentication plus a timestamped HMAC signature. Protocol:
 *   POST {base}/image  {prefix, jobs:[{id,prompt,negative,width,height,steps,
 *                       cfg,seed}], nshard, jobsSel, maxConcurrent} → {jobId}
 *   GET  {base}/status?jobId=… → {status:"running"|"done"|"failed",
 *                       stillKeys, n_outputs, n_jobs,
 *                       workers:[{name,done,closed}], error}
 * The bridge runs a slot-aware queue — the Novita account cap is 3 concurrent
 * pods, so bursts above the cap wait for a free slot instead of failing.
 *
 * QUALITY GATES (why this is golden):
 *  - inline sharpness + exposure QA on every rendered still — soft or blown
 *    frames are re-rendered pod-side, never shipped;
 *  - width/height must be %32 (VAE tiling) — validate() fails loud, it never
 *    silently rounds;
 *  - NO cross-engine fallback — a failed shard retries the SAME Z-Image pod
 *    pattern, then fails loud;
 *  - R2-idempotent resume — workers skip stills already in R2, so a requeue
 *    or re-run never double-renders (and never double-bills);
 *  - nshard capped at 3 (account pod limit) — over-asking fails validate();
 *  - per-pod VERIFIED autoclose — the monitor confirms every pod is gone and
 *    force-deletes stragglers, so no ghost pod ever keeps billing.
 *
 * DIRECTOR CONTROL SURFACE — per-shot: prompt, seed, negative, and approved
 * candidate count. Global: style / director / negative plus an explicit
 * immutable draft, production, or hero profile. The SAME shot list later
 * drives videocraft-novita's camera-move pass — write it once.
 */
import { hasNovitaRenderBridge, renderImages, validate, type NovitaRenderCfg, type NovitaRenderResult } from "./novitaRenderFarm";

export { validate, secondsToFrames } from "./novitaRenderFarm";
export type { NovitaRenderCfg, NovitaRenderResult, Shot, CameraMove, ShotScale } from "./novitaRenderFarm";

/**
 * IMAGECRAFT_NOVITA_MODULE — the self-describing contract. Mirrors
 * NOVITA_RENDER_FARM_MODULE's shape (key/title/stage/does/produces/requires/
 * optional/needs/rules) so this module is consistent with the golden set.
 */
export const IMAGECRAFT_NOVITA_MODULE = {
  key: "imagecraft-novita",
  title: "Imagecraft (Novita Z-Image)",
  stage: "visual",
  does: "Renders every shot's still on Novita RTX 4090 spot pods with the pinned Z-Image Turbo checkpoint in full BF16. An explicit immutable draft, production, or hero profile fixes model revision, dimensions, steps, precision, and candidate count; the signed bridge enforces that exact contract.",
  produces: {
    kind: "shot_stills",
    file: "R2-backed stills (png/jpg) under the render prefix",
    returns: "{ ok, phase:'image', stillKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — at least one shot with a non-empty prompt",
    profile: "approved immutable image-phase generation profile",
  },
  optional: { // sensible golden defaults
    style: "string — global style suffix appended to every shot prompt",
    negative: "string — global negative prompt (per-shot negatives append to it)",
    director: "string — director notes, appended to every shot prompt",
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
    "Inline image QA — sharpness + exposure gates on every still; weak frames re-render pod-side, never ship.",
    "width/height MUST be a multiple of 32 (VAE tiling requirement) — never submitted unrounded.",
    "nshard is capped at 3 (Novita account pod limit) — validate() fails loud above it, no silent clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME Z-Image pod pattern, then fails loud.",
    "R2-idempotent resume — workers skip stills already in R2, so a requeue never double-renders.",
    "Per-pod VERIFIED autoclose — the monitor confirms every pod is gone and force-deletes stragglers.",
  ],
} as const;

/** True when the scoped, signed Novita render bridge is configured and valid. */
export async function hasImagecraftNovita(): Promise<boolean> {
  return hasNovitaRenderBridge();
}

/**
 * Render the IMAGE phase for every shot with a prompt. Validates the caller's
 * explicit immutable profile (fail loud, all violations at once), then POSTs the shot list to the live
 * bridge and polls to completion. Returns R2 stillKeys — feed them back into
 * the same shots as `stillKey` for videocraft-novita's video pass.
 */
export async function craftStills(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  validate(userCfg, "image");
  return renderImages(userCfg);
}
