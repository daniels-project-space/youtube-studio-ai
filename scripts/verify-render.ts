import { hydrateEnv } from "@/lib/vault";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { getObjectBytes } from "@/lib/storage";
import { grabFrame, probe } from "@/lib/ffmpeg";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface RenderOutputs {
  thumbnailKey?: unknown;
  videoKey?: unknown;
  youtubeVideoId?: unknown;
}

function requiredKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`missing ${label}`);
  return value;
}

async function main() {
  await hydrateEnv("cloudflare");
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://astute-camel-689.convex.cloud";
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  const rid = process.argv[2];
  if (!rid) throw new Error("usage: verify-render.ts <runId>");
  const runId = rid as Id<"runs">;
  const stages = await c.query(api.runStages.listRunStages, { runId });
  const store: RenderOutputs = {};
  for (const stage of stages) {
    if (stage.outputs && typeof stage.outputs === "object") Object.assign(store, stage.outputs);
  }
  const run = await c.query(api.runs.getRun, { runId });
  const videoKey = requiredKey(store.videoKey, "videoKey");
  const thumbnailKey = requiredKey(store.thumbnailKey, "thumbnailKey");
  console.log(`status=${run?.status} video=${videoKey} thumb=${thumbnailKey} yt=${String(store.youtubeVideoId ?? "")}`);
  const dir = tmpdir();
  const vp = join(dir, "verify_vid.mp4");
  writeFileSync(vp, Buffer.from(await getObjectBytes(videoKey)));
  const tp = join(dir, "verify_thumb.jpg");
  writeFileSync(tp, Buffer.from(await getObjectBytes(thumbnailKey)));
  const dur = (await probe(vp)).durationSec;
  console.log(`duration=${dur.toFixed(1)}s`);
  // sample frames incl last 5s tail
  const ts = [8, 30, 60, 90, Math.max(0, dur - 4), Math.max(0, dur - 1.2)];
  const out: string[] = [];
  for (const t of ts) {
    const f = join(dir, `vf_${Math.round(t)}.jpg`);
    await grabFrame(vp, t, f);
    out.push(f);
  }
  console.log(`THUMB ${tp}`);
  console.log(`FRAMES ${out.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack || error.message) : error);
  process.exit(1);
});
