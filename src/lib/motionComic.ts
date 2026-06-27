/**
 * MOTIONCOMIC — a STANDALONE drawn-comic-page engine (NOT wired into the YSA
 * pipeline / golden modules; a sibling spike).
 *
 * Topic in → a narrated COMIC PAGE that draws itself out: the camera zooms into
 * an open comic page of empty panel boxes, and a HAND DRAWS each panel in (the
 * whiteboard scribe pixel-reveal, adapted to colour art) as a multi-voice
 * narration plays, with comic SPEECH BUBBLES popping at each spoken line, over a
 * music bed. Only spend is per-panel art (Nano Banana, image-to-image for
 * character consistency) + ElevenLabs voices + one music track; the draw + camera
 * are deterministic (zero video-model credits).
 *
 * Pipeline (one castMotionComic() call):
 *   1. STORYBOARD — Gemini-Pro writes a tight, coherent story as PANELS, casts a
 *                   narrator + characters to ElevenLabs voices, tags each panel's
 *                   ordered lines (narrator = VO, character = SPEECH BUBBLE).
 *   2. CHARACTERS — one reusable model-sheet per character (Nano Banana).
 *   3. PANELS     — each panel rendered image-to-image with the appearing
 *                   characters' sheets fed back in → identical characters, NO text.
 *   4. VOICES     — each line synthesised in its speaker's voice (exact per-line
 *                   timing → precise bubble cues); concatenated per panel.
 *   5. MUSIC      — one Suno bed, ducked under the narration.
 *   6. RENDER     — scripts/mc_page_render.py draws the page panel-by-panel, hand
 *                   following the ink, bubbles on cue; ffmpeg muxes voice + music.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { geminiJsonPro, geminiVisionLocal } from "@/lib/gemini";
import { generateBananaImage } from "@/lib/banana";
import { generateMusic } from "@/lib/music";

type Logger = (msg: string) => void;

export interface MotionComicBrief {
  topic: string;
  facts?: string;
  panels?: number;
  style?: string;
  width?: number;
  height?: number;
  musicPrompt?: string;
  music?: boolean;
}

/** Curated ElevenLabs cast (probed live). Model picks voiceIds from here. */
const ROSTER = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", g: "male", note: "warm, captivating storyteller — best NARRATOR" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", g: "male", note: "laid-back, casual, resonant" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", g: "male", note: "deep, confident, energetic" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", g: "male", note: "husky trickster — villains/rogues" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", g: "male", note: "fierce, intense — soldiers/tough men" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", g: "male", note: "relaxed optimist — younger men" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", g: "female", note: "mature, reassuring, confident" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", g: "female", note: "quirky, enthusiastic — younger women" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", g: "female", note: "clear, engaging" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", g: "female", note: "knowledgeable, professional" },
];
const VALID_IDS = new Set(ROSTER.map((r) => r.id));
const DEFAULT_NARRATOR = "JBFqnCBsd6RMkjVDRZzb";

const DEFAULT_STYLE =
  "cinematic graphic-novel / comic-book art: bold confident ink line-art with strong black outlines, dramatic cel shading, " +
  "rich but moody colour, expressive faces, dynamic compositions, film-grain texture. ABSOLUTELY NO speech bubbles, NO " +
  "captions, NO lettering, NO text of any kind anywhere in the image.";

const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");
const PREROLL_MS = 1700; // must match EST in mc_page_render.py
const PER_PAGE = 6;      // panels per comic page (must match per_page in the renderer)
const TURN_SEC = 1.3;    // page-turn duration (must match turn in the renderer)

export function hasMotionComic(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.ELEVENLABS_API_KEY);
}

/* ------------------------------- types --------------------------------- */

interface PlanChar { id: string; name: string; look: string; voiceId: string }
interface PlanLine { speaker: string; text: string }
interface PlanPanel { scene: string; characters: string[]; shot: string; lines: PlanLine[] }
interface Plan { title: string; logline: string; narratorVoiceId: string; characters: PlanChar[]; panels: PlanPanel[] }

export interface MotionComicResult { outPath: string; title: string; panels: number; durationMs: number; runDir: string }

/* ------------------------------ helpers -------------------------------- */

const stripTags = (s: string) => s.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

const safeJson = <T,>(s: string, fb: T): T => {
  try { return JSON.parse(s.replace(/```json|```/g, "").trim()); } catch { return fb; }
};
const n01 = (v: number) => (v > 1.5 ? v / 1000 : v); // accept 0..1 or Gemini's 0..1000

