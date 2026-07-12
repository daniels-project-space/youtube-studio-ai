/**
 * IMAGECRAFT (NOVITA Z-IMAGE) — GOLDEN still-image module. A thin,
 * self-describing wrapper around the proven Novita render-farm bridge
 * (src/lib/novitaRenderFarm.ts): every shot's still is rendered on Novita
 * RTX 4090 spot pods running Z-Image base bf16 at 2048×1152 / 40 steps,
 * with NAS-staged weights (no cold model pulls), per-pod VERIFIED autoclose,
 * and R2-idempotent resume. Standalone and composable — the stillKeys it
 * returns feed videocraft-novita (image-to-video) or any downstream block.
 *
 * BRIDGE — LIVE at http://87.106.233.113/novita-bridge/render (nginx → VPS
 * service; override via NOVITA_RENDER_API). Protocol:
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
 * DIRECTOR CONTROL SURFACE — per-shot: prompt (the script line), lens,
 * shotScale, seed, negative. Global: style / director (both appended into
 * every shot prompt), negative, steps / cfg / width / height. The SAME shot
 * list later drives videocraft-novita's camera-move pass — write it once.
 */
import { bootstrapSecrets } from "./bootstrap";
import { renderImages, validate, type NovitaRenderCfg, type NovitaRenderResult } from "./novitaRenderFarm";

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
  does: "Renders every shot's still on Novita RTX 4090 spot pods (Z-Image base bf16, 2048×1152, 40 steps, NAS-staged weights) through the live VPS bridge: slot-aware 3-pod queue, inline sharpness/exposure QA, verified pod autoclose, R2-idempotent resume. A thin GOLDEN wrapper over novitaRenderFarm's image phase — its stillKeys feed videocraft-novita unmodified.",
  produces: {
    kind: "shot_stills",
    file: "R2-backed stills (png/jpg) under the render prefix",
    returns: "{ ok, phase:'image', stillKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — at least one shot with a non-empty prompt",
  },
  optional: { // sensible golden defaults
    style: "string — global style suffix appended to every shot prompt",
    negative: "string — global negative prompt (per-shot negatives append to it)",
    director: "string — director notes, appended to every shot prompt",
    steps: "sampler steps (golden default 40)",
    cfg: "classifier-free guidance scale",
    width: "px, must be %32==0 (golden default 2048)",
    height: "px, must be %32==0 (golden default 1152)",
    nshard: "Novita pods to shard across, ≤3 (account cap)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 3)",
  },
  needs: { // environment
    secrets: ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    tools: ["VPS render bridge (NOVITA_RENDER_API — live nginx path /novita-bridge/render)"],
    note: "Renders run on Novita 4090 pods driven by the VPS orchestrator — this module talks HTTP only, never spawns python in Vercel/Trigger.",
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

/** Proven golden image tier — Z-Image base bf16 on a 4090 (the config that shipped "A Dying Art"). */
const GOLDEN_IMAGE_DEFAULTS = { width: 2048, height: 1152, steps: 40 };

/** True when the Novita render farm is usable (NOVITA_API_KEY in env, hydrating the vault first if needed). */
export async function hasImagecraftNovita(): Promise<boolean> {
  if (process.env.NOVITA_API_KEY) return true;
  try {
    await bootstrapSecrets();
  } catch {
    /* vault unreachable — the env check below decides */
  }
  return !!process.env.NOVITA_API_KEY;
}

/**
 * Render the IMAGE phase for every shot with a prompt. Applies the golden
 * Z-Image tier (2048×1152 / 40 steps) unless the caller overrides, validates
 * (fail loud, all violations at once), then POSTs the shot list to the live
 * bridge and polls to completion. Returns R2 stillKeys — feed them back into
 * the same shots as `stillKey` for videocraft-novita's video pass.
 */
export async function craftStills(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const cfg: NovitaRenderCfg = {
    ...userCfg,
    width: userCfg.width ?? GOLDEN_IMAGE_DEFAULTS.width,
    height: userCfg.height ?? GOLDEN_IMAGE_DEFAULTS.height,
    steps: userCfg.steps ?? GOLDEN_IMAGE_DEFAULTS.steps,
  };
  validate(cfg, "image");
  return renderImages(cfg);
}
