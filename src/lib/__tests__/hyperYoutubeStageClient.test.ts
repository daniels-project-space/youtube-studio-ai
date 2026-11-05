import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createHyperYoutubeStageClient, type HyperYoutubeStage } from "@/lib/hyperYoutubeStageClient";

async function main() {
  const projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", jobId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const environmentId="cccccccc-cccc-4ccc-8ccc-cccccccccccc", bytes=Buffer.from("verified-output");
  const stages:HyperYoutubeStage[]=[
    {modelId:"qwen3-tts",inputs:{text:"Hello",speaker:"Ryan",language:"English"},seed:2},
    {modelId:"yue2",inputs:{prompt:"Piano",lyrics:"A song",abc:"X:1"}},
    {modelId:"ernie-image-turbo",inputs:{prompt:"A lake"}},
  ];
  const contentTypes={"qwen3-tts":"audio/wav","yue2":"audio/flac","ernie-image-turbo":"image/png"};
  const suffixes={"qwen3-tts":"wav","yue2":"flac","ernie-image-turbo":"png"};
  for (const stage of stages) {
    const key=`stage:${stage.modelId}:same-input`, calls:string[]=[];
    const job={id:jobId,projectId,modelId:stage.modelId,state:"completed",generation:1,idempotencyKey:key,
      outputDestination:{bucket:"youtube",projectPrefix:"projects/youtube/"},output:{projectId,jobId,generation:1,bucket:"youtube",
        key:`projects/youtube/jobs/${jobId}/1/output.${suffixes[stage.modelId]}`,sha256:createHash("sha256").update(bytes).digest("hex"),
        bytes:bytes.length,contentType:contentTypes[stage.modelId],available:true,downloadUrl:"https://r2.example/output"}};
    const fetcher=(async (url:RequestInfo|URL,init?:RequestInit)=>{
      calls.push(String(url));
      if (String(url)==="https://r2.example/output") { assert.equal((init?.headers as Record<string,string>|undefined)?.authorization,undefined); return new Response(bytes); }
      assert.equal((init?.headers as Record<string,string>).authorization,"Bearer project-token");
      if (String(url).endsWith("/environments")) return Response.json({id:environmentId,modelId:stage.modelId});
      if (String(url).endsWith("/jobs")) { const payload=JSON.parse(String(init?.body)); assert.deepEqual(payload.inputs,stage.inputs);
        assert.equal(payload.idempotencyKey,key); assert.equal(payload.outputKind,"intermediate"); return Response.json(job,{status:202}); }
      if (String(url).endsWith(`/jobs/${jobId}`)) return Response.json(job);
      throw new Error("unexpected request");
    }) as typeof fetch;
    const client=createHyperYoutubeStageClient({baseUrl:"https://hrs.example",projectId,projectToken:"project-token",
      outputBucket:"youtube",outputPrefix:"projects/youtube/",fetch:fetcher});
    const submitted=await client.submit(stage,key);
    assert.deepEqual(await client.download(await client.get(submitted.id,stage,key),stage,key),bytes);
    await assert.rejects(client.download({...job,output:{...job.output,projectId:"other"}},stage,key),/receipt/);
    await assert.rejects(client.download({...job,output:{...job.output,sha256:"0".repeat(64)}},stage,key),/match/);
    assert.equal(calls.filter(url=>url.endsWith("/jobs")).length,1);
  }
  console.log("HRS YouTube stage client fixtures: ok");
}
void main();