interface BubbleAnchor { mouth?: [number, number]; anchor?: [number, number] }
interface PanelVision { anchors: Record<string, BubbleAnchor>; keepClear: number[][] }

/**
 * Documotion-style letterer pass: the model SEES the finished panel and chooses,
 * per speaker, a CLEAR-SPACE anchor for the bubble + the exact mouth point for the
 * tail, plus every face/hero-object box the text must not cover. Text is never
 * baked into the art — placement is an engine overlay, validated by vision.
 */
async function locatePanelText(imgPath: string, lines: PlanLine[], chars: PlanChar[], log: Logger): Promise<PanelVision> {
  const items = lines.filter((l) => l.speaker !== "narrator")
    .map((l) => `- ${chars.find((c) => c.id === l.speaker)?.name ?? l.speaker}: "${stripTags(l.text)}"`).join("\n");
  const prompt =
    `You are a COMIC LETTERER placing speech bubbles on ONE finished comic panel (shown).\n` +
    `These characters speak (each needs a bubble):\n${items}\n\n` +
    `For EACH, choose where the bubble goes so it is LEGIBLE and covers NO face and NO important/hero object ` +
    `(weapons, hands, key props): put it in EMPTY space (sky, wall, ground, fog) NEAR and preferably ABOVE the speaker, ` +
    `with its tail able to reach that speaker's mouth.\n` +
    `Return STRICT JSON, ALL coordinates NORMALIZED 0..1 (origin top-left, x→right, y→down):\n` +
    `{"bubbles":[{"name":"<character>","mouth":[x,y] (exact lips point),"anchor":[x,y] (centre of the empty area for the bubble)}],` +
    `"keepClear":[[x,y,w,h], ...]}\n` +
    `keepClear = a TIGHT box around EVERY face AND every important/hero object the text must not cover. No prose.`;
  try {
    const raw = await geminiVisionLocal({ prompt, imagePaths: [imgPath], json: true, maxTokens: 900 });
    const j = safeJson<{ bubbles?: { name?: string; mouth?: number[]; anchor?: number[] }[]; keepClear?: number[][] }>(raw, {});
    const anchors: Record<string, BubbleAnchor> = {};
    for (const bb of j.bubbles ?? []) {
      const nm = (bb.name ?? "").toLowerCase();
      const id = chars.find((c) => nm.includes(c.name.toLowerCase().split(" ")[0]) || c.name.toLowerCase().includes(nm))?.id;
      if (!id) continue;
      anchors[id] = {
        mouth: bb.mouth && bb.mouth.length >= 2 ? [n01(bb.mouth[0]), n01(bb.mouth[1])] : undefined,
        anchor: bb.anchor && bb.anchor.length >= 2 ? [n01(bb.anchor[0]), n01(bb.anchor[1])] : undefined,
      };
    }
    const keepClear = (j.keepClear ?? []).filter((b) => Array.isArray(b) && b.length >= 4).map((b) => [n01(b[0]), n01(b[1]), n01(b[2]), n01(b[3])]);
    return { anchors, keepClear };
  } catch (e) { log(`vision FAILED: ${e instanceof Error ? e.message : e}`); return { anchors: {}, keepClear: [] }; }
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

function run(cmd: string, args: string[], log: Logger, capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => { if (capture) out += d.toString(); else log(`${cmd}: ${d.toString().trim()}`); });
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${args[0]} exited ${code}: ${err.slice(-400)}`))));
  });
}

async function probeDur(file: string, log: Logger): Promise<number> {
  const s = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], log, true);
  return Math.max(0.4, parseFloat(s) || 1);
}

async function genImage(prompt: string, refs: string[]): Promise<Buffer> {
  // 4:3 comic panels, optionally conditioned on character-sheet refs (img2img).
  return generateBananaImage({
    prompt,
    aspectRatio: "4:3",
    imageSize: "2K",
    images: refs.map((r) => ({ data: r, mimeType: "image/png" })),
  });
}

/** ElevenLabs v3 Text-to-Dialogue — one or more (text, voice) lines → one mp3. */
async function elevenDialogue(inputs: { text: string; voice_id: string }[]): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue", {
        method: "POST", headers: { "xi-api-key": key as string, "content-type": "application/json" },
        body: JSON.stringify({ model_id: "eleven_v3", inputs }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); if (b.length > 800) return b; lastErr = "tiny audio"; }
      else { lastErr = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`; if (res.status < 500 && res.status !== 429) break; }
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`elevenDialogue failed: ${lastErr}`);
}

/* ------------------------------ storyboard ----------------------------- */

