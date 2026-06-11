/**
 * Lofi thumbnail generator — applies the stoic thumbnail module's claude_flux
 * logic (TEXT-FREE fal flux-pro base art → clean overlay) using the repo's
 * lofi-ambient style (cozy art, cyan accent), customized for "Drift & Study".
 * 3 catchy variants → R2 → presigned links. Base art on fal (cloud); the text
 * overlay is a trivial ffmpeg image composite.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";

const E = process.env;
const FAL = E.FAL_KEY;
const FFMPEG = E.FFMPEG_BIN || "ffmpeg";
const dir = "scripts/.thumbs"; mkdirSync(dir, { recursive: true });
// Copy the font next to the output so the filtergraph can reference it with a
// COLON-FREE relative path (a drive colon "C:" breaks drawtext fontfile parsing).
copyFileSync("C:/Windows/Fonts/arialbd.ttf", `${dir}/font.ttf`);
const FONT = `${dir}/font.ttf`; // forward slashes, no colon
const s3 = new S3Client({ region: "auto", endpoint: E.R2_ENDPOINT, credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });

// Shared TEXT-FREE lofi art suffix (mirrors THUMBNAIL_STYLES["lofi-ambient"] + TEXT_FREE_SUFFIX).
const TF = "Cozy hand-painted anime/lofi illustration, soft cel shading, warm ambient glow, " +
  "rich atmospheric depth, beautiful highly detailed background, cinematic lighting, gentle bokeh. " +
  "Fill the frame with the scene. NO people, NO text, NO letters, NO numbers, NO watermark, NO logo.";
const ACCENT = "0x2EE6FF"; // lofi-ambient accent

const concepts = [
  { id: "diner", title: "Late Night Diner", prompt:
    `A warm-lit quiet city diner late at night seen through a rain-streaked window, glowing neon ` +
    `reflections on wet streets, a steaming coffee cup, moody deep-blue night with cozy amber interior glow. ${TF}` },
  { id: "train", title: "Midnight Train", prompt:
    `The view from inside a cozy train carriage at night, a snowy city skyline drifting past the large ` +
    `window, warm lamp glow inside, soft falling snow, nostalgic and calm, blue-and-amber palette. ${TF}` },
  { id: "desk", title: "Golden Hour Study", prompt:
    `A cozy bedroom study desk at golden-hour sunset by a window, an open notebook and a steaming mug, ` +
    `potted plants, string lights, soft warm bokeh and dust motes, amber and gentle pink tones. ${TF}` },
];

const CHANNEL = "DRIFT & STUDY";
const W = 1280, H = 720;
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
const links = [];

for (const c of concepts) {
  // 1) TEXT-FREE base art via fal flux-pro (cloud). Cached so re-runs of the
  //    overlay don't re-spend the generation.
  const base = `${dir}/${c.id}_base.jpg`;
  if (!existsSync(base)) {
    const r = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
      method: "POST", headers: { Authorization: `Key ${FAL}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: c.prompt, image_size: { width: 1344, height: 768 }, num_images: 1, output_format: "jpeg", safety_tolerance: "5" }),
    });
    const j = await r.json();
    const url = j?.images?.[0]?.url;
    if (!url) { console.error(c.id, "NO IMAGE:", JSON.stringify(j).slice(0, 200)); continue; }
    writeFileSync(base, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }

  // 2) Clean lofi overlay: subtle bottom scrim for legibility + title (white, soft
  //    border/shadow, lower-left) + cyan accent underline + small channel tag.
  const fsT = Math.round(H * 0.115), fsTag = Math.round(H * 0.040);
  const x = Math.round(W * 0.055);
  const titleY = Math.round(H * 0.63), tagY = Math.round(H * 0.84);
  const underlineY = Math.round(H * 0.63 + fsT * 1.12);
  const out = `${dir}/${c.id}.jpg`;
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
    // soft dark scrim on the lower portion (gentle, not boxy)
    `drawbox=x=0:y=${Math.round(H * 0.5)}:w=${W}:h=${Math.round(H * 0.5)}:color=black@0.28:t=fill`,
    // cyan accent underline bar
    `drawbox=x=${x}:y=${underlineY}:w=${Math.round(W * 0.22)}:h=${Math.max(4, Math.round(H * 0.010))}:color=${ACCENT}@0.95:t=fill`,
    // title
    `drawtext=fontfile=${FONT}:text='${esc(c.title)}':fontcolor=white:fontsize=${fsT}:` +
      `borderw=3:bordercolor=black@0.55:shadowcolor=black@0.5:shadowx=3:shadowy=3:x=${x}:y=${titleY}`,
    // small channel tag (ASCII only — ffmpeg drawtext chokes on some unicode glyphs)
    `drawtext=fontfile=${FONT}:text='${esc(CHANNEL + "  -  lofi to study and relax")}':fontcolor=white@0.9:fontsize=${fsTag}:` +
      `borderw=2:bordercolor=black@0.5:x=${x}:y=${tagY}`,
  ].join(",");
  // Pass the complex filtergraph via a FILE (-filter_script) — Windows mangles
  // long -vf args (spaces/quotes/&) when Node spawns ffmpeg.exe directly.
  const vfFile = `${dir}/${c.id}.vf`;
  writeFileSync(vfFile, vf);
  const rr = spawnSync(FFMPEG, ["-y", "-i", base, "-filter_script:v", vfFile, "-frames:v", "1", "-update", "1", "-q:v", "2", out], { encoding: "utf8" });
  if (rr.status !== 0) { console.error(c.id, "ffmpeg fail:", (rr.stderr || "").slice(-500)); continue; }

  // 3) Upload to R2 + presign a 7-day link.
  const key = `owner/owner_daniel/channel/drift-study-1780962831581/thumbs/${c.id}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: E.R2_BUCKET, Key: key, Body: readFileSync(out), ContentType: "image/jpeg" }));
  const link = await getSignedUrl(s3, new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: key }), { expiresIn: 604800 });
  links.push({ id: c.id, title: c.title, link });
  console.log(`OK ${c.id} (${c.title})`);
}

console.log("\n=== THUMBNAIL LINKS (7-day) ===");
for (const l of links) console.log(`\n[${l.title}]\n${l.link}`);
