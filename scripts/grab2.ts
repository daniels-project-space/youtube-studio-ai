import { hydrateEnv } from "@/lib/vault";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/../convex/_generated/api";
import { getObjectBytes } from "@/lib/storage";
import { grabFrame } from "@/lib/ffmpeg";
import { writeFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
async function main(){
  await hydrateEnv("cloudflare"); process.env.NEXT_PUBLIC_CONVEX_URL="https://astute-camel-689.convex.cloud";
  const runId=process.argv[2]; const c=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  const st=await c.query(api.runStages.listRunStages,{runId:runId as never}) as Array<{block:string;outputs?:any}>;
  const by:any={}; for(const s of st) by[s.block]=s.outputs||{};
  const dir=tmpdir();
  // thumbnail
  writeFileSync(join(dir,"r_thumb.jpg"), Buffer.from(await getObjectBytes(by.thumbnail_gen.thumbnailKey)));
  console.log("THUMB",join(dir,"r_thumb.jpg"));
  // video frames
  const mp4=join(dir,"r_final.mp4"); writeFileSync(mp4, Buffer.from(await getObjectBytes(by.timeline_assemble.videoKey)));
  const ov=by.quote_overlays?.quoteOverlays||[];
  const qt = ov.length? Math.round(ov[1]?.startSec ?? ov[0].startSec)+2 : 60;
  for(const [label,t] of [["quote",qt],["b1",30],["b2",95],["b3",140]] as const){
    const f=join(dir,`r_${label}_${t}.jpg`); try{await grabFrame(mp4,t,f);console.log(label.toUpperCase(),t+"s",f);}catch(e){console.log(label,"fail");}
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