function storyPrompt(brief: MotionComicBrief, nPanels: number): string {
  const facts = brief.facts ? `\nSOURCE MATERIAL (stay accurate; this is a REAL story):\n${brief.facts}\n` : "";
  const cast = ROSTER.map((r) => `  ${r.id}  — ${r.name} (${r.g}): ${r.note}`).join("\n");
  return (
    `You are the writer + director of a COMIC-BOOK short. Topic: ${brief.topic}${facts}\n` +
    `Write a genuinely GOOD, COHERENT story across exactly ${nPanels} panels with a real dramatic arc: a strong hook, ` +
    `rising tension, a turn, and a resonant ending. It is narrated: a NARRATOR carries the through-line in vivid prose, and ` +
    `CHARACTERS speak short, in-scene lines that will appear as comic SPEECH BUBBLES. Make every panel advance the story.\n\n` +
    `Cast the narrator + each character to ONE voice from this ElevenLabs roster (return the ID string):\n${cast}\n\n` +
    `Output STRICT JSON only:\n{\n` +
    `  "title":"...", "logline":"one line",\n` +
    `  "narratorVoiceId":"<roster id — the storyteller unless a better fit>",\n` +
    `  "characters":[ { "id":"<short_slug>", "name":"...", "voiceId":"<roster id>",\n` +
    `     "look":"<HIGHLY specific, reusable visual: era, age, build, face, hair, exact clothing, distinguishing marks — enough to redraw identically every panel>" } ],\n` +
    `  "panels":[ {\n` +
    `     "scene":"<full PANEL art description: setting, who is in frame + what they DO, emotion, lighting, composed for a 4:3 comic box. NO text/bubbles in the art.>",\n` +
    `     "characters":["<ids visible in THIS panel; [] for an establishing/object panel>"],\n` +
    `     "shot":"wide|medium|close",\n` +
    `     "lines":[ {"speaker":"narrator | <character id>","text":"<the spoken line. Character lines MUST be short (<=12 words) — they become speech bubbles. You MAY prepend ONE ElevenLabs v3 emotion tag in brackets, e.g. [tense], [whispers], [grim], for the VOICE only.>"} ]\n` +
    `  } ]\n}\n` +
    `Rules: 2-4 named characters. Each panel has 1-3 lines, usually a narrator beat plus at most one or two short character bubbles. Vary shots. Return ONLY the JSON.`
  );
}

function castVoice(id: string | undefined, fallbackGender: string): string {
  if (id && VALID_IDS.has(id)) return id;
  return ROSTER.find((r) => r.g === fallbackGender)?.id ?? DEFAULT_NARRATOR;
}

function normalizePlan(raw: Plan, log: Logger): Plan {
  const narratorVoiceId = castVoice(raw.narratorVoiceId, "male");
  const characters = (raw.characters ?? []).slice(0, 4).map((c, i) => ({
    id: c.id || `char${i}`, name: c.name || `Character ${i + 1}`, look: c.look || "a person",
    voiceId: castVoice(c.voiceId, i % 2 ? "female" : "male"),
  }));
  const ids = new Set(characters.map((c) => c.id));
  const panels = (raw.panels ?? []).map((p) => ({
    scene: p.scene || "a dramatic scene",
    characters: (p.characters ?? []).filter((id) => ids.has(id)),
    shot: ["wide", "medium", "close"].includes(p.shot) ? p.shot : "medium",
    lines: (p.lines ?? []).filter((l) => l.text?.trim()).slice(0, 3),
  })).filter((p) => p.lines.length);
  log(`plan: "${raw.title}" — ${characters.length} chars, ${panels.length} panels`);
  return { title: raw.title || "Untitled", logline: raw.logline || "", narratorVoiceId, characters, panels };
}

/* -------------------------------- main --------------------------------- */

