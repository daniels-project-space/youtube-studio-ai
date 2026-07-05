// WHITEBOARD SYNC v2 — LAYERED build. Gemini designs each panel as a stack of
// LAYERS (composed art scenes with NO baked text + separate label layers), each
// with a verbatim narration cue + a box. We generate style-locked art (pure
// white, no text), TTS the narration, force-align (local Whisper), and emit
// timeline.json with per-layer cue timestamps. Topic: United Fruit Company.
import { join } from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { geminiJsonPro } from "../src/lib/gemini.ts";
import { synthNarration } from "../src/lib/tts.ts";
import { spawnSync } from "node:child_process";

const log = (m) => console.error(`[sync] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"] });

const DIR = join(process.cwd(), "output", "whiteboard", "banana-sync2");
const PUB = "/var/www/html/whiteboard/banana-sync2";
await mkdir(DIR, { recursive: true });
await mkdir(PUB, { recursive: true }).catch(() => {});

/* ---------- 1. LAYERED STORYBOARD + NARRATION ---------- */
const FACTS =
  "GROUNDING FACTS (accurate, use only these): The United Fruit Company (UFC, founded 1899, later Chiquita) dominated " +
  "the banana trade across Central America. Writer O. Henry coined 'banana republic' in 1904 for nations whose economies " +
  "and governments UFC controlled. UFC owned vast land, the railroads and ports, and bought politicians. In 1928 in " +
  "Ciénaga, Colombia, the army — protecting UFC interests — opened fire on striking banana workers (the Banana Massacre), " +
  "killing into the hundreds. UFC hired PR pioneer Edward Bernays to shape U.S. opinion. In 1954, after Guatemala's " +
  "elected president Jacobo Árbenz passed land reform threatening UFC's idle land, the CIA backed a coup (PBSuccess) that " +
  "overthrew him. In 2007 successor Chiquita pleaded guilty and paid a $25 million fine for funneling about $1.7 million " +
  "to a Colombian paramilitary death squad (the AUC), a designated terrorist group.";

const CONTRACT =
  `Design a punchy, INFORMATIVE 60-second WHITEBOARD explainer about CHIQUITA — the banana company formerly called the ` +
  `United Fruit Company — and the BANANA REPUBLICS it created, and why it is considered evil. The very first sentence MUST ` +
  `explicitly name it: "the banana company United Fruit — today known as Chiquita" and use the phrase "banana republic". ${FACTS}\n\n` +
  `Think like a motion-designer. Each panel is a STACK OF LAYERS drawn one at a time on a whiteboard, building an argument.\n` +
  `Output STRICT JSON: {"title":"...","panels":[ { "narration":"<~2 spoken sentences, ~10s, end with a small beat so the ` +
  `image can breathe>", "layers":[ ` +
  `{"kind":"art","draw":"<a COMPOSED, designed line-art SCENE for this beat — describe the objects AND how they relate ` +
  `(a hand gripping a map, a soldier firing at workers who fall, a politician with strings like a puppet). NO text/words in ` +
  `the art.>","cue":"<verbatim phrase from THIS narration marking when to start drawing it>","box":[x,y,w,h]} , ` +
  `{"kind":"label","text":"<EXACT short words or number to hand-letter, e.g. 1928 or $1.7M or \\"BANANA REPUBLIC\\">",` +
  `"cue":"<verbatim phrase>","box":[x,y,w,h],"color":"black|red"} ]} ]}\n\n` +
  `RULES:\n- EXACTLY 6 panels. Each panel ~2 full sentences (~25 words). ~150 words TOTAL. Plain spoken narration, NO audio tags. NEVER stop before panel 6.\n` +
  `- Each panel: 1-2 art layers (composed scenes) + 1-2 label layers. List layers IN THE ORDER their cue appears in the narration. Every label MUST have non-empty "text".\n` +
  `- Every "cue" MUST be an exact substring of that panel's narration. Distinctive phrases. Don't put the last layer's cue at the very END of the narration (leave a trailing clause so the image can breathe).\n` +
  `- box = [x,y,w,h] in 0..1 on a 16:9 board. A persistent TITLE HEADER lives in the top strip, so ALL layer boxes (art AND ` +
  `labels) MUST have y >= 0.17 (never put anything in the top 0.16 of the board). Art scenes are large (e.g. [0.07,0.18,0.86,0.64]); ` +
  `labels are small, placed where they belong (a year at top-left of the content area, a money figure beside the relevant art). Keep labels clear of the art's busiest area.\n` +
  `- ART HAS NO TEXT. All words/numbers are label layers (so they stay perfectly legible).\n` +
  `- color:"red" for money/danger emphasis ($ figures, blood, the massacre), else black.\n` +
  `- Be accurate. EXACTLY one panel per beat below — DO NOT STOP EARLY:\n` +
  `  P1: the banana company United Fruit (today CHIQUITA), founded 1899, owns the land, railroads, ports and politicians of Central America.\n` +
  `  P2: writer O. Henry coins 'banana republic' (1904) for these captive nations.\n` +
  `  P3: the 1928 Banana Massacre — the army guns down striking banana workers in Colombia.\n` +
  `  P4: propaganda man Edward Bernays + the 1954 CIA coup that overthrows Guatemala's elected Árbenz.\n` +
  `  P5: 2007 — successor Chiquita pleads guilty, a $25M fine for ~$1.7M paid to the AUC death squad.\n` +
  `  P6: verdict — a company that rewrote whole nations for profit.`;

const clampBox = (b) => (Array.isArray(b) && b.length === 4 ? b.map(Number) : [0.1, 0.15, 0.8, 0.7]);
const normalize = (raw) => (raw.panels ?? []).map((p, i) => ({
  idx: i,
  narration: String(p.narration ?? "").trim(),
  layers: (p.layers ?? []).map((l, j) => ({
    j,
    kind: l.kind === "label" ? "label" : "art",
    draw: l.draw ? String(l.draw).trim() : undefined,
    text: l.text ? String(l.text).trim() : undefined,
    color: l.color === "red" ? "red" : "black",
    cue: String(l.cue ?? "").trim(),
    box: clampBox(l.box),
  })).filter((l) => (l.kind === "art" && l.draw) || (l.kind === "label" && l.text)),
}));
log("designing layered storyboard (Gemini Pro)…");
let planRaw, panels, fullText;
for (let attempt = 0; attempt < 3; attempt++) {
  const extra = attempt ? `\n\nYOUR PREVIOUS ATTEMPT WAS TOO SHORT. Output EXACTLY 6 panels and ~150 words, covering ALL SIX beats through the 2007 Chiquita payments and a final verdict. Do not stop early.` : "";
  planRaw = await geminiJsonPro({ prompt: CONTRACT + extra, maxTokens: 8000, temperature: 0.55 });
  panels = normalize(planRaw);
  panels.forEach((p, i) => (p.idx = i));
  fullText = panels.map((p) => p.narration).join(" ");
  const wc = fullText.split(/\s+/).filter(Boolean).length;
  log(`plan attempt ${attempt + 1}: ${panels.length} panels, ${wc} words, ${panels.reduce((n, p) => n + p.layers.length, 0)} layers`);
  if (panels.length >= 6 && wc >= 130) break;
}
await writeFile(join(DIR, "plan.json"), JSON.stringify({ title: planRaw.title, panels, fullText }, null, 2));

/* ---------- 2. ART LAYERS (composed scenes, style-locked, no text) ---------- */
const REF = join(process.cwd(), "src", "assets", "whiteboard", "history_ref.png");
const refB64 = (await readFile(REF)).toString("base64");
const MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
async function styledScene(prompt) {
  const key = process.env.GEMINI_API_KEY;
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: refB64 } }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } },
        }),
        signal: AbortSignal.timeout(180000),
      });
      const j = await res.json();
      const part = (j?.candidates?.[0]?.content?.parts ?? []).find((x) => x?.inlineData?.data);
      if (part) return Buffer.from(part.inlineData.data, "base64");
      log(`scene ${model}: ${(j?.error?.message ?? "no image").slice(0, 80)}`);
    } catch (e) { log(`scene ${model} err: ${String(e.message).slice(0, 80)}`); }
  }
  throw new Error("styled scene failed");
}
const artJobs = [];
for (const p of panels) for (const l of p.layers) if (l.kind === "art") artJobs.push({ p, l });
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}
await pool(artJobs, 3, async ({ p, l }) => {
  const prompt =
    `A single COMPOSED whiteboard marker line-art SCENE on a PURE WHITE (#ffffff) background, nothing else, filling the frame ` +
    `with a small margin. CRITICAL: match the EXACT clean black marker line-art style and single stroke weight of the REFERENCE ` +
    `image (copy STYLE only). Draw this designed scene: ${l.draw}. The scene illustrates: "${p.narration}". ` +
    `Simple iconic line-art, clear and informative, NOT photorealistic, no shading. Use red for at most one or two accent marks. ` +
    `ABSOLUTELY NO text, NO words, NO numbers, NO letters anywhere. No watermark, pure white background.`;
  const fn = `art_${p.idx}_${l.j}.png`;
  const bytes = await styledScene(prompt);
  await writeFile(join(DIR, fn), bytes);
  await writeFile(join(PUB, fn), bytes).catch(() => {});
  l.art = fn;
  log(`art ${fn} ✓`);
});

