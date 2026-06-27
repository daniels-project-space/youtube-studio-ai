/**
 * LOFI — standalone Ghibli-seaside lofi loop engine, as a reusable module.
 *
 * Nano Banana Pro still (gemini-3-pro-image-preview; Flux 1.1 Pro Ultra opt-in) →
 * Gemini-Vision GROUNDED motion prompt (per-scene
 * animation priorities + forbidden + spatial rules + character interaction + a
 * hard STATIC-CAMERA lock) → Kling v3 Omni pro 2×15s SEAMLESS loop (clip A = max
 * animation, clip B animates back to the origin frame → 30s unit whose last frame
 * == first frame → invisible stream_loop) → TEMPORAL de-warble (kills AI camera
 * shimmer, seam preserved) → optional Topaz 4K on the loop unit → ffmpeg deblur
 * intro + channel/title overlay + music. Every stage caches to output/lofi/<slug>/.
 *
 * SCENES are a swappable catalog (one coherent Ghibli sunny-seaside world: beach
 * cafe, seaside room, sunset pier, hillside meadow) — the SAME engine renders any
 * of them. The look is ported from the v1 lofi-generator (the engine that made the
 * praised renders): native-resolution, NO crossfade, NO boomerang, NO upscale baked
 * in (Topaz is a separate, optional pass).
 */