export async function castMotionComic(args: { brief: MotionComicBrief; runDir: string; outPath: string; log?: Logger }): Promise<MotionComicResult> {
  const log = args.log ?? (() => {});
  const brief = args.brief;
  const W = brief.width ?? 1920, H = brief.height ?? Math.round((brief.width ?? 1920) * 9 / 16);
  const style = brief.style ?? DEFAULT_STYLE;
  await mkdir(args.runDir, { recursive: true });
  const rd = (f: string) => join(args.runDir, f);

  // 1. STORYBOARD (cached)
  let plan: Plan;
  if (existsSync(rd("plan.json"))) { plan = JSON.parse(await readFile(rd("plan.json"), "utf8")); log("plan: cached"); }
  else {
    const nPanels = Math.max(4, Math.min(12, brief.panels ?? 8));
    const raw = await geminiJsonPro<Plan>({ prompt: storyPrompt(brief, nPanels), maxTokens: 14000, temperature: 0.85, log });
    plan = normalizePlan(raw, log);
    await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
  }
  const voiceOf = (s: string) => s === "narrator" ? plan.narratorVoiceId : (plan.characters.find((c) => c.id === s)?.voiceId ?? plan.narratorVoiceId);

  // 2. CHARACTER SHEETS (cached)
  const sheetB64: Record<string, string> = {};
  await pool(plan.characters, 2, async (c) => {
    const file = rd(`char_${c.id}.png`);
    if (!existsSync(file)) {
      const prompt = `Character MODEL SHEET, ${style} Plain light-grey background. Several views of ONE character — full body, two face close-ups, a hand detail — all the SAME person, for reuse across comic panels.\nCHARACTER (${c.name}): ${c.look}`;
      try { await writeFile(file, await genImage(prompt, [])); log(`char ${c.id} ✓`); }
      catch (e) { log(`char ${c.id} FAILED: ${e instanceof Error ? e.message : e}`); return; }
    }
    sheetB64[c.id] = (await readFile(file)).toString("base64");
  });

  // 3. PANELS (cached) — image-to-image with appearing characters' sheets
  await pool(plan.panels, 3, async (p, i) => {
    const file = rd(`panel_${i}.png`);
    if (existsSync(file)) return;
    const refs = p.characters.map((id) => sheetB64[id]).filter(Boolean);
    const who = p.characters.map((id) => plan.characters.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
    const keep = refs.length ? ` KEEP the character(s) (${who}) IDENTICAL to the reference model-sheet(s): same face, hair, wardrobe, marks.` : "";
    const prompt = `A single ${p.shot.toUpperCase()} COMIC PANEL, ${style} 4:3 cinematic composition.${keep} Compose with some clean, UNCLUTTERED negative space (open sky, a plain wall, or empty ground) beside or above the main figure to leave room for a speech caption, and keep all faces away from the panel's extreme corners.\nPANEL: ${p.scene}`;
    try { await writeFile(file, await genImage(prompt, refs)); log(`panel ${i} ✓ (${p.shot})`); }
    catch (e) { log(`panel ${i} art FAILED: ${e instanceof Error ? e.message : e}`); }
  });

  // 3b. VISION letterer — clear-space anchor + mouth per bubble + keep-clear boxes (cached)
  const vision: PanelVision[] = [];
  await pool(plan.panels, 3, async (p, i) => {
    const hasBubble = p.lines.some((l) => l.speaker !== "narrator");
    const img = rd(`panel_${i}.png`);
    if (!hasBubble || !existsSync(img)) { vision[i] = { anchors: {}, keepClear: [] }; return; }
    const vf = rd(`vision_${i}.json`);
    if (existsSync(vf)) { vision[i] = JSON.parse(await readFile(vf, "utf8")); return; }
    vision[i] = await locatePanelText(img, p.lines, plan.characters, log);
    await writeFile(vf, JSON.stringify(vision[i]));
    log(`vision ${i} ✓ (${Object.keys(vision[i].anchors).length} bubbles, ${vision[i].keepClear.length} keepClear)`);
  });

  // 4. VOICES — per-line (exact timing) + per-panel padded audio + bubble cues
  const TAIL_GAP = 0.6;
  type Bub = { text: string; at: number; mouth?: [number, number]; anchor?: [number, number] };
  const panelDur: number[] = [], panelBubbles: Bub[][] = [], panelAvoid: number[][][] = [], panelHasAudio: boolean[] = [];
  for (let i = 0; i < plan.panels.length; i++) {
    const lines = plan.panels[i].lines;
    let off = 0; const bubbles: Bub[] = []; const lineFiles: string[] = [];
    for (let k = 0; k < lines.length; k++) {
      const lf = rd(`line_${i}_${k}.mp3`);
      if (!existsSync(lf)) {
        try { await writeFile(lf, await elevenDialogue([{ text: lines[k].text.trim(), voice_id: voiceOf(lines[k].speaker) }])); }
        catch (e) { log(`voice ${i}.${k} FAILED: ${e instanceof Error ? e.message : e}`); continue; }
      }
      const d = await probeDur(lf, log);
      if (lines[k].speaker !== "narrator") {
        const a = vision[i]?.anchors[lines[k].speaker];
        bubbles.push({ text: stripTags(lines[k].text), at: off, mouth: a?.mouth, anchor: a?.anchor });
      }
      lineFiles.push(`line_${i}_${k}.mp3`);
      off += d;
    }
    panelAvoid[i] = vision[i]?.keepClear ?? [];
    const dur = off + TAIL_GAP;
    panelBubbles[i] = bubbles; panelDur[i] = dur; panelHasAudio[i] = lineFiles.length > 0;
    // build padded per-panel audio = concat lines, padded with silence to `dur`
    if (lineFiles.length) {
      await writeFile(rd(`alist_${i}.txt`), lineFiles.map((f) => `file '${f}'`).join("\n"));
      await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rd(`alist_${i}.txt`), "-af", "apad", "-t", dur.toFixed(3), "-c:a", "libmp3lame", rd(`panel_${i}.mp3`)], log);
      log(`voice ${i} ✓ (${lineFiles.length} lines, ${dur.toFixed(1)}s, ${bubbles.length} bubble)`);
    }
  }

  // 5. MUSIC (cached, optional)
  let musicPath = "";
  if (brief.music !== false) {
    const file = rd("music.mp3");
    if (existsSync(file)) musicPath = file;
    else {
      try {
        const m = await generateMusic({ provider: "suno", prompt: brief.musicPrompt ?? `Cinematic emotional underscore for "${brief.topic}": orchestral, restrained strings + piano, building, instrumental, no vocals`, title: plan.title, timeoutMs: 240_000 });
        const url = m.url || "";
        if (url) { await run("ffmpeg", ["-y", "-i", url, "-c:a", "libmp3lame", file], log); musicPath = file; log("music ✓"); }
        else log("music: no url in result");
      } catch (e) { log(`music skipped: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // 6. TIMELINE + page render
  const tlPanels = plan.panels.map((p, i) => existsSync(rd(`panel_${i}.png`)) && panelHasAudio[i]
    ? { img: `panel_${i}.png`, dur: panelDur[i], bubbles: panelBubbles[i], avoid: panelAvoid[i] } : null).filter(Boolean);
  await writeFile(rd("timeline.json"), JSON.stringify({ out_w: W, out_h: H, fps: 30, est: PREROLL_MS / 1000, per_page: PER_PAGE, turn: TURN_SEC, title: plan.title, panels: tlPanels }, null, 2));
  const silent = rd("silent.mp4");
  await run("python3", [join("scripts", "mc_page_render.py"), rd("timeline.json"), args.runDir, silent, join(ASSET_DIR, "hand.png")], log);

  // 7. NARRATION = concat per-panel audios, with TURN_SEC of silence at each page
  //    break so the narration stays in sync with the page-turn pauses.
  const present = plan.panels.map((_, i) => i).filter((i) => existsSync(rd(`panel_${i}.png`)) && existsSync(rd(`panel_${i}.mp3`)));
  const nPages = Math.max(1, Math.ceil(present.length / PER_PAGE));
  const pageBase = Math.max(1, Math.ceil(present.length / nPages));   // mirrors the renderer split
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(TURN_SEC), "-c:a", "libmp3lame", rd("turn_sil.mp3")], log);
  const narrParts: string[] = [];
  present.forEach((i, k) => {
    narrParts.push(`file 'panel_${i}.mp3'`);
    if ((k + 1) % pageBase === 0 && k < present.length - 1) narrParts.push(`file 'turn_sil.mp3'`);
  });
  await writeFile(rd("narr_list.txt"), narrParts.join("\n"));
  const narration = rd("narration.mp3");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rd("narr_list.txt"), "-c:a", "libmp3lame", narration], log);

  // 8. MUX narration (delayed by preroll) + ducked music → final
  const pre = `${PREROLL_MS}|${PREROLL_MS}`;
  if (musicPath) {
    await run("ffmpeg", ["-y", "-i", silent, "-i", narration, "-stream_loop", "-1", "-i", musicPath,
      "-filter_complex", `[1:a]adelay=${pre}[n];[2:a]volume=0.15[m];[n][m]amix=inputs=2:duration=longest:dropout_transition=2[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", args.outPath], log);
  } else {
    await run("ffmpeg", ["-y", "-i", silent, "-i", narration, "-filter_complex", `[1:a]adelay=${pre}[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", args.outPath], log);
  }

  const durationMs = Math.round((PREROLL_MS / 1000 + panelDur.reduce((a, b) => a + b, 0)) * 1000);
  log(`DONE: ${args.outPath} (${tlPanels.length} panels, ${(durationMs / 1000).toFixed(1)}s)`);
  return { outPath: args.outPath, title: plan.title, panels: tlPanels.length, durationMs, runDir: args.runDir };
}
