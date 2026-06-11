import { ConvexHttpClient } from "convex/browser";
import { tasks, configure } from "@trigger.dev/sdk";
import { api } from "../convex/_generated/api";
async function main(){
  const c=new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  configure({ secretKey: process.env.TRIGGER_SECRET_KEY! });
  const chans=(await c.query(api.channels.listChannels,{ownerId:"owner_daniel"})) as Array<any>;
  const ch=chans.find(c=>/quiet stoic/i.test(c.name));
  const h=await tasks.trigger("plan-week-ahead",{ownerId:"owner_daniel",channelId:ch._id,count:3});
  console.log("handle "+h.id+" channel "+ch._id);
}
main().catch(e=>{console.error("FAIL:",e instanceof Error?e.message:e);process.exit(1)});