import { writeFile, readFile, mkdir, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "./bootstrap";
import { generateBananaImage } from "./banana";
import { ffprobeDuration } from "./ffmpeg";

/** The channel character — kept identical across every scene for a consistent host. */
export const CHARACTER =
  "a ghibli-style young woman in her early twenties, with long flowing dark brown-black hair, " +
  "gentle maturing features and soft expressive eyes";

/** Shared Ghibli sunny-seaside art style fed to every Flux still. */
export const LOFI_STYLE =
  "anime background illustration in authentic studio ghibli art style, miyazaki and joe hisaishi " +
  "aesthetic, hand-painted soft watercolour and gouache textures, warm nostalgic ghibli colour " +
  "palette, wide cosy cinematic composition, wholesome calm lofi mood, bright sunny day, warm " +
  "golden light. ";

export interface LofiScene {
  /** one-line setting summary (fed to the motion-prompt builder) */
  setting: string;
  /** the full Flux image prompt (style + character + scene) */
  flux: string;
  /** ranked list of what MUST move — the motion-assurance core */
  priorities: string[];
  /** what must stay still */
  forbidden: string[];
  /** spatial depth rules (foreground moves most, background ~still) */
  spatial: Record<string, string>;
  /** covered / interior scene — enforces the HARD no-rain-inside rule (rain only outside the glass) */
  indoor?: boolean;
  /** still generator: 'nano' = Nano Banana Pro (STANDARD — obeys negative rules like no-rain-inside) | 'flux' = Flux 1.1 Pro Ultra (opt-in; ignores negative rules) */
  imageModel?: "flux" | "nano";
}

const NOTEXT = " No text, no letters, no signs, no watermark.";

/** The channel's scene catalog — one coherent sunny Ghibli seaside world. */
export const LOFI_SCENES: Record<string, LofiScene> = {
  beachcafe: {
    setting: "a cosy wooden seaside cafe terrace over a sparkling turquoise bay on a sunny afternoon",
    flux: LOFI_STYLE +
      "A cosy wooden seaside cafe terrace on a sunny afternoon, built on a deck right over a calm " +
      "sparkling turquoise bay. " + CHARACTER + " sits at a small wooden table with a cool drink, " +
      "smiling gently, face clearly visible. A fluffy orange-and-white cat rests beside her with its " +
      "bushy tail visible. A striped parasol, potted flowers and hanging plants, paper lanterns, white " +
      "sailboats drifting on the sea, a lush green island on the horizon, big soft white clouds and a " +
      "few small birds in the blue sky." + NOTEXT,
    priorities: [
      "the white clouds drift clearly across the blue sky and a few small birds glide across it",
      "the young woman performs a calm task — lifting her drink for a slow sip, then setting it down — plus soft breathing and a gentle body sway",
      "the cat's fluffy tail slowly waves and swishes, ears twitch, head turns to look around",
      "potted flowers, hanging plants and the parasol fabric sway gently in the sea breeze",
      "sunlight shimmers and sparkles on the turquoise water, small waves roll, the sailboats bob gently",
      "paper lanterns swing slightly on their strings",
    ],
    forbidden: ["the distant island or horizon shifting position", "the deck or buildings moving", "fast or jerky motion"],
    spatial: {
      foreground: "the woman, cat, table, nearby flowers — most movement here",
      midground: "parasol, lanterns, deck railing — gentle movement",
      background: "sea, sailboats, island, sky — clouds and birds drift, the land stays still (parallax)",
    },
  },
  seasideroom: {
    setting: "a cosy coastal bedroom with tall open windows to the sea, curtains billowing in the breeze",
    flux: LOFI_STYLE +
      "Interior of a cosy coastal bedroom on a bright breezy afternoon, tall windows wide open to a " +
      "sparkling blue sea and a green headland, sheer white curtains billowing inward on the sea breeze. " +
      CHARACTER + " lies back relaxed on a soft bed by the window, her bare feet dangling off the edge of " +
      "the bed, face clearly visible. A fluffy cat is curled on the windowsill with its tail visible. Warm " +
      "wooden floor with sunlight pooling on it, potted plants, books and a cup on the bedside table, soft " +
      "white clouds and tiny sailboats seen through the open windows." + NOTEXT,
    priorities: [
      "the sheer white curtains billow and ripple inward on the sea breeze",
      "the young woman rests on the bed breathing slowly, her dangling feet swaying gently, a hand shifting",
      "the cat on the windowsill breathes, its tail slowly swaying, ears twitching",
      "through the open windows the clouds drift across the sky and the sea sparkles, sailboats bobbing",
      "potted plants sway softly, steam rises from the cup on the bedside table",
    ],
    forbidden: ["the room walls, bed or furniture shifting", "the headland or horizon moving", "rain or weather indoors"],
    spatial: {
      foreground: "the woman, bed, dangling feet, curtains — most movement here",
      midground: "windowsill, cat, plants — gentle movement",
      background: "sea, sky, sailboats through the window — clouds drift, land stays still",
    },
    indoor: true,
  },
  sunsetpier: {
    setting: "a wooden pier over a calm asian mountain lake at golden-hour sunset",
    flux: LOFI_STYLE +
      "Golden-hour sunset, warm orange and soft pink sky. A long wooden pier reaches over a calm " +
      "mirror-still asian mountain lake. " + CHARACTER + " sits at the end of the pier, feet dangling over " +
      "the water, watching the sunset, seen from behind in three-quarter view. A fluffy cat sits beside her " +
      "with its tail visible. A traditional japanese wooden house with warmly glowing paper lanterns, distant " +
      "misty mountains and a small pagoda, fireflies beginning to glow, gentle ripples and warm reflections on " +
      "the water, a small moored rowboat." + NOTEXT,
    priorities: [
      "the sunset water gently ripples, warm orange and pink reflections shimmering across the lake surface",
      "the young woman sits calmly, breathing slowly, hair and clothes drifting in a soft breeze, feet swaying over the water",
      "the cat beside her breathes, its tail slowly swaying, head turning to watch the water",
      "soft clouds drift slowly across the warm sunset sky",
      "paper lanterns on the house glow and swing slightly, fireflies drift and blink above the water",
      "the moored rowboat rocks subtly on the ripples",
    ],
    forbidden: ["the sun or distant mountains moving across the sky", "the pier or house shifting position", "dramatic waves"],
    spatial: {
      foreground: "the woman, cat, pier boards — most movement here",
      midground: "house, lanterns, rowboat, fireflies — gentle movement",
      background: "mountains, sky, sun — clouds drift slowly, mountains stay still (parallax)",
    },
  },
  meadow: {
    setting: "an enchanted ghibli hillside meadow overlooking a vast dreamlike world at golden hour",
    flux: LOFI_STYLE +
      "An enchanted studio ghibli hillside meadow overlooking a vast dreamlike world at golden hour. " +
      CHARACTER + " sits peacefully in the tall grass, face visible. A small round white forest-spirit " +
      "companion sits beside her. A single giant ancient tree with a rope shimenawa tied around its trunk, " +
      "a distant floating airship in the sky, rolling green hills stretching to a vast soft blue sky with " +
      "massive cumulus clouds, a field of wildflowers, a winding dirt path leading to a tiny village, a few " +
      "small birds drifting in the sky, golden sunlight shafts filtering through the leaves." + NOTEXT,
    priorities: [
      "the wildflower meadow and tall grass ripple in waves as the wind passes through, like ocean grass",
      "the young woman's hair and dress fabric flow softly in the breeze, she breathes and shifts gently",
      "the small spirit companion breathes, blinks and its ears twitch",
      "the giant tree's leaves rustle and the shimenawa rope swings gently",
      "the clouds drift slowly across the sky and a few birds glide in slow wide arcs",
      "golden sunlight shafts shift slowly through the canopy, the distant airship drifts almost imperceptibly",
    ],
    forbidden: ["the distant airship or hills shifting position", "the grass bending flat or being crushed", "dramatic or stormy motion"],
    spatial: {
      foreground: "the woman, spirit companion, nearby grass and flowers — most movement here",
      midground: "giant tree, closer hills, path — gentle wind movement",
      background: "distant airship, clouds, sky — slow drift only (parallax)",
    },
  },
  samurai: {
    setting: "a traditional wooden teahouse at night, a samurai on dry tatami watching the rain in the garden",
    flux:
      "Atmospheric hand-painted anime lofi illustration, moody cinematic night, old Japan edo-period, deep " +
      "teal-blue night with warm amber lantern glow, ukiyo-e influence, painterly, calm melancholic lofi mood. " +
      "Interior of a traditional wooden Japanese teahouse at night, a lone samurai seated cross-legged on the dry " +
      "tatami by an open shoji screen watching the rain, a low table with a steaming cup of tea, a glowing brazier " +
      "and paper lantern, his katana resting beside him. Beyond the open screen, rain falls in a lantern-lit garden " +
      "with a stone bridge, a koi pond and dripping foliage." + NOTEXT,
    priorities: [
      "rain falls steadily in the garden beyond the open screen, dimpling the koi pond",
      "the paper lantern and brazier flames flicker warmly, casting gently shifting light",
      "thin steam curls up slowly from the cup of tea",
      "the samurai sits calmly, breathing slowly, with small natural shifts of weight",
      "koi drift under the rippling pond surface and the foliage drips outside",
      "warm reflections shimmer on the wet garden stones beyond the screen",
    ],
    forbidden: ["any rain, raindrops or wet surfaces inside the room or on the tatami", "the room or screens shifting position", "the samurai standing or moving fast"],
    spatial: {
      foreground: "the samurai, tatami, low table, tea — most movement here",
      midground: "shoji screens, lanterns, the brazier — gentle flicker",
      background: "rainy garden, koi pond, bridge — rain falls and koi drift, the structures stay still",
    },
    indoor: true,
    imageModel: "nano",
  },
  cyber: {
    setting: "a covered wood-and-glass cyberpunk penthouse balcony lounge over a rainy neon megacity at night",
    flux:
      "Detailed anime cyberpunk lofi illustration, cinematic neon-noir night, a luxurious COVERED rooftop balcony " +
      "lounge under a solid wood-beamed ceiling with soft recessed downlights, dominant purple violet and magenta " +
      "neon glow with warm amber accents, soft bloom, a glass-panel balustrade railing, calm relaxing late-night " +
      "lofi mood. A plush L-shaped sofa with cushions, a low wooden coffee table with a small warm candle and a " +
      "drink, a modern fire pit, potted palms, a glowing wall TV and a small dining table. Beyond the glass railing, " +
      "a vast cyberpunk megacity skyline at night in the rain — towering neon skyscrapers, a purple hazy rainy sky, " +
      "glowing light trails on elevated highways far below. A young person relaxing on the sofa with headphones." + NOTEXT,
    priorities: [
      "rain falls over the neon megacity beyond the glass and the rainy purple haze drifts slowly",
      "the fire pit flames flicker and dance warmly",
      "the neon signs and skyscraper window lights shimmer and pulse, light trails crawl along the highways far below",
      "the person on the sofa relaxes, breathing slowly and lifting the drink for a slow sip",
      "the candle flame flickers, faint steam rises from the drink, the wall TV glows softly",
      "potted palm fronds sway slightly in the night air",
    ],
    forbidden: ["any rain, raindrops, wet surfaces or mist inside the covered lounge", "the balcony, railing or building shifting position", "the city skyline changing position"],
    spatial: {
      foreground: "the sofa, person, coffee table, fire pit — most movement here",
      midground: "glass railing, palms, dining table — gentle movement",
      background: "neon megacity + rainy sky beyond the glass — lights shimmer and rain falls, the skyline stays still",
    },
    indoor: true,
    imageModel: "nano",
  },
};

/** Detect objects near the character and script a SPECIFIC action — never a generic still figure. */
const CHARACTER_INTERACTION =
  "Examine the image for objects within arm's reach of the woman and give her ONE specific natural " +
  "looping action (sip a drink and set it down, slowly turn a page, reach to stroke the cat which leans " +
  "into her touch, tuck hair behind her ear, trail a hand in the water) plus slow breathing and a soft " +
  "body sway. She must NOT sit perfectly still — she is alive.";

/** Hard camera lock appended to EVERY Kling prompt — guaranteed regardless of the LLM. */
const STATIC_CAMERA =
  " CAMERA LOCK (critical): a fixed, locked-off, tripod-mounted shot. The camera is completely static " +
  "for the entire clip — absolutely NO camera movement of any kind: no shake, no jitter, no handheld " +
  "wobble, no drift, no floating, no sway, no bobbing, no pan, no tilt, no roll, no zoom in or out, no " +
  "dolly or push-in. The framing and the frame edges stay perfectly fixed and motionless. This is a WIDE, " +
  "WINDY scene: the wind moves the grass, trees, leaves, flowers, clouds, hair and fabric, but it moves " +
  "ONLY the objects in the scene — it never moves, rocks, pushes or shakes the camera. Animate the " +
  "subjects; keep the viewpoint absolutely locked and still.";

/** HARD RULE for covered/indoor scenes — appended to the still AND the Kling prompt. */
export const NO_RAIN_INSIDE =
  " HARD RULE: this space is COVERED and completely DRY — rain falls ONLY outside, beyond the glass / window, " +
  "over the distant city or garden. There are absolutely NO raindrops, rain streaks, puddles, mist or wet " +
  "surfaces inside; every interior surface (couches, table, floor, tatami) is warm and bone dry. It NEVER rains " +
  "inside — rain is visible only outside, never within the room.";

export interface LofiCfg {
  slug: string;
  scene: keyof typeof LOFI_SCENES | string;
  channel: string;          // on-screen channel name (deblur intro)
  title: string;            // on-screen lofi title
  music: string;            // local path to the lofi music bed
  durationSec?: number;     // final video length (defaults to the music length)
  upscale?: "none" | "topaz"; // Topaz 4K pass on the loop unit
  host?: string;            // public base URL the final video is served from
  webDir?: string;          // local dir served at <host>/lofi
  path?: "standard" | "premium";
}

/** The two cost/quality lanes. */
export const LOFI_PATHS = {
  standard: { upscale: "none" as const, note: "Native 1080p — Flux + Kling 2×15s + de-warble, no upscale. ~$1/render." },
  premium: { upscale: "topaz" as const, note: "Topaz 4K pass on the 30s loop unit, re-assembled at 3840×2160. ~$3/render." },
} as const;

/**
 * LOFI_MODULE — the self-describing contract: what it NEEDS, DOES, PRODUCES, and the
 * RULES that protect its output. Runs standalone AND inside a pipeline of modules.
 */
export const LOFI_MODULE = {
  key: "lofi",
  title: "Lofi Loop",
  stage: "visual",
  does: "Produces a seamless, hours-loopable Ghibli sunny-seaside lofi video: a still painting brought to " +
    "life with layered wind motion (clouds, water, foliage, a calm character + cat) on a locked camera, " +
    "over a lofi music bed with a deblur title intro. Standalone and composable.",
  produces: {
    kind: "lofi_loop_video",
    file: "mp4 — H.264, 1080p (or Topaz 4K), 30s seamless unit stream-looped to the music length, music muxed",
    returns: "{ videoPath, url, scene, durationSec, width, height }",
  },
  requires: {
    slug: "string — unique id; names the output folder + published file",
    scene: "key of LOFI_SCENES — 'beachcafe' | 'seasideroom' | 'sunsetpier' | 'meadow' | 'samurai' | 'cyber'",
    channel: "string — on-screen channel name",
    title: "string — on-screen lofi title",
    music: "string — local path to the lofi music bed",
  },
  optional: {
    path: "'standard' (1080p) | 'premium' (Topaz 4K)",
    durationSec: "final length — defaults to the music length",
    upscale: "'none' | 'topaz'",
  },
  needs: {
    secrets: ["GEMINI_API_KEY", "REPLICATE_API_TOKEN"],
    tools: ["ffmpeg", "ffprobe"],
    note: "Topaz 4K needs the loop unit reachable at a public .mp4 URL (cfg.host); the 1080p lane is host-light.",
  },
  paths: LOFI_PATHS,
  rules: [
    "Seamless loop = 2×15s: clip A animates freely (max life), clip B animates BACK to the origin frame → 30s unit whose last frame == first frame → plain stream_loop, an invisible seam. NEVER crossfade, NEVER boomerang.",
    "Motion is ENSURED, not hoped: each scene declares ranked animation priorities + forbidden motion + spatial rules, and a Gemini-Vision pass writes the motion prompt grounded in the actual painting.",
    "STATIC CAMERA is locked at the source: a hard tripod-lock clause is appended to every Kling prompt — the wind moves the SUBJECTS, never the viewpoint.",
    "Stills render on Nano Banana Pro (gemini-3-pro-image-preview) by STANDARD — it obeys negative rules; Flux 1.1 Pro Ultra is opt-in (imageModel:'flux').",
    "HARD RULE — it NEVER rains inside: covered/indoor scenes (scene.indoor) add a no-rain-inside clause to the still + Kling prompt; rain falls only outside the glass, the interior stays bone dry. (Nano Banana Pro respects this; Flux paints rain indoors regardless — another reason Nano is the standard.)",
    "Camera shake is also removed in post: a motion-aware temporal de-warble cleans AI shimmer from the loop unit (seam preserved), since AI i2v adds a frame-to-frame warble even on a locked camera.",
    "NO upscale is baked in — the render is native resolution; Topaz 4K is a separate optional pass on the short loop unit only.",
    "Every stage caches to output/lofi/<slug>/ → fully resumable.",
  ],
} as const;

const DEFAULTS = {
  scene: "beachcafe", upscale: "none" as const,
  host: "http://87.106.233.113", webDir: "/var/www/html/lofi",
  channel: "Seaside Cafe", title: "lofi to relax & study",
  music: "/var/www/html/lofi/oceancafe_music.mp3",
};

const FLUX_MODEL = "black-forest-labs/flux-1.1-pro-ultra";
const KLING_MODEL = "kwaivgi/kling-v3-omni-video";
const TOPAZ_VERSION = "f4dad23bbe2d0bf4736d2ea8c9156f1911d8eeb511c8d0bb390931e25caaef61"; // topazlabs/video-upscale

export interface LofiResult { videoPath: string; url: string; scene: string; durationSec: number; width: number; height: number; }

/** Run the full lofi-loop pipeline for one config. Resumable; returns the published video. */
export async function craftLofi(userCfg: LofiCfg): Promise<LofiResult> {
  const pathPreset: any = userCfg.path ? LOFI_PATHS[userCfg.path] : {};
  const cfg: any = { ...DEFAULTS, ...pathPreset, ...userCfg };
  const missing = ["slug", "scene", "channel", "title", "music"].filter((k) => !cfg[k] || !String(cfg[k]).trim());
  if (missing.length) throw new Error(`lofi: missing required input(s): ${missing.join(", ")}. See LOFI_MODULE.requires.`);
  const scene: LofiScene = LOFI_SCENES[cfg.scene];
  if (!scene) throw new Error(`lofi: unknown scene '${cfg.scene}'. Known: ${Object.keys(LOFI_SCENES).join(", ")}`);
  if (!existsSync(cfg.music)) throw new Error(`lofi: music bed not found: ${cfg.music}`);
  const dry = scene.indoor ? NO_RAIN_INSIDE : ""; // HARD RULE: covered/indoor scenes never rain inside

  await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY", "REPLICATE_API_TOKEN"] });
  const GK = process.env.GEMINI_API_KEY as string, RT = process.env.REPLICATE_API_TOKEN as string;
  const RUN = join(process.cwd(), "output", "lofi", cfg.slug);
  const WEB = cfg.webDir as string;
  await mkdir(RUN, { recursive: true });
  await mkdir(WEB, { recursive: true });
  const rd = (f: string) => join(RUN, f);
  const log = (m: string) => console.error("[lofi]", m);
  const sh = (c: string, a: string[]) => new Promise<void>((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " exit " + x)))); });
  const probe = ffprobeDuration; // shared (was a local ffprobe-duration one-liner)
  const rfetch = async (url: string, opts?: any, tries = 6): Promise<Response> => { for (let a = 0; ; a++) { try { return await fetch(url, opts); } catch (e) { if (a >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 4000 * (a + 1))); } } };

  // Replicate official-model prediction → returns first output url (Flux/Kling). Retries + polls.
  async function replicate(model: string, input: any, label: string, byVersion = false): Promise<string> {
    const endpoint = byVersion ? "https://api.replicate.com/v1/predictions" : `https://api.replicate.com/v1/models/${model}/predictions`;
    const body = byVersion ? { version: model, input } : { input };
    for (let a = 0; a < 4; a++) {
      const sub = await rfetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let j: any = await sub.json(); const getUrl = j.urls?.get; const t0 = Date.now();
      while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 6000)); j = await (await rfetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 900000) break; }
      const url = Array.isArray(j.output) ? j.output[0] : j.output;
      if (url) return url as string;
      log(`${label} attempt ${a + 1} failed: ${JSON.stringify(j.error || j.detail || j.status).slice(0, 140)}`);
      await new Promise((r) => setTimeout(r, 20000 * (a + 1)));
    }
    throw new Error(`${label} failed after retries`);
  }
  const dl = async (url: string, to: string) => { await writeFile(to, Buffer.from(await (await rfetch(url)).arrayBuffer())); };
  // Upload a frame to the Replicate Files API → returns the get-url (used as Kling start/end image).
  async function uploadFile(p: string, name: string): Promise<string> {
    const form = new FormData();
    form.append("content", new Blob([await readFile(p)], { type: "image/png" }), name);
    const r = await rfetch("https://api.replicate.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${RT}` }, body: form as any });
    return (await r.json()).urls.get as string;
  }

  // 1 ── STILL — Nano Banana Pro (STANDARD: obeys negative rules like no-rain-inside, which Flux ignores).
  //      Opt out to Flux 1.1 Pro Ultra with scene.imageModel === "flux". ──
  const still = rd("still.png");
  if (!existsSync(still)) {
    if (scene.imageModel !== "flux") {
      await writeFile(still, await generateBananaImage({ prompt: scene.flux + dry, aspectRatio: "16:9", imageSize: "2K" }));
    } else {
      const url = await replicate(FLUX_MODEL, { prompt: scene.flux + dry, aspect_ratio: "16:9", output_format: "png", safety_tolerance: 4, raw: false }, "Flux");
      await dl(url, still);
    }
    log("still ✓");
  }
  await copyFile(still, join(WEB, `${cfg.slug}_still.png`));

  // 2 ── GROUNDED MOTION PROMPT (Gemini-Vision: priorities + forbidden + spatial + interaction) ──
  let motion = "";
  if (existsSync(rd("motion.txt"))) motion = await readFile(rd("motion.txt"), "utf8");
  else {
    const priorities = scene.priorities.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const forbidden = scene.forbidden.map((f) => `- NEVER: ${f}`).join("\n");
    const spatial = Object.entries(scene.spatial).map(([z, d]) => `- ${z}: ${d}`).join("\n");
    const tmpl =
      `You are writing a motion prompt for the Kling AI video model to bring this cosy ghibli lofi scene ` +
      `(${scene.setting}) to life with rich, layered, continuous LOOPING motion. Return STRICT JSON: ` +
      `{"motion_prompt": "100-150 words of flowing prose", "element_types": ["type1","type2",...], "character_actions": ["action1"]}. ` +
      `ANIMATION PRIORITIES (in order, all must appear):\n${priorities}\n` +
      `ABSOLUTELY FORBIDDEN (these stay perfectly still):\n${forbidden}\n` +
      `SPATIAL DEPTH (foreground moves most, background almost still — parallax via motion speed, NOT camera):\n${spatial}\n` +
      `CHARACTER ACTION:\n${CHARACTER_INTERACTION}\n` +
      `Count at least 5 genuinely different element_types (e.g. clouds, water, character, cat, foliage, lanterns). ` +
      `Slow, weighted, physics-aware, calm and continuous — a cosy lofi loop. No lists or markdown inside motion_prompt.`;
    const b64 = (await readFile(still)).toString("base64");
    const r = await rfetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: tmpl }, { inline_data: { mime_type: "image/png", data: b64 } }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    const j: any = await r.json();
    const raw = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text).join("").trim().replace(/^```json?\n?/, "").replace(/`+$/, "").trim();
    let parsed: any = {}; try { parsed = JSON.parse(raw.startsWith("{") ? raw : (raw.match(/\{[\s\S]*\}/)?.[0] || "{}")); } catch { parsed = {}; }
    motion = (parsed.motion_prompt && String(parsed.motion_prompt).length > 40) ? parsed.motion_prompt : scene.priorities.join(". ") + ".";
    const nTypes = Array.isArray(parsed.element_types) ? parsed.element_types.length : 0;
    log(`motion: ${motion.length} chars, ${nTypes} element types${nTypes < 5 ? " (LOW — proceeding)" : ""}`);
    await writeFile(rd("motion.txt"), motion);
  }
  const klingPrompt = motion.trim() + STATIC_CAMERA + dry;

  // 3 ── CLIP A (15s, start-only = MAX animation) ─────────────────────────────────
  const clipA = rd("clipA.mp4");
  if (!existsSync(clipA)) {
    const imgUrl = await uploadFile(still, "still.png");
    const url = await replicate(KLING_MODEL, { mode: "pro", start_image: imgUrl, prompt: klingPrompt, duration: 15, aspect_ratio: "16:9", generate_audio: false }, "ClipA");
    await dl(url, clipA); log("clipA ✓");
  }
  // 4 ── CLIP B (15s, start=last frame of A, end=origin → animates back to start) ──
  const clipB = rd("clipB.mp4");
  if (!existsSync(clipB)) {
    await sh("ffmpeg", ["-y", "-i", clipA, "-vframes", "1", "-q:v", "2", rd("origin.png")]);
    await sh("ffmpeg", ["-y", "-sseof", "-0.1", "-i", clipA, "-vframes", "1", "-q:v", "2", rd("last.png")]);
    const originUrl = await uploadFile(rd("origin.png"), "origin.png");
    const lastUrl = await uploadFile(rd("last.png"), "last.png");
    const returnPrompt = motion.trim() + " Everything gently and naturally settles back to the original resting position, very smooth continuous looping motion that returns to the start." + STATIC_CAMERA + dry;
    const url = await replicate(KLING_MODEL, { mode: "pro", start_image: lastUrl, end_image: originUrl, prompt: returnPrompt, duration: 15, aspect_ratio: "16:9", generate_audio: false }, "ClipB");
    await dl(url, clipB); log("clipB ✓");
  }

  // 5 ── CONCAT A+B → 30s unit (last frame == first frame) ────────────────────────
  const unitRaw = rd("unit_raw.mp4");
  if (!existsSync(unitRaw)) {
    for (const [src, dst] of [[clipA, rd("a.mp4")], [clipB, rd("b.mp4")]] as const)
      await sh("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "24", dst]);
    await writeFile(rd("concat.txt"), `file '${rd("a.mp4")}'\nfile '${rd("b.mp4")}'\n`);
    await sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rd("concat.txt"), "-c", "copy", unitRaw]);
  }
  const unitDur = await probe(unitRaw);

  // 6 ── DE-WARBLE: strip AI temporal shimmer (the perceived camera shake), seam preserved ──
  // Motion-aware temporal denoise on a TRIPLED copy, middle period extracted so the loop seam
  // (net camera drift over a seamless loop is ~0) is preserved. NOT vidstab/deshake — the
  // rippling foliage/clouds fool them. Mild spatial (3:2) keeps detail; strong temporal (8:8) kills shimmer.
  let unit = rd("unit.mp4");
  if (!existsSync(unit)) {
    const N = Math.round(unitDur * 24);
    await sh("ffmpeg", ["-y", "-stream_loop", "2", "-i", unitRaw, "-c", "copy", rd("trip.mp4")]);
    await sh("ffmpeg", ["-y", "-i", rd("trip.mp4"), "-vf", `hqdn3d=3:2:8:8,trim=start_frame=${N}:end_frame=${2 * N},setpts=PTS-STARTPTS`, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "24", unit]);
    log("de-warble ✓ (seam preserved)");
  }

  // 7 ── OPTIONAL TOPAZ 4K on the loop unit (separate pass; via a public .mp4 URL, not a data-URI) ──
  let OW = 1920, OH = 1080;
  if (cfg.upscale === "topaz") {
    const unit4k = rd("unit_4k.mp4");
    if (!existsSync(unit4k)) {
      const webUnit = join(WEB, `_${cfg.slug}_unit.mp4`);
      await copyFile(unit, webUnit);
      const publicUrl = `${cfg.host}/lofi/_${cfg.slug}_unit.mp4`;
      const url = await replicate(TOPAZ_VERSION, { video: publicUrl, target_resolution: "4k", target_fps: 30 }, "Topaz4K", true);
      await dl(url, unit4k);
      await unlink(webUnit).catch(() => {});
      log("topaz 4K ✓");
    }
    unit = unit4k; OW = 3840; OH = 2160;
  }

  // 8 ── ASSEMBLE: stream_loop unit + 20-step deblur intro + channel/title overlay + music ──
  const OUT = rd("final.mp4");
  const audDur = await probe(cfg.music);
  const total = cfg.durationSec || audDur;
  const fsBig = Math.round(OW * 0.042), fsSm = Math.round(OW * 0.021), yN = Math.round(OH * 0.46), yT = Math.round(OH * 0.545);
  const deblur = Array.from({ length: 20 }, (_, i) => `gblur=sigma=${20 - i}:enable='between(t\\,${(i * 0.4).toFixed(1)}\\,${((i + 1) * 0.4).toFixed(1)})'`).join(",");
  const aN = `if(lt(t\\,0.5)\\,0\\,if(lt(t\\,2.0)\\,(t-0.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
  const aT = `if(lt(t\\,1.5)\\,0\\,if(lt(t\\,3.0)\\,(t-1.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
  const FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const esc = (s: string) => s.replace(/[':\\]/g, (c) => (c === ":" ? "\\:" : c === "'" ? "’" : "\\\\"));
  const vf = [
    `scale=${OW}:${OH}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${OW}:${OH}`, "unsharp=9:9:1.5:5:5:0.6", deblur, "fade=t=in:st=0:d=2.0",
    `drawtext=fontfile='${FB}':text='${esc(cfg.channel)}':fontsize=${fsBig}:fontcolor=white:alpha='${aN}':x=(w-text_w)/2:y=${yN}`,
    `drawtext=fontfile='${FR}':text='${esc(cfg.title)}':fontsize=${fsSm}:fontcolor=C8C8D2:alpha='${aT}':x=(w-text_w)/2:y=${yT}`,
  ].join(",");
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", unit, "-i", cfg.music, "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-profile:v", "high", "-preset", cfg.upscale === "topaz" ? "fast" : "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "320k", "-pix_fmt", "yuv420p", "-vf", vf, "-t", total.toFixed(2), "-shortest", "-movflags", "+faststart", OUT]);

  const pub = join(WEB, `${cfg.slug}.mp4`);
  await copyFile(OUT, pub);
  log(`DONE ${pub}`);
  return { videoPath: pub, url: `${cfg.host}/lofi/${cfg.slug}.mp4`, scene: cfg.scene, durationSec: total, width: OW, height: OH };
}
