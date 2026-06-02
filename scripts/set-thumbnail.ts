import { hydrateEnv } from "@/lib/vault";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/../convex/_generated/api";
import { getObjectBytes } from "@/lib/storage";
import { setVideoThumbnail } from "@/lib/youtube";

async function main() {
  await hydrateEnv("youtube"); await hydrateEnv("cloudflare");
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://astute-camel-689.convex.cloud";
  const runId = process.argv[2]; const videoId = process.argv[3];
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  const stages = await c.query(api.runStages.listRunStages, { runId: runId as never }) as Array<{block:string;outputs?:{thumbnailKey?:string}}>;
  const key = stages.find(s=>s.block==="thumbnail_gen")?.outputs?.thumbnailKey;
  if (!key) { console.log("no thumbnailKey for run"); process.exit(1); }
  console.log("thumbnailKey:", key);
  const bytes = await getObjectBytes(key);
  console.log("downloaded", Math.round(bytes.length/1024), "KB; setting on", videoId, "…");
  await setVideoThumbnail(videoId, bytes, "image/jpeg");
  console.log("✅ thumbnail set on https://www.youtube.com/watch?v="+videoId);
}
main().catch(e=>{console.error("FAILED:", e instanceof Error?e.message:e); process.exit(1);});
