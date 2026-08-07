// Move the Victor heist stills from VPS nginx into R2 (cloud-native inputs).
// Uploads each still + emits a 7-day presigned GET URL the Salad container can fetch.
import fs from "node:fs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const V = "https://fantastic-roadrunner-485.convex.cloud/api";
const vfind = async (keys) => {
  for (const s of ["cloudflare", "r2"]) {
    const r = await fetch(`${V}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "secrets:listByService", args: { service: s }, format: "json" }) });
    const j = await r.json();
    for (const row of j.value || []) if (keys.includes(row.keyName)) return row.value;
  }
  return null;
};
const ak = await vfind(["R2_ACCESS_KEY_ID"]);
const sk = await vfind(["R2_SECRET_ACCESS_KEY"]);
const ep = await vfind(["R2_ENDPOINT"]);
const bucket = "youtube-studio-ai";
const s3 = new S3Client({ region: "auto", endpoint: ep, credentials: { accessKeyId: ak, secretAccessKey: sk } });

const dir = "/var/www/html/lustig";
const files = ["hook.png", "scene1.png", "scene2.png", "scene3.png", "scene4.png", "scene5.png", "train.png", "scene8_getaway.png"];
const out = {};
for (const f of files) {
  const key = `lustig/stills/${f}`;
  const body = fs.readFileSync(`${dir}/${f}`);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/png" }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 7 * 24 * 3600 });
  out[f] = { key, url };
  console.log("uploaded", key, `(${(body.length / 1e6).toFixed(1)}MB)`);
}
fs.writeFileSync("/tmp/lustig_stills_r2.json", JSON.stringify(out, null, 2));
console.log("\nR2 KEYS:", JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.key]))));
