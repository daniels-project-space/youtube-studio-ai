/**
 * Retroactive storage cleanup: walk every past run's R2 objects and delete the
 * intermediates (narration, music, pre-overlay video, captions, stock segments,
 * keyframes, loop units…), keeping ONLY the finished video + thumbnail — the same
 * policy the new `cleanup` block applies going forward. Only runs that HAVE a
 * final.mp4 are pruned (in-progress / failed runs are left untouched).
 *
 *   DRY_RUN=1 npx tsx scripts/cleanup-old-runs.ts     # report only
 *   npx tsx scripts/cleanup-old-runs.ts               # actually delete
 */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const DRY = process.env.DRY_RUN === "1";
const VAULT = "https://fantastic-roadrunner-485.convex.cloud/api/query";
const KEEP = new Set(["final.mp4", "thumbnail.jpg"]);

async function vault(service: string): Promise<Record<string, string>> {
  const r = await fetch(VAULT, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service }, format: "json" }),
  });
  const j = (await r.json()) as { value: { keyName: string; value: string }[] };
  const o: Record<string, string> = {};
  for (const s of j.value) o[s.keyName] = s.value;
  return o;
}

async function main() {
  const cf = await vault("cloudflare");
  const client = new S3Client({
    region: "auto", endpoint: cf.R2_ENDPOINT,
    credentials: { accessKeyId: cf.R2_ACCESS_KEY_ID, secretAccessKey: cf.R2_SECRET_ACCESS_KEY },
  });
  const Bucket = "youtube-studio-ai";

  // List EVERY object, with sizes.
  const objs: { Key: string; Size: number }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket, Prefix: "owner/", ContinuationToken: token }));
    for (const o of res.Contents ?? []) if (o.Key) objs.push({ Key: o.Key, Size: o.Size ?? 0 });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  // Group by run prefix `.../runs/<runId>/`.
  const groups = new Map<string, { runId: string; files: { Key: string; Size: number; name: string }[] }>();
  for (const o of objs) {
    const m = o.Key.match(/^(.*\/runs\/([^/]+)\/)(.+)$/);
    if (!m) continue; // non-run object (ledger, originality index, channel art) — leave it
    const [, prefix, runId, name] = m;
    if (!groups.has(prefix)) groups.set(prefix, { runId, files: [] });
    groups.get(prefix)!.files.push({ Key: o.Key, Size: o.Size, name });
  }

  const convex = new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  let runsCleaned = 0, objsDeleted = 0, bytesFreed = 0, runsSkipped = 0;
  const fmt = (b: number) => (b / 1e6).toFixed(1) + " MB";

  for (const [prefix, g] of groups) {
    const hasFinal = g.files.some((f) => f.name === "final.mp4");
    if (!hasFinal) { runsSkipped++; continue; } // unfinished/failed — keep intermediates
    const del = g.files.filter((f) => !KEEP.has(f.name));
    if (del.length === 0) continue;
    const bytes = del.reduce((s, f) => s + f.Size, 0);
    console.log(`${DRY ? "[dry] " : ""}${prefix} → delete ${del.length} (${fmt(bytes)}): ${del.map((f) => f.name).join(", ")}`);
    if (!DRY) {
      for (let i = 0; i < del.length; i += 1000) {
        await client.send(new DeleteObjectsCommand({
          Bucket, Delete: { Objects: del.slice(i, i + 1000).map((f) => ({ Key: f.Key })), Quiet: true },
        }));
      }
      try {
        await convex.mutation(api.assets.pruneRun, { runId: g.runId as Id<"runs">, keepKinds: ["video", "thumbnail"] });
      } catch { /* run row may be gone — R2 prune is what matters */ }
    }
    runsCleaned++; objsDeleted += del.length; bytesFreed += bytes;
  }

  console.log(`\n${DRY ? "WOULD CLEAN" : "CLEANED"} ${runsCleaned} run(s): ${objsDeleted} objects, ${fmt(bytesFreed)} freed. (${runsSkipped} unfinished run(s) left intact.)`);
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