/* ---------- 3. NARRATION + WHISPER ALIGNMENT ---------- */
log("TTS (Fish, sleepless_historian)…");
const mp3 = await synthNarration({ text: fullText, voiceId: "sleepless_historian", speed: 0.95 });
await writeFile(join(DIR, "narration.mp3"), Buffer.from(mp3));
await writeFile(join(PUB, "narration.mp3"), Buffer.from(mp3)).catch(() => {});
log("aligning (local Whisper)…");
const wpath = join(DIR, "wwords.json");
const al = spawnSync("python3", ["scripts/whisper_align.py", join(DIR, "narration.mp3"), wpath], { encoding: "utf8" });
if (al.status !== 0) throw new Error("whisper align failed: " + (al.stderr || "").slice(-400));
const wjson = JSON.parse(await readFile(wpath, "utf8"));
log(`whisper: ${wjson.length} words; ends ${wjson.length ? wjson[wjson.length - 1].end : 0}ms`);

/* ---------- 4. cue → ms (align my words to whisper times) ---------- */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const eq = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
const mw = fullText.split(/\s+/).map(norm);
const wn = wjson.map((w) => norm(w.text));
const mwTime = new Array(mw.length).fill(null);
let j2 = 0;
for (let i = 0; i < mw.length; i++) for (let k = j2; k < Math.min(j2 + 6, wjson.length); k++) if (eq(mw[i], wn[k])) { mwTime[i] = wjson[k].start; j2 = k + 1; break; }
const known = mwTime.map((t, i) => ({ t, i })).filter((x) => x.t != null);
for (let i = 0; i < mw.length; i++) {
  if (mwTime[i] != null) continue;
  const prev = [...known].reverse().find((x) => x.i < i), next = known.find((x) => x.i > i);
  mwTime[i] = prev && next ? prev.t + (next.t - prev.t) * ((i - prev.i) / (next.i - prev.i)) : (prev || next || { t: 0 }).t;
}
const audioEnd = wjson.length ? wjson[wjson.length - 1].end : 60000;
let mp = 0;
function cueTimeMs(cue) {
  const cw = cue.split(/\s+/).map(norm).filter(Boolean);
  if (!cw.length) return null;
  for (let i = mp; i < mw.length; i++) if (eq(mw[i], cw[0])) { mp = i + 1; return Math.round(mwTime[i]); }
  return null;
}
const flat = [];
for (const p of panels) for (const l of p.layers) flat.push({ p: p.idx, l });
let last = 0;
for (const f of flat) {
  const t = cueTimeMs(f.l.cue);
  f.cue = t != null ? t : last + 700;
  if (f.cue < last) f.cue = last + 250;
  last = f.cue;
}
const panelStart = {};
for (const p of panels) { const f = flat.find((x) => x.p === p.idx); panelStart[p.idx] = f ? Math.max(0, f.cue - 250) : 0; }
const timeline = {
  title: planRaw.title, header: "CHIQUITA  ·  THE BANANA REPUBLIC", headerBox: [0.14, 0.035, 0.72, 0.092],
  dir: DIR, audio: "narration.mp3", prerollSec: 2.6, fps: 25,
  audioEndMs: audioEnd, tailMs: 1800,
  panels: panels.map((p, i) => ({
    idx: p.idx, startMs: panelStart[p.idx],
    endMs: i + 1 < panels.length ? panelStart[panels[i + 1].idx] : audioEnd + 1800,
    layers: p.layers.map((l) => {
      const f = flat.find((x) => x.p === p.idx && x.l === l);
      return { kind: l.kind, art: l.art, text: l.text, color: l.color, box: l.box, cueStartMs: f.cue };
    }),
  })),
};
await writeFile(join(DIR, "timeline.json"), JSON.stringify(timeline, null, 2));
log("timeline.json written");
console.log(JSON.stringify(timeline.panels.map((p) => ({
  panel: p.idx, span: `${p.startMs}-${p.endMs}`,
  layers: p.layers.map((l) => `${l.kind === "label" ? '"' + l.text + '"' : (l.art || "art")}@${l.cueStartMs}`),
})), null, 2));
