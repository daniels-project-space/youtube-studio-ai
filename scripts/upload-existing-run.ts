/**
 * One-off: upload an ALREADY-COMPOSED run's video to YouTube as a PRIVATE draft,
 * bypassing the qa_visual gate (operator chose to publish despite the footage
 * note). Pulls metadata (title/description/tags) from the persisted metadata
 * stage outputs, the mp4 + thumbnail from R2, and all creds from the vault.
 *
 *   NEXT_PUBLIC_CONVEX_URL=https://astute-camel-689.convex.cloud \
 *   npx tsx scripts/upload-existing-run.ts <runId>
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const VAULT = "https://fantastic-roadrunner-485.convex.cloud/api/query";

async function vaultService(service: string): Promise<Record<string, string>> {
  const r = await fetch(VAULT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service }, format: "json" }),
  });
  const j = (await r.json()) as { value: { keyName: string; value: string }[] };
  // last-write-wins (matches hydrateEnv) — later duplicates override earlier.
  const out: Record<string, string> = {};
  for (const s of j.value) out[s.keyName] = s.value;
  return out;
}

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: upload-existing-run.ts <runId>");

  // Hydrate env from the vault (R2 + YouTube) BEFORE importing modules that read it.
  const cf = await vaultService("cloudflare");
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
    if (cf[k]) process.env[k] = cf[k];
  }
  process.env.R2_BUCKET = process.env.R2_BUCKET ?? "youtube-studio-ai";
  const yt = await vaultService("youtube");
  for (const k of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"]) {
    if (yt[k]) process.env[k] = yt[k];
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  // Pull persisted metadata (title/description/tags) from the metadata stage.
  const stages = (await convex.query(api.runStages.listRunStages, {
    runId: runId as Id<"runs">,
  })) as Array<{ block: string; status: string; outputs?: any }>;
  const meta = stages.find((s) => s.block === "metadata")?.outputs;
  if (!meta?.title) throw new Error("no persisted metadata.title for this run");

  const assets = (await convex.query(api.assets.listForRun, {
    runId: runId as Id<"runs">,
  })) as Array<{ kind: string; r2Key: string }>;
  const videoKey = assets.find((a) => a.kind === "video")?.r2Key;
  const thumbKey = assets.find((a) => a.kind === "thumbnail")?.r2Key;
  if (!videoKey) throw new Error("no video asset for this run");

  // Lazy-import AFTER env is set (these read process.env at call time).
  const { getObjectBytes } = await import("@/lib/storage");
  const { uploadPrivateDraft, setVideoThumbnail } = await import("@/lib/youtube");

  const mp4 = join(tmpdir(), `${runId}.mp4`);
  await writeFile(mp4, Buffer.from(await getObjectBytes(videoKey)));
  console.log(`downloaded video → ${mp4}`);

  console.log(`uploading PRIVATE draft: "${meta.title}"`);
  const res = await uploadPrivateDraft({
    filePath: mp4,
    title: meta.title,
    description: meta.description ?? "",
    tags: (meta.tags as string[]) ?? [],
    privacyStatus: "private",
  });
  console.log(`uploaded: ${res.watchUrl} (privacy=${res.privacyStatus})`);

  if (thumbKey) {
    try {
      await setVideoThumbnail(res.videoId, await getObjectBytes(thumbKey), "image/jpeg");
      console.log("custom thumbnail set");
    } catch (e) {
      console.log(`thumbnail set FAILED (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await convex.mutation(api.runs.updateRun, {
      runId: runId as Id<"runs">,
      youtubeVideoId: res.videoId,
    });
  } catch (e) {
    console.log(`updateRun failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  console.log(JSON.stringify({ videoId: res.videoId, watchUrl: res.watchUrl }));
}

main().catch((e) => {
  console.error("UPLOAD FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
