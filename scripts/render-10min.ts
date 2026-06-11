import { ConvexHttpClient } from "convex/browser";
import { tasks, configure } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";
async function main(){
  const c=new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  configure({ secretKey: process.env.TRIGGER_SECRET_KEY! });
  const chans=(await c.query(api.channels.listChannels,{ownerId:"owner_daniel"})) as any[];
  const ch=chans.find(x=>/quiet stoic/i.test(x.name));
  // override: 10-min script target + widen length gate for this run
  const pipeline=(ch.pipeline as any[]).map(e=>{
    if(e.block==="script_gen") return {...e, params:{...(e.params||{}), maxSeconds:600}};
    if(e.block==="length_check") return {...e, params:{...(e.params||{}), minSeconds:420, maxSeconds:1200}};
    return e;
  });
  await c.mutation(api.channels.updateChannel,{channelId:ch._id, pipeline});
  const runId=await c.mutation(api.runs.createRun,{ownerId:"owner_daniel",channelId:ch._id,status:"running"});
  const h=await tasks.trigger("run-pipeline",{channelId:ch._id,runId});
  console.log(JSON.stringify({runId, handle:h.id}));
}
main().catch(e=>{console.error("FAIL:",e instanceof Error?e.message:e);process.exit(1)});
