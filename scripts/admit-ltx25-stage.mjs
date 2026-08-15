#!/usr/bin/env node
import crypto from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const MODEL = "Lightricks/LTX-2.5";
const REVISION = "ce298b1259d61ce6c87e05154b9ad339b16f32a0";
const expected = [
  ["ltx-transformer", "diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors", "31eb3cad89b9e54e99dd3baf286f70825ac4f6c660a70d9184d895be76d7bff4", 42018190584],
  ["ltx-text-encoder", "text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors", "1c647a94c0e902fb87f9a403cbca36a8b6d8e5867094442df1b41ae557cfd1c6", 26263860594],
  ["ltx-video-vae", "vae/ltx-2.5-video-vae-bf16.safetensors", "847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3", 1472223346],
  ["ltx-audio-vae", "vae/ltx-2.5-audio-vae-bf16.safetensors", "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5", 364866540],
  ["ltx-spatial-upscaler", "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8", 995778752],
];
const receiptKey = process.argv[2];
if (!/^novita\/staging\/ltx-2\.5-[a-f0-9]{24}\.json$/.test(receiptKey || "")) throw new Error("pass the exact LTX staging receipt key");
for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) if (!process.env[key]) throw new Error(`${key} is required`);
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const client = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const receiptObject = await client.send(new GetObjectCommand({ Bucket: bucket, Key: receiptKey }));
const receipt = JSON.parse(await receiptObject.Body.transformToString());
if (receipt.contract !== "ltx-2.5-volume-stage/v1" || receipt.ok !== true || receipt.model !== MODEL || receipt.revision !== REVISION || JSON.stringify(receipt.files) !== JSON.stringify(expected)) {
  throw new Error("staging receipt does not attest the exact official LTX 2.5 file set");
}
const models = expected.map(([id, relative, manifestSha256, sizeBytes]) => ({
  id, kind: "file", repository: MODEL, revision: REVISION, manifestSha256, sizeBytes,
  sourcePath: `models/ltx-2.5/${REVISION}/${relative}`,
  localPath: `ltx-2.5/${relative}`,
}));
const bytes = Buffer.from(JSON.stringify(models), "utf8");
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const key = `novita/model-manifests/ltx-2.5-${REVISION}-${sha256}.json`;
try {
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
} catch (error) {
  if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/json", Metadata: { "source-receipt": receiptKey, "model-revision": REVISION } }));
}
console.log(JSON.stringify({ receiptKey, modelManifestKey: key, modelManifestSha256: sha256, modelCount: models.length }));
