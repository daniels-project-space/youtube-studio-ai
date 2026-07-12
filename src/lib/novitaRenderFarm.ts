/**
 * NOVITA RENDER FARM — standalone image + video render module driven by the
 * proven 8×4090 Novita orchestrator (`/root/ltx-build/novita/orchestrator.py`
 * on the VPS): static modulo sharding, spot-pod autoclose + reclaim-requeue,
 * R2-backed idempotent resume (workers skip outputs already in R2).
 *
 * EXECUTION MODEL — the orchestrator is a long-running Python driver that
 * launches/monitors Novita GPU pods; it does NOT run inside Vercel or a
 * Trigger.dev task (no spot-pod lifecycle, no multi-hour process there). This
 * module therefore never spawns python directly — it POSTs the render cfg to
 * a small HTTP bridge that lives on the VPS (a thin server wrapping
 * orchestrator.py's `launch()`/`status()`), then polls that bridge for
 * completion. Configure the bridge URL via `NOVITA_RENDER_API`; default
 * points at the VPS render-API bridge alongside the rest of the render infra.
 */
import { bootstrapSecrets } from "./bootstrap";

/** One of the 10 canonical camera moves a shot can use (static = no camera motion). */
export type CameraMove =
  | "static"
  | "dolly_push"
  | "dolly_pull"
  | "crane_up"
  | "crane_down"
  | "orbit_left"
  | "orbit_right"
  | "truck_left"
  | "truck_right"
  | "handheld_drift";

/** Shot framing — how tight/wide the composition is. */
export type ShotScale = "wide" | "medium" | "close" | "extreme_close" | "establishing";

/** One shot in the render's shot list — the editable repeater row in the console. */
export interface Shot {
  id: string;
  /** Script line / image-generation prompt for this shot. */
  prompt: string;
  cameraMove: CameraMove;
  shotScale: ShotScale;
  /** Lens description, e.g. "35mm anamorphic", "85mm portrait". */
  lens: string;
  /** Shot duration in seconds (video phase); converted to 8n+1 frames. */
  seconds: number;
  /** Motion cue — what actually moves in-frame (subject/particles), independent of camera. */
  motion: string;
  /** Per-shot negative prompt, appended to the global negative. */
  negative?: string;
  seed?: number;
  /** R2 key of the rendered still once the image phase has produced it. */
  stillKey?: string;
  section?: string;
  storyFunction?: string;
}

/** Full render job config — maps ~1:1 onto the orchestrator's job schema (no translation layer). */
export interface NovitaRenderCfg {
  /** R2 key prefix for this render's outputs, e.g. "adart2". */
  prefix: string;
  shots: Shot[];
  /** Global style string appended to every shot prompt. */
  style?: string;
  /** Global negative prompt, prepended to every shot's negative. */
  negative?: string;
  /** Director notes — appended to every shot prompt (global creative direction). */
  director?: string;
  steps?: number;
  cfg?: number;
  fps?: number;
  width?: number;
  height?: number;
  /** Number of Novita pods to shard across (account cap = 3). */
  nshard?: number;
  jobs?: "val" | "full";
  maxConcurrent?: number;
}

/** Result of an image or video render call. */
export interface NovitaRenderResult {
  ok: boolean;
  phase: "image" | "video";
  /** R2 keys of stills produced (image phase). */
  stillKeys?: string[];
  /** Local/streamed clip paths (video phase, if the bridge returns them). */
  footageClips?: string[];
  /** R2 keys of clips produced (video phase). */
  footageKeys?: string[];
  outputs: number;
  durationSec: number;
  raw?: unknown;
}

/**
 * NOVITA_RENDER_FARM_MODULE — the self-describing contract. Mirrors
 * LORESHORT_MODULE's shape (key/title/stage/does/produces/requires/optional/
 * needs/rules) so this module is consistent with the rest of the golden set.
 */
