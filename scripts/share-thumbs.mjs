// Upload the lab's candidate thumbnails to R2 and print presigned 24h links.
import { putObject } from "../src/lib/storage.ts";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_BUCKET ?? "youtube-studio-ai";

for (let i = 1; i <= 3; i++) {
  const p = join(tmpdir(), "thumblab", `candidate_${i}.jpg`);
  const key = `preview/lofi_thumbs/candidate_${i}.jpg`;
  await putObject(key, await readFile(p), { contentType: "image/jpeg" });
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });
  console.log(`CANDIDATE ${i}: ${url}`);
}
