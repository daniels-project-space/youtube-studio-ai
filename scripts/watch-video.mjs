import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const E = process.env;
const KEY = E.VIDEO_KEY;
const TITLE = E.VIDEO_TITLE || "(unknown)";
const TOPIC = E.VIDEO_TOPIC || "(unknown)";
const FFMPEG = E.FFMPEG_BIN || "ffmpeg";
const MODEL = "gemini-2.5-flash";

const dir = "scripts/.frames";
const STEP = 4;
mkdirSync(dir, { recursive: true });
let frames = readdirSync(dir).filter((f) => f.startsWith("f_") && f.endsWith(".jpg")).sort();

if (frames.length === 0) {
  // 1. download
  const s3 = new S3Client({ region: "auto", endpoint: E.R2_ENDPOINT, credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });
  const obj = await s3.send(new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: KEY }));
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  const vid = `${dir}/video.mp4`;
  writeFileSync(vid, buf);
  console.log("downloaded", buf.length, "bytes");
  // 2. sample a frame every STEP seconds, scaled to 512w
  const r = spawnSync(FFMPEG, ["-y", "-i", vid, "-vf", `fps=1/${STEP},scale=512:-1`, "-q:v", "4", `${dir}/f_%03d.jpg`], { encoding: "utf8" });
  if (r.status !== 0) { console.error("ffmpeg failed:", (r.stderr || "").slice(-600)); process.exit(1); }
  frames = readdirSync(dir).filter((f) => f.startsWith("f_") && f.endsWith(".jpg")).sort();
}
console.log("frames:", frames.length, "(every", STEP, "s)");

// 3. build Gemini request — interleave timestamp text + each frame image
const parts = [{
  text:
    `You are a meticulous QA reviewer WATCHING a rendered YouTube video end-to-end to catch production defects.\n\n` +
    `VIDEO INTENT:\n- Title: "${TITLE}"\n- Topic: "${TOPIC}"\n- A ~3.7 min narrated Stoic-philosophy video.\n` +
    `EXPECTED STRUCTURE: (1) an opening TITLE CARD showing the title text; (2) a body where the on-screen ` +
    `stock footage is RELEVANT to the narration about Stoic universal love, with occasional readable QUOTE overlays; ` +
    `(3) a closing OUTRO card with a short sign-off line.\n\n` +
    `I will give you frames sampled every ${STEP} seconds IN ORDER (each labeled with its timestamp). Watch the whole ` +
    `sequence as a film and find EVERY concrete defect, e.g.: missing or blank/letter-only TITLE card; blank/empty/` +
    `text-less OUTRO card; black/gray/frozen/empty frames; footage clearly IRRELEVANT to Stoic universal love; the ` +
    `SAME clip repeated back-to-back; jarring or random inserts that don't belong; quote/text overlays that are ` +
    `cut off, overlapping, unreadable, misspelled, or shown with no related context; caption problems; letterbox/` +
    `aspect/black-bar issues; abrupt or broken transitions; anything that looks wrong, random, or unfinished.\n\n` +
    `Be specific and exhaustive. Return STRICT JSON: {"defects":[{"t":"<timestamp(s)>","severity":"critical|major|minor","issue":"..."}],"counts":{"critical":n,"major":n,"minor":n},"summary":"...","verdict":"pass|fail"}.`,
}];
frames.forEach((f, i) => {
  parts.push({ text: `t=${i * STEP}s` });
  parts.push({ inlineData: { mimeType: "image/jpeg", data: readFileSync(`${dir}/${f}`).toString("base64") } });
});

const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: 4000 } });
const models = [MODEL, "gemini-2.0-flash", "gemini-flash-latest"];
let text = "";
outer: for (const m of models) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${E.GEMINI_API_KEY}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    const j = await res.json();
    if (res.ok) { text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? ""; console.log(`(model=${m}, attempt=${attempt})`); break outer; }
    const code = j.error?.code;
    console.error(`model=${m} attempt=${attempt} -> ${code} ${j.error?.status || ""}`);
    if (code === 503 || code === 429) { await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); continue; }
    break; // non-retryable -> try next model
  }
}
if (!text) { console.error("all gemini attempts failed"); process.exit(1); }
console.log("=== GEMINI AUDIT ===");
console.log(text);
