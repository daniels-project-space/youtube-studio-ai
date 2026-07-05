// WHITEBOARD A/B — does a START→END draw-on (blank board → complete drawing) with
// improved scribe prompting render acceptably on Veo 3.1 Lite vs Seedance 1.5?
// Builds a consistent blank/complete pair (Banana + img2img) then renders both.
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { generateBananaImage } from "../src/lib/banana.ts";
import { runCli } from "../src/lib/higgsfield.ts";
import { downloadTo } from "../src/lib/files.ts";

process.env.HIGGSFIELD_LIVE = "1";
const log = (m) => console.error(`[ab] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

const DIR = join(process.cwd(), "output", "whiteboard", "ab");
await mkdir(DIR, { recursive: true });

const firstJob = (raw) =>
  Array.isArray(raw) ? raw[0] || {} : raw && typeof raw === "object" ? (Array.isArray(raw.jobs) && raw.jobs.length ? raw.jobs[0] : raw) : {};
function resultUrl(job) {
  for (const k of ["url", "result_url", "video_url", "output_url", "image_url"]) if (typeof job[k] === "string") return job[k];
  const r = job.results;
  if (r && typeof r === "object")
    for (const v of Object.values(r)) {
      if (typeof v === "string" && v.startsWith("http")) return v;
      if (v && typeof v === "object" && typeof v.url === "string") return v.url;
    }
  for (const ak of ["results", "outputs", "assets"]) {
    const a = job[ak];
    if (Array.isArray(a)) for (const it of a) if (it && typeof it === "object") { const u = it.url || it.result_url || it.video_url || it.image_url; if (typeof u === "string") return u; }
  }
  return undefined;
}

// 1. COMPLETE still — text baked, no hand (the pristine END frame to land on).
const completePrompt =
  `A flat, head-on photo of a clean white dry-erase whiteboard. Drawn on it in bold black dry-erase marker as simple iconic ` +
  `line-art (NOT photorealistic): on the left a samurai in armor holding a katana, then a curved arrow pointing left, on the ` +
  `right a steam-powered warship with a smoke plume. Hand-letter EXACTLY, neat printed capitals, perfectly spelled and legible: ` +
  `"SEVEN CENTURIES" across the top and "1853" under the ship. Use red (#b91c1c) for ONLY the smoke. Generous white margins, ` +
  `nothing else in frame, no hand. Pure marker line-art, no watermark, no UI, no extra words or gibberish.`;
const completePath = join(DIR, "still_complete.png");
await writeFile(completePath, await generateBananaImage({ prompt: completePrompt, aspectRatio: "16:9" }));
log("complete still ✓");

// 2. BLANK start via img2img (same board, erased) + a hand poised to draw.
const blankPath = join(DIR, "still_blank.png");
try {
  const bj = firstJob(
    await runCli([
      "generate", "create", "nano_banana_2",
      "--prompt",
      "Take this exact whiteboard (same framing, same lighting) and ERASE essentially all of the drawing and lettering so the board is nearly blank — keep only a couple of very faint starting marker strokes at the top-left. Add a realistic human hand holding a black dry-erase marker, poised at the top-left, about to begin drawing. Same clean style, no other changes.",
      "--image", completePath,
      "--aspect_ratio", "16:9", "--resolution", "2k",
      "--wait", "--wait-timeout", "10m", "--wait-interval", "5s",
    ]),
  );
  const blankUrl = resultUrl(bj);
  if (!blankUrl) throw new Error("no blank url");
  await downloadTo(blankUrl, blankPath);
  log("blank start still ✓ (img2img)");
} catch (e) {
  log(`img2img blank failed (${e.message}) — text-gen blank fallback`);
  const fb =
    `A flat head-on photo of a clean EMPTY white dry-erase whiteboard, nothing drawn yet, generous white margins. ` +
    `A realistic human hand holding a black dry-erase marker is poised at the top-left, about to start drawing. No text, no drawing.`;
  await writeFile(blankPath, await generateBananaImage({ prompt: fb, aspectRatio: "16:9" }));
  log("blank start still ✓ (text-gen fallback)");
}

const MOTION =
  `Whiteboard scribe animation, hand-drawn explainer style. A human hand holding a black marker DRAWS the illustration onto the ` +
  `whiteboard: black ink strokes appear progressively beneath the marker tip as the hand moves, building up the samurai, the ` +
  `arrow, the warship and the lettering stroke by stroke, and ENDING exactly on the finished drawing. The hand works from the ` +
  `top-left across and down, then lifts away. Locked, perfectly static camera — no zoom, no pan, no shake. The final lines, ` +
  `letters and numbers are crisp, sharp and correctly spelled. Do NOT warp, morph, flicker or redraw existing lines or text. ` +
  `Photoreal hand and marker, clean bright white board.`;

async function render(model, extraArgs, out) {
  const base = ["generate", "create", model, "--prompt", MOTION];
  const tail = ["--wait", "--wait-timeout", "20m", "--wait-interval", "5s"];
  log(`${model}: start→end draw-on…`);
  try {
    const url = resultUrl(firstJob(await runCli([...base, "--start-image", blankPath, "--end-image", completePath, ...extraArgs, ...tail])));
    if (!url) throw new Error("no url");
    await downloadTo(url, out);
    log(`${model} ✓ (start+end) → ${out}`);
    return { model, mode: "start+end", out };
  } catch (e) {
    log(`${model}: start+end rejected (${e.message.slice(0, 120)}) — forward from blank`);
    const url = resultUrl(firstJob(await runCli([...base, "--start-image", blankPath, ...extraArgs, ...tail])));
    if (!url) throw new Error(`${model}: no url (forward)`);
    await downloadTo(url, out);
    log(`${model} ✓ (forward) → ${out}`);
    return { model, mode: "forward", out };
  }
}

const results = [];
results.push(await render("veo3_1_lite", ["--duration", "8", "--aspect_ratio", "16:9"], join(DIR, "veo_lite.mp4")));
results.push(await render("seedance1_5", ["--duration", "8", "--resolution", "720p", "--aspect_ratio", "16:9"], join(DIR, "seedance.mp4")));

console.log(JSON.stringify({ blankPath, completePath, results }, null, 2));