export const NOVITA_RENDER_FARM_MODULE = {
  key: "novita-render-farm",
  title: "Novita Render Farm",
  stage: "visual",
  does: "Renders a full shot list (images then videos) on an 8×4090 Novita spot-pod farm: static modulo sharding, individual pod autoclose, spot-reclaim requeue, and R2-backed idempotent resume. Standalone and composable — feeds stillKeys/footageKeys into any downstream assembler.",
  produces: {
    kind: "shot_list_render",
    file: "R2-backed stills (png/jpg) + clips (mp4, H.264)",
    duration: "per-shot, driven by shots[].seconds",
    returns: "{ ok, phase, stillKeys, footageClips, footageKeys, outputs, durationSec }",
  },
  requires: { // the caller MUST supply these
    prefix: "string — R2 key prefix that names this render's outputs",
    shots: "Shot[] — at least one shot with a non-empty prompt",
  },
  optional: { // sensible defaults
    style: "string — global style suffix appended to every shot prompt",
    negative: "string — global negative prompt",
    director: "string — director notes, appended to every shot prompt",
    steps: "sampler steps (default 40 image base tier)",
    cfg: "classifier-free guidance scale",
    fps: "video frames-per-second (default 24)",
    width: "px, must be %32==0 (default 1024)",
    height: "px, must be %32==0 (default 576)",
    nshard: "Novita pods to shard across, ≤3 (account cap)",
    jobs: "'val' | 'full' — val proves on 1 shard before a full run",
    maxConcurrent: "max pods in flight at once (default 3)",
  },
  needs: { // environment
    secrets: ["NOVITA_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    tools: ["VPS render-API bridge (NOVITA_RENDER_API)"],
    note: "The orchestrator lives on the VPS (/root/ltx-build/novita/orchestrator.py), NOT in Vercel/Trigger — this module talks to it over HTTP only.",
  },
  rules: [
    "Video frames are ALWAYS 8n+1 (LTX/Wan temporal requirement) — seconds are rounded to the nearest valid frame count, never truncated silently.",
    "Every shot needs a motion cue (cameraMove !== 'static' OR a non-empty motion field) — a shot with neither is a still, not a video shot.",
    "width/height MUST be a multiple of 32 (VAE tiling requirement) — never submitted unrounded.",
    "nshard is capped at 3 (Novita account pod limit) — a request above that fails validate(), it does not silently clamp.",
    "NO cross-engine fallback: a failed shard retries the SAME engine/pod pattern, then fails loud.",
    "R2-backed idempotent resume — workers skip outputs already present in R2, so a requeue never double-renders.",
  ],
} as const;

const DEFAULTS = {
  style: "", negative: "", director: "",
  steps: 40, cfg: 4.5, fps: 24, width: 1024, height: 576,
  nshard: 1, jobs: "val" as const, maxConcurrent: 3,
};

/** VPS render-API bridge — a small server wrapping orchestrator.py's launch()/status(). */
const RENDER_API = process.env.NOVITA_RENDER_API || "http://87.106.233.113/novita-bridge/render";

/** Round seconds → the nearest valid 8n+1 frame count at the given fps (never below 9 frames / 1 shard). */
export function secondsToFrames(seconds: number, fps: number): number {
  const raw = Math.max(1, seconds) * fps;
  const n = Math.max(1, Math.round((raw - 1) / 8));
  return 8 * n + 1;
}

/**
 * Quality gates. `phase` narrows which checks apply — "image" only needs
 * prompts + dims; "video" additionally needs frames/motion/stillKey.
 * Throws with ALL violations joined (fail loud, fail once).
 */
export function validate(cfg: NovitaRenderCfg, phase: "image" | "video"): void {
  const errs: string[] = [];
  if (!cfg.prefix || !cfg.prefix.trim()) errs.push("prefix is required");
  const shots = cfg.shots ?? [];
  const withPrompt = shots.filter((s) => s.prompt && s.prompt.trim());
  if (withPrompt.length < 1) errs.push("at least one shot with a non-empty prompt is required");

  const width = cfg.width ?? DEFAULTS.width;
  const height = cfg.height ?? DEFAULTS.height;
  if (width % 32 !== 0) errs.push(`width ${width} must be a multiple of 32`);
  if (height % 32 !== 0) errs.push(`height ${height} must be a multiple of 32`);

  const nshard = cfg.nshard ?? DEFAULTS.nshard;
  if (nshard > 3) errs.push(`nshard ${nshard} exceeds the Novita account cap of 3`);
  if (nshard < 1) errs.push("nshard must be >= 1");

  if (phase === "video") {
    const fps = cfg.fps ?? DEFAULTS.fps;
    for (const s of shots) {
      if (!s.prompt || !s.prompt.trim()) continue; // already flagged above if it's the only shot
      const frames = secondsToFrames(s.seconds, fps);
      if ((frames - 1) % 8 !== 0) errs.push(`shot ${s.id}: frame count ${frames} is not 8n+1`);
      const hasMotionCue = (s.cameraMove && s.cameraMove !== "static") || (s.motion && s.motion.trim());
      if (!hasMotionCue) errs.push(`shot ${s.id}: no motion cue (cameraMove is 'static' and motion is empty)`);
      if (!s.stillKey || !s.stillKey.trim()) errs.push(`shot ${s.id}: missing stillKey (video phase needs a rendered still to animate)`);
    }
  }

  if (errs.length) throw new Error(`novitaRenderFarm.validate(${phase}): ${errs.join("; ")}`);
}

/** Build the full per-shot prompt: global style + director notes + shot prompt. */
function shotPrompt(cfg: NovitaRenderCfg, s: Shot): string {
  return [s.prompt, cfg.style, cfg.director].filter((p) => p && p.trim()).join(". ");
}

function shotNegative(cfg: NovitaRenderCfg, s: Shot): string {
  return [cfg.negative, s.negative].filter((p) => p && p.trim()).join(", ");
}

/** POST to the VPS render-API bridge and poll until the job reports done. */
async function bridgeRenderAndPoll(
  phase: "image" | "video",
  body: Record<string, unknown>,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<any> {
  const pollMs = opts.pollMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 4 * 60 * 60 * 1000; // 4h ceiling, mirrors orchestrator's own monitor timeout
  const launchRes = await fetch(`${RENDER_API}/${phase}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!launchRes.ok) throw new Error(`novitaRenderFarm: bridge launch ${phase} failed ${launchRes.status}: ${(await launchRes.text()).slice(0, 300)}`);
  const launch = await launchRes.json();
  const jobId = launch.jobId ?? launch.id;
  if (!jobId) throw new Error(`novitaRenderFarm: bridge launch ${phase} returned no jobId`);

  const t0 = Date.now();
  for (;;) {
    const statusRes = await fetch(`${RENDER_API}/status?jobId=${encodeURIComponent(jobId)}`);
    if (statusRes.ok) {
      const st = await statusRes.json();
      if (st.status === "done" || st.ok === true) return st;
      if (st.status === "failed" || st.error) throw new Error(`novitaRenderFarm: ${phase} job ${jobId} failed: ${st.error ?? "unknown"}`);
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`novitaRenderFarm: ${phase} job ${jobId} timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Render the IMAGE phase for every shot with a prompt. POSTs the shot list to
 * the VPS render-API bridge (which invokes orchestrator.py's `image` launch),
 * then polls until all shards report done. Returns R2 stillKeys.
 */
export async function renderImages(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const cfg: NovitaRenderCfg = { ...DEFAULTS, ...userCfg };
  validate(cfg, "image");
  await bootstrapSecrets(() => {}, { required: ["NOVITA_API_KEY"] });
  const t0 = Date.now();

  const jobs = cfg.shots
    .filter((s) => s.prompt && s.prompt.trim())
    .map((s) => ({
      id: s.id,
      prompt: shotPrompt(cfg, s),
      negative: shotNegative(cfg, s),
      width: cfg.width ?? DEFAULTS.width,
      height: cfg.height ?? DEFAULTS.height,
      steps: cfg.steps ?? DEFAULTS.steps,
      cfg: cfg.cfg ?? DEFAULTS.cfg,
      seed: s.seed,
    }));

  const st = await bridgeRenderAndPoll("image", {
    prefix: cfg.prefix,
    jobs,
    nshard: cfg.nshard ?? DEFAULTS.nshard,
    jobsSel: cfg.jobs ?? DEFAULTS.jobs,
    maxConcurrent: cfg.maxConcurrent ?? DEFAULTS.maxConcurrent,
  });

  return {
    ok: true,
    phase: "image",
    stillKeys: st.stillKeys ?? st.outputs ?? [],
    outputs: (st.stillKeys ?? st.outputs ?? []).length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    raw: st,
  };
}

/**
 * Render the VIDEO phase (image-to-video camera moves) for every shot that
 * already has a stillKey. Same VPS bridge, `video` launch. Returns clips +
 * R2 footageKeys — the SAME shape as `gen_footage`'s output, so
 * `timeline_assemble` (and any other downstream block) consumes it unmodified.
 */
export async function renderVideo(userCfg: NovitaRenderCfg): Promise<NovitaRenderResult> {
  const cfg: NovitaRenderCfg = { ...DEFAULTS, ...userCfg };
  validate(cfg, "video");
  await bootstrapSecrets(() => {}, { required: ["NOVITA_API_KEY"] });
  const t0 = Date.now();
  const fps = cfg.fps ?? DEFAULTS.fps;

  const jobs = cfg.shots
    .filter((s) => s.prompt && s.prompt.trim() && s.stillKey)
    .map((s) => ({
      id: s.id,
      stillKey: s.stillKey,
      cameraMove: s.cameraMove,
      shotScale: s.shotScale,
      lens: s.lens,
      motion: s.motion,
      frames: secondsToFrames(s.seconds, fps),
      fps,
      negative: shotNegative(cfg, s),
    }));

  const st = await bridgeRenderAndPoll("video", {
    prefix: cfg.prefix,
    jobs,
    nshard: cfg.nshard ?? DEFAULTS.nshard,
    jobsSel: cfg.jobs ?? DEFAULTS.jobs,
    maxConcurrent: cfg.maxConcurrent ?? DEFAULTS.maxConcurrent,
  });

  const footageKeys: string[] = st.footageKeys ?? st.clipKeys ?? st.outputs ?? [];
  return {
    ok: true,
    phase: "video",
    footageClips: st.footageClips ?? [],
    footageKeys,
    outputs: footageKeys.length,
    durationSec: Math.round((Date.now() - t0) / 1000),
    raw: st,
  };
}
