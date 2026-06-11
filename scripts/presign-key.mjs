// Presign one R2 object (env: R2_* + KEY). Prints the URL.
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
const u = await getSignedUrl(
  c,
  new GetObjectCommand({ Bucket: process.env.R2_BUCKET ?? "youtube-studio-ai", Key: process.env.KEY }),
  { expiresIn: 3600 },
);
console.log(u);
