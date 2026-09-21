/** Dedicated owner evidence bucket. Never fall back to the legacy public bucket. */
export function getStudioPrivateBucket(): string {
  const bucket = process.env.R2_PRIVATE_BUCKET ?? "youtube-studio-ai-private";
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket) ||
    bucket === "youtube-studio-ai" || bucket === process.env.R2_BUCKET?.trim()) {
    throw new Error("Invalid private Studio storage configuration");
  }
  return bucket;
}
