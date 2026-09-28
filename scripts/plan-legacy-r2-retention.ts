/**
 * Read-only reconciliation of a complete Convex production snapshot and exact
 * Studio R2 inventory. This script has no R2 client, copy, or delete imports.
 *
 * Capture the exact live deployment with `convex export --deployment astute-camel-689
 * --path SNAPSHOT.zip` and a Studio R2 ListObjectsV2 inventory. The planner
 * extracts the ZIP into a fresh temporary directory for each run:
 *   tsx scripts/plan-legacy-r2-retention.ts SNAPSHOT.zip INVENTORY.jsonl PLAN.json
 */
import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { planLegacyR2Retention, referencesInDocument, validateLegacyInventory } from "../src/lib/legacyR2RetentionCensus";
import type { ConvexReference, LegacyR2Record } from "../src/lib/legacyR2RetentionCensus";

async function main(): Promise<void> {
const [snapshotArg, inventoryArg, outputArg] = process.argv.slice(2);
if (!snapshotArg || !inventoryArg || !outputArg) {
  throw new Error("Usage: tsx scripts/plan-legacy-r2-retention.ts SNAPSHOT.zip INVENTORY.jsonl PLAN.json");
}
const snapshotPath = resolve(snapshotArg);
const inventoryPath = resolve(inventoryArg);
const outputPath = resolve(outputArg);
if (!snapshotPath.endsWith(".zip") || !statSync(snapshotPath).isFile()) {
  throw new Error("Planner requires one complete Convex snapshot ZIP file");
}
if (outputPath === inventoryPath || outputPath === snapshotPath) {
  throw new Error("Plan output must be separate from source evidence");
}
// A fresh extraction directory prevents a later snapshot from inheriting stale
// table files left by a previous export. ZIP paths are restricted to Convex's
// flat table layout before extraction.
const archiveEntries = execFileSync("unzip", ["-Z1", snapshotPath], { encoding: "utf8" }).trim().split("\n");
if (!archiveEntries.includes("_tables/documents.jsonl") || archiveEntries.some((name) =>
  !/^(?:README\.md|[A-Za-z_][A-Za-z0-9_]*\/(?:documents|generated_schema)\.jsonl|[A-Za-z_][A-Za-z0-9_]*\/)$/u.test(name))) {
  throw new Error("Convex snapshot ZIP has an unexpected or incomplete layout");
}
const snapshotDir = mkdtempSync(join(tmpdir(), "studio-convex-snapshot-"));
try {
execFileSync("unzip", ["-q", snapshotPath, "-d", snapshotDir]);

const expectedTables = [...readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8")
  .matchAll(/^  ([A-Za-z][A-Za-z0-9]*): defineTable\(/gmu)].map((match) => match[1]);
if (expectedTables.length < 80) throw new Error("Studio schema table census is incomplete");
const exportedTables = readdirSync(snapshotDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && statSync(join(snapshotDir, entry.name, "documents.jsonl"), { throwIfNoEntry: false })?.isFile())
  .map((entry) => entry.name).filter((table) => table !== "_tables");
const missingTables = expectedTables.filter((table) => !exportedTables.includes(table));
if (missingTables.length) throw new Error(`Convex snapshot is incomplete: ${missingTables.length} schema tables absent`);

const inventory = readFileSync(inventoryPath, "utf8").split("\n").filter(Boolean)
  .map((line, index) => {
    try { return JSON.parse(line) as LegacyR2Record; }
    catch { throw new Error(`Invalid inventory JSONL at line ${index + 1}`); }
  });
validateLegacyInventory(inventory);
const keys = inventory.map((row) => row.key);
const refs = new Map<string, ConvexReference[]>();
const counts: Record<string, number> = {};
for (const table of exportedTables) {
  counts[table] = 0;
  const file = join(snapshotDir, table, "documents.jsonl");
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    let document: Record<string, unknown>;
    try { document = JSON.parse(line) as Record<string, unknown>; }
    catch { throw new Error(`Invalid Convex JSONL in ${table}`); }
    if (!document || typeof document !== "object" || typeof document._id !== "string") {
      throw new Error(`Invalid Convex document in ${table}`);
    }
    counts[table]++;
    for (const [key, hits] of referencesInDocument(document, table, keys)) {
      refs.set(key, [...(refs.get(key) ?? []), ...hits]);
    }
  }
}
const now = Date.now();
const rows = planLegacyR2Retention(inventory, refs, now);
const summary = rows.reduce<Record<string, { objects: number; bytes: number; reviewObjects: number; reviewBytes: number }>>((all, row) => {
  const group = all[row.family] ?? { objects: 0, bytes: 0, reviewObjects: 0, reviewBytes: 0 };
  group.objects++; group.bytes += row.size;
  if (row.decision === "review_unreferenced") { group.reviewObjects++; group.reviewBytes += row.size; }
  all[row.family] = group;
  return all;
}, {});
writeFileSync(outputPath, JSON.stringify({
  version: "studio-legacy-r2-census/v1",
  generatedAt: new Date(now).toISOString(),
  deletionAuthorized: false,
  snapshotTables: exportedTables.length,
  snapshotDocumentCounts: counts,
  inventoryObjects: inventory.length,
  summary,
  rows,
}, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output: outputPath, deletionAuthorized: false, summary }, null, 2));
} finally {
  rmSync(snapshotDir, { recursive: true, force: true });
}
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
