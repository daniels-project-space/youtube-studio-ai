/** Read-only, complete ListObjectsV2 inventory for the exact Studio bucket. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap";
import { assertYouTubeStudioR2Bucket } from "../src/lib/r2AssetRetention";
import { listObjectRecords } from "../src/lib/storage";

const output = process.argv[2];
if (!output) throw new Error("Usage: tsx scripts/capture-studio-r2-inventory.ts INVENTORY.jsonl");
async function main(): Promise<void> {
  await bootstrapSecrets(() => {}, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] });
  const bucket = assertYouTubeStudioR2Bucket(process.env.R2_BUCKET);
  const objects = await listObjectRecords("", bucket);
  if (objects.some((object) => !object.key || !object.lastModified || !object.etag || object.size === undefined)) {
    throw new Error("R2 inventory has an incomplete object identity");
  }
  const rows = objects.map((object) => ({ bucket, key: object.key, size: object.size!,
    lastModified: object.lastModified!.toISOString(), etag: object.etag! }));
  if (new Set(rows.map((row) => row.key)).size !== rows.length) throw new Error("R2 listing duplicated an object");
  writeFileSync(resolve(output), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ bucket, objects: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0) }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
