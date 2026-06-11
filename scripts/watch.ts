import { ConvexHttpClient } from "convex/browser"; import { api } from "@/../convex/_generated/api";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function main(){ const c=new ConvexHttpClient("https://astute-camel-689.convex.cloud"); const rid=process.argv[2];
  const iters=Number(process.argv[3]||80); const everyMs=Number(process.argv[4]||20000);
  for(let i=0;i<iters;i++){
    try {
      const run=await c.query(api.runs.getRun,{runId:rid as never}) as any;
      const st=await c.query(api.runStages.listRunStages,{runId:rid as never}) as Array<any>;
      const last=st[st.length-1];
      console.log(new Date().toISOString().slice(11,19)+" status="+run?.status+" last="+(last?.block)+":"+(last?.status));
      if(run?.status && run.status!=="running"){
        console.log("DONE status="+run.status);
        console.log("blocks: "+st.map(s=>s.block+":"+s.status).join(" "));
        if(run.error) console.log("ERROR: "+run.error);
        return;
      }
    } catch(e){ console.log("poll err: "+(e instanceof Error?e.message:e)); }
    await sleep(everyMs);
  }
  console.log("TIMEOUT still running");
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1)});
