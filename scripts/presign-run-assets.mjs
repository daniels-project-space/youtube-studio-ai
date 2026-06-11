// Presign final.mp4 + thumbnail.jpg for a run (env: R2_* + RUN_PREFIX).
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const c = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const pre = process.env.RUN_PREFIX;
for (const k of ["final.mp4", "thumbnail.jpg"]) {
  const u = await getSignedUrl(
    c,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET ?? "youtube-studio-ai", Key: pre + k }),
    { expiresIn: 3600 },
  );
  console.log(k + "|" + u);
}
