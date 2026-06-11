import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const E = process.env;
const KEY = E.VIDEO_KEY;
const TITLE = E.VIDEO_TITLE || "(unknown)";
const FFMPEG = E.FFMPEG_BIN || "ffmpeg";
const MODEL = "gemini-2.5-flash";
const dir = "scripts/.lofiframes";
mkdirSync(dir, { recursive: true });
const vid = `${dir}/v.mp4`;

if (!existsSync(vid)) {
  const s3 = new S3Client({ region: "auto", endpoint: E.R2_ENDPOINT, credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });
  const obj = await s3.send(new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: KEY }));
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  writeFileSync(vid, buf);
  console.log("downloaded", buf.length, "bytes");
}

// Sample AFTER the 8s deblur-intro (so we judge the steady-state loop, not the
// intentional blurred fade-in). The boomerang loop unit is ~20s, so true loop
// boundaries fall at t≈20,40,60. Compare 19/20/21 vs 39/40/41 for a seam; the
// turnaround is at t≈10,30. Body consistency at 90/130/170.
const TS = [12, 19, 20, 21, 30, 39, 40, 41, 90, 130, 170];
const paths = [];
for (const t of TS) {
  const p = `${dir}/t_${String(t).padStart(3, "0")}.jpg`;
  if (!existsSync(p)) {
    const r = spawnSync(FFMPEG, ["-y", "-ss", String(t), "-i", vid, "-frames:v", "1", "-vf", "scale=512:-1", "-q:v", "4", p], { encoding: "utf8" });
    if (r.status !== 0) continue;
  }
  if (existsSync(p)) paths.push({ t, p });
}
console.log("frames:", paths.map((x) => x.t).join(","));

const parts = [{
  text:
    `You are a senior lofi-channel art director QA'ing a rendered SEAMLESS LOFI LOOP video against the "Lofi Kings" 9/10 golden standard.\n` +
    `Title overlay intended: "${TITLE}".\n` +
    `This is a 3-min test of a video that loops one animated cozy scene under warm lofi music.\n` +
    `NOTE: a short title + channel-name text overlay INTENTIONALLY fades in/out only during the first ~7s (branding). All sampled frames here are AFTER that, so any text you see now would be a real problem. The animated SCENE artwork itself must be text-free.\n` +
    `EXPECTED: (1) a beautiful, on-theme, text-free animated anime/lofi scene; (2) only SUBTLE ambient motion, camera perfectly static (a gentle in/out "breathing" is OK); (3) a SEAMLESS loop — no visible pop/jump where the clip repeats.\n` +
    `I give you frames at timestamps (s): ${paths.map((x) => x.t).join(", ")}. The loop unit is ~20s so true loop boundaries are near t=20 and t=40: compare 19/20/21 against 39/40/41 (should look continuous). 90/130/170 = body consistency.\n` +
    `Judge: (a) scene beauty + on-theme + free of baked-in text/letters IN THE ARTWORK; (b) any visible loop seam/pop (compare the 19/20/21 group to the 39/40/41 group — a real seam shows a sudden jump in snow/rain pattern, brightness, or position); (c) camera stability; (d) overall vs golden lofi.\n` +
    `Return STRICT JSON {"score_out_of_10":number,"reaches_80pct_golden":boolean,"scene":string,"title_overlay":string,"loop_seam":string,"biggest_gap":string,"baked_in_text":boolean}.`,
}];
for (const { t, p } of paths) {
  parts.push({ text: `\n[t=${t}s]` });
  parts.push({ inline_data: { mime_type: "image/jpeg", data: readFileSync(p).toString("base64") } });
}

let txt = "";
for (let attempt = 0; attempt < 5; attempt++) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${E.GEMINI_API_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }),
  });
  const j = await res.json();
  if (j?.candidates?.[0]) { txt = j.candidates[0].content.parts.map((p) => p.text).join(""); break; }
  const code = j?.error?.code;
  console.log(`attempt ${attempt + 1}: ${j?.error?.status || "no candidate"} (${code})`);
  if (code !== 503 && code !== 429) { txt = JSON.stringify(j).slice(0, 400); break; }
  await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
}
console.log("=== VISION VERDICT ===");
console.log(txt || "(no verdict)");
