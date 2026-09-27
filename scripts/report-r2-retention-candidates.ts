import { readFileSync } from "node:fs";
import { classifyUnboundR2Key, ASSET_RETENTION_MS, FINAL_VIDEO_RETENTION_MS } from "../src/lib/r2AssetRetention";

/** Read-only report for observed non-run media families; never grants deletion. */
const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/report-r2-retention-candidates.ts INVENTORY.jsonl");
const now = Date.now();
const groups = new Map<string, { objects: number; bytes: number; ageEligibleObjects: number; ageEligibleBytes: number; samples: string[] }>();
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { bucket?: string; key?: string; size?: number; lastModified?: string };
  if (row.bucket !== "youtube-studio-ai" || typeof row.key !== "string") continue;
  const kind = classifyUnboundR2Key(row.key);
  const group = groups.get(kind) ?? { objects: 0, bytes: 0, ageEligibleObjects: 0, ageEligibleBytes: 0, samples: [] };
  const size = Number.isFinite(row.size) && row.size! >= 0 ? row.size! : 0;
  group.objects++;
  group.bytes += size;
  if (group.samples.length < 5) group.samples.push(row.key);
  const modified = row.lastModified ? Date.parse(row.lastModified) : NaN;
  const minimumAge = kind === "final_video" ? FINAL_VIDEO_RETENTION_MS : ASSET_RETENTION_MS;
  if (kind !== "outside" && kind !== "evidence" && Number.isFinite(modified) && modified <= now - minimumAge) {
    group.ageEligibleObjects++;
    group.ageEligibleBytes += size;
  }
  groups.set(kind, group);
}
console.log(JSON.stringify({
  note: "Read-only age candidates. Unbound families require an authoritative ownership/reference check before deletion.",
  generatedAt: new Date(now).toISOString(),
  groups: Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b))),
}, null, 2));
