/**
 * Faithful standalone harness for the DEPLOYED watchRender (src/lib/renderWatch.ts):
 * same dense title/outro sampling, same prompt, same critical/major fail-gate. Run it
 * on any final.mp4 to validate detection. Usage: env VIDEO_KEY/VIDEO_TITLE/VIDEO_TOPIC.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const E = process.env;
const FFMPEG = E.FFMPEG_BIN || "ffmpeg";
const FFPROBE = E.FFPROBE_BIN || "ffprobe";
const dir = "scripts/.frames";
try { rmSync(dir, { recursive: true, force: true }); } catch {}
mkdirSync(dir, { recursive: true });

// download
const s3 = new S3Client({ region: "auto", endpoint: E.R2_ENDPOINT, credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });
const obj = await s3.send(new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: E.VIDEO_KEY }));
const vid = `${dir}/v.mp4`;
writeFileSync(vid, Buffer.from(await obj.Body.transformToByteArray()));

// duration
const pr = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", vid], { encoding: "utf8" });
const durationSec = Math.round(parseFloat((pr.stdout || "0").trim()) || 0);
console.log("duration:", durationSec, "s");

// --- mirror renderWatch.sampleTimes (dense title + outro windows) ---
const dense = (from, to, n) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / (n + 1));
const first = Math.min(0.6, durationSec / 2);
const last = Math.max(first, durationSec - 0.8);
const titleWindow = dense(0.6, Math.min(6, durationSec * 0.4), 4);
const outroWindow = dense(Math.max(first, durationSec - 5), last, 3);
const mid = [];
for (let t = 6; t < durationSec - 5; t += 9) mid.push(t);
let times = Array.from(new Set([first, ...titleWindow, ...mid, ...outroWindow, last].map((t) => Number(t.toFixed(1))))).filter((t) => t >= 0 && t <= durationSec).sort((a, b) => a - b);

// extract a frame at each timestamp
const frames = [];
times.forEach((t, i) => {
  const f = `${dir}/f_${String(i).padStart(3, "0")}.jpg`;
  const r = spawnSync(FFMPEG, ["-y", "-ss", String(t), "-i", vid, "-frames:v", "1", "-vf", "scale=512:-1", "-q:v", "4", f], { encoding: "utf8" });
  if (r.status === 0) frames.push({ t, f });
});
console.log("frames:", frames.length, "@", times.join(","));

// --- mirror renderWatch prompt ---
const DEFAULT_STRUCTURE = "(1) an opening TITLE CARD that clearly shows the video's title text; (2) a body where on-screen footage is relevant to the narration, with any quote/chapter overlays fully readable (never hidden behind images) and correctly ordered/numbered; (3) a SINGLE closing OUTRO card near the very end with a sign-off. The outro must NOT appear mid-video, and no chapter/segment may be missing or duplicated.";
const parts = [{ text:
  `You are a meticulous video QA reviewer WATCHING a rendered video end-to-end to catch PRODUCTION defects (not content opinions).\n\nINTENT:\n- Title: "${E.VIDEO_TITLE}"\n- Topic: "${E.VIDEO_TOPIC}"\n- A title card WAS intended at the start.\n- Chapter cards are used — verify they are present, readable, and numbered in order.\nEXPECTED STRUCTURE: ${DEFAULT_STRUCTURE}\n\nThe images are frames sampled IN CHRONOLOGICAL ORDER at these timestamps (seconds): ${frames.map((x) => x.t).join(", ")}. The FIRST frame is ~the start (title card) and the LAST is ~the end (outro card). Watch the sequence as ONE film and report EVERY concrete defect: missing/blank title card; outro card appearing mid-video, missing, or empty/textless; black/gray/frozen/empty frames; footage clearly irrelevant to the topic; the SAME clip repeated back-to-back; random/jarring inserts; overlays/captions cut off, hidden behind images, overlapping, unreadable, or mis-timed; missing/duplicated/mis-numbered chapters; broken/abrupt transitions; anything unfinished or wrong.\n\nSEVERITY: critical = breaks the video or a core structural element (missing title card, mid-video or absent outro, missing chapter, black screen, wrong-topic footage throughout). major = clearly wrong but localized. minor = cosmetic. Cite timestamps. Return STRICT JSON {"defects":[{"tSec":number,"severity":"critical|major|minor","category":string,"issue":string}],"summary":string}.` }];
frames.forEach((x) => { parts.push({ text: `t=${x.t}s` }); parts.push({ inlineData: { mimeType: "image/jpeg", data: readFileSync(x.f).toString("base64") } }); });

const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: 4000 } });
let parsed = null;
for (const m of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${E.GEMINI_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const j = await res.json();
    if (res.ok) { try { parsed = JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join("")); } catch { parsed = null; } break; }
    if ((j.error?.code === 503 || j.error?.code === 429)) { await new Promise((r) => setTimeout(r, 8000 * (a + 1))); continue; }
    break;
  }
  if (parsed) break;
}
if (!parsed) { console.error("gemini failed"); process.exit(1); }
const defects = (parsed.defects || []).filter((d) => d && d.severity && d.issue);
const crit = defects.filter((d) => d.severity === "critical").length;
const major = defects.filter((d) => d.severity === "major").length;
const verdict = crit >= 1 || major >= 2 ? "FAIL" : "PASS";
console.log("=== VERDICT:", verdict, `(critical ${crit}, major ${major}) ===`);
for (const d of defects) console.log(` - [${d.severity}] @${d.tSec}s: ${d.issue}`);
console.log("summary:", parsed.summary);
