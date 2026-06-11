import { hydrateEnv } from "@/lib/vault";
import { ConvexHttpClient } from "convex/browser"; import { api } from "@/../convex/_generated/api";
import { getObjectBytes } from "@/lib/storage"; import { grabFrame, probe } from "@/lib/ffmpeg";
import { writeFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
async function main(){ await hydrateEnv("cloudflare"); process.env.NEXT_PUBLIC_CONVEX_URL="https://astute-camel-689.convex.cloud";
  const c=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!); const rid=process.argv[2];
  const st=await c.query(api.runStages.listRunStages,{runId:rid as never}) as Array<any>;
  const store:Record<string,any>={}; for(const s of st) Object.assign(store, s.outputs??{});
  const run=await c.query(api.runs.getRun,{runId:rid as never}) as any;
  console.log("video="+store.videoKey+" thumb="+store.thumbnailKey+" yt="+store.youtubeVideoId);
  const dir=tmpdir();
  const vp=join(dir,"verify_vid.mp4"); writeFileSync(vp,Buffer.from(await getObjectBytes(store.videoKey)));
  const tp=join(dir,"verify_thumb.jpg"); writeFileSync(tp,Buffer.from(await getObjectBytes(store.thumbnailKey)));
  const dur=(await probe(vp)).durationSec; console.log("duration="+dur.toFixed(1)+"s");
  // sample frames incl last 5s tail
  const ts=[8,30,60,90,Math.max(0,dur-4),Math.max(0,dur-1.2)];
  const out:string[]=[];
  for(const t of ts){ const f=join(dir,`vf_${Math.round(t)}.jpg`); await grabFrame(vp,t,f); out.push(f); }
  console.log("THUMB "+tp);
  console.log("FRAMES "+out.join(" "));
}
main().catch(e=>{console.error(e instanceof Error?(e.stack||e.message):e);process.exit(1)});
