import { ConvexHttpClient } from "convex/browser"; import { api } from "@/../convex/_generated/api";
async function main(){ const c=new ConvexHttpClient("https://astute-camel-689.convex.cloud");
  const rid=process.argv[2];
  const st=await c.query(api.runStages.listRunStages,{runId:rid as never}) as Array<any>;
  const run=await c.query(api.runs.getRun,{runId:rid as never}) as any;
  const last=st[st.length-1];
  console.log("status="+(run?.status)+" stages="+st.length+" lastBlock="+(last?.block)+" lastStatus="+(last?.status));
  console.log("blocks: "+st.map(s=>s.block+":"+s.status).join(" "));
  if(run?.error) console.log("ERROR: "+run.error);
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1)});
