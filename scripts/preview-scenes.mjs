/**
 * Preview the channel's signature scenes as keyframe STILLS (no full render) so
 * the owner can eyeball the vibe fast. Reads the channel's Style DNA, builds the
 * same flux prompt the keyframes block would, generates each scene via fal
 * flux-pro, saves to the Desktop + uploads to R2 for links.
 * Env: CONVEX_URL, CHANNEL_ID, FAL_KEY, R2_* (optional, for links).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const CONVEX = (process.env.CONVEX_URL ?? "https://astute-camel-689.convex.cloud").replace(/\/$/, "");
const CHANNEL_ID = process.env.CHANNEL_ID ?? "j978et30ex8mksrjs6kpyc7gad88ar0x";
const FAL = process.env.FAL_KEY;
if (!FAL) { console.error("FAL_KEY required"); process.exit(1); }
const dir = "C:/Users/danie/Desktop/ghibli-scenes";
mkdirSync(dir, { recursive: true });

const r = await fetch(`${CONVEX}/api/query`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: "channels:getChannel", args: { channelId: CHANNEL_ID }, format: "json" }),
});
const dna = (await r.json())?.value?.styleDNA;
if (!dna) { console.error("no styleDNA on channel"); process.exit(1); }
const scenes = (dna.signatureScenes ?? []).filter((s) => s?.setting);
console.log(`channel "${dna.recurringSubject?.slice(0,40)}…" — ${scenes.length} signature scenes`);

const s3 = (process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID)
  ? new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } })
  : null;

const links = [];
for (const sc of scenes) {
  const prompt = [
    `${sc.setting}.`,
    dna.composition ? `Composition: ${dna.composition}.` : "",
    dna.colorGrade ? `Art style + color grade: ${dna.colorGrade}.` : "",
    dna.motifs?.length ? `Signature motifs where they naturally fit: ${dna.motifs.join(", ")}.` : "",
    "A single calm, beautifully composed held frame. Painterly atmospheric depth.",
    "NO text, NO letters, NO words, NO logos, NO watermark.",
  ].filter(Boolean).join(" ");

  console.log(`\n[${sc.name}] generating…`);
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
    method: "POST", headers: { Authorization: `Key ${FAL}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_size: { width: 1344, height: 768 }, num_images: 1, output_format: "jpeg", safety_tolerance: "5" }),
  });
  const j = await res.json();
  const url = j?.images?.[0]?.url;
  if (!url) { console.error(`  NO IMAGE:`, JSON.stringify(j).slice(0, 200)); continue; }
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const safe = sc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = `${dir}/${safe}.jpg`;
  writeFileSync(file, bytes);
  console.log(`  saved ${file} (${bytes.length} bytes)`);
  if (s3 && process.env.R2_BUCKET) {
    const key = `owner/owner_daniel/channel/ghibli-preview/${safe}.jpg`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: bytes, ContentType: "image/jpeg" }));
    const link = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: 604800 });
    links.push({ name: sc.name, link });
  }
}
console.log(`\n=== ${scenes.length} scene stills saved to ${dir} ===`);
for (const l of links) console.log(`\n[${l.name}]\n${l.link}`);
