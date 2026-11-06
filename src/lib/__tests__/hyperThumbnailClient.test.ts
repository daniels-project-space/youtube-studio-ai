import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createHyperThumbnailClient, hasConfiguredHyperThumbnailClient } from "@/lib/hyperThumbnailClient";
import { canonicalJson } from "@/lib/canonicalJson";
import { createHyperThumbnailEvidence, validHyperThumbnailEvidence } from "@/lib/hyperThumbnailEvidence";

async function main() {
  const oldBase = process.env.HRS_YOUTUBE_BASE_URL, oldToken = process.env.HRS_YOUTUBE_PROJECT_TOKEN;
  const oldGemini = process.env.GEMINI_API_KEY, oldVault = process.env.VAULT_ACCESS_TOKEN;
  process.env.HRS_YOUTUBE_BASE_URL = "https://hrs.example";
  process.env.HRS_YOUTUBE_PROJECT_TOKEN = "fixture-token";
  delete process.env.GEMINI_API_KEY;
  delete process.env.VAULT_ACCESS_TOKEN;
  assert.equal(hasConfiguredHyperThumbnailClient(), true,
    "the configured project HRS credential is the readiness signal for its Nano Banana API route");
  if (oldBase === undefined) delete process.env.HRS_YOUTUBE_BASE_URL; else process.env.HRS_YOUTUBE_BASE_URL = oldBase;
  if (oldToken === undefined) delete process.env.HRS_YOUTUBE_PROJECT_TOKEN; else process.env.HRS_YOUTUBE_PROJECT_TOKEN = oldToken;
  if (oldGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldGemini;
  if (oldVault === undefined) delete process.env.VAULT_ACCESS_TOKEN; else process.env.VAULT_ACCESS_TOKEN = oldVault;
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bytes = Buffer.from("fixture image bytes");
  const input = {candidateId:"a".repeat(64),videoId:"video-1",revision:2,title:"A title",hook:"A hook",heroSubject:"A hero",visualDirection:"A scene",creativeDirection:"Full Golden recipe with 4K",referenceAssets:[{assetId:"frame-1",role:"source-frame" as const}]};
  const identity = {provider:"google-gemini-api",modelId:"gemini-3-pro-image",settings:{aspectRatio:"16:9",imageSize:"2K"},candidateId:input.candidateId,request:input,referenceAssets:[{assetId:"frame-1",role:"source-frame",sha256:"2".repeat(64),bytes:100,contentType:"image/png"}]};
  const receipt = {id:"one",projectId,videoId:input.videoId,revision:input.revision,state:"completed",completedAt:"2026-11-04T12:00:00.000Z",...identity,requestSha256:createHash("sha256").update(canonicalJson(identity)).digest("hex"),sourceSha256:"2".repeat(64),
    output:{bucket:"studio",key:"projects/studio/thumbnail.png",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),contentType:"image/png",downloadUrl:"https://r2.example/one",expiresInSeconds:900}};
  let calls = 0;
  const fakeFetch = (async (url:RequestInfo|URL,init?:RequestInit) => {
    calls++;
    if (String(url) === "https://r2.example/one") {
      assert.equal((init?.headers as Record<string,string>|undefined)?.authorization,undefined);
      return new Response(bytes);
    }
    assert.equal((init?.headers as Record<string,string>).authorization,"Bearer fixture-token");
    assert.equal(init?.method,"POST");
    assert.deepEqual(JSON.parse(String(init?.body)),input);
    return new Response(JSON.stringify(receipt),{status:201});
  }) as typeof fetch;
  const client = createHyperThumbnailClient({baseUrl:"https://hrs.example",projectId,projectToken:"fixture-token",outputBucket:"studio",outputPrefix:"projects/studio/",fetch:fakeFetch});
  const result = await client.submit(input,{"frame-1":"2".repeat(64)});
  const evidence = createHyperThumbnailEvidence({result,requestContext:canonicalJson({contractVersion:"thumbnail-gen-nano-banana-context/v1",requestHash:input.candidateId,keyPrefix:"youtube/",runId:"run-1"}),mode:"lofi-render-frame-native",expectedWords:["4K"],backgroundSsim:0.999,estimatedCostUsd:0.135});
  assert.equal(validHyperThumbnailEvidence(evidence,input.candidateId),true);
  assert.equal(validHyperThumbnailEvidence({...evidence,sourceSha256:"3".repeat(64)},input.candidateId),false);
  assert.equal("downloadUrl" in evidence.output,false);
  assert.deepEqual(await client.download(result,input,{"frame-1":"2".repeat(64)}),bytes);
  assert.equal(calls,2);
  await assert.rejects(client.download({...result,projectId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},input,{"frame-1":"2".repeat(64)}),/receipt/);
  await assert.rejects(client.download({...result,output:{...result.output,sha256:"0".repeat(64)}},input,{"frame-1":"2".repeat(64)}),/hash mismatch/);
  const failing = createHyperThumbnailClient({baseUrl:"https://hrs.example",projectId,projectToken:"fixture",outputBucket:"studio",outputPrefix:"projects/studio/",fetch:(async()=>{calls++; throw new Error("network lost");}) as typeof fetch});
  const before = calls;
  await assert.rejects(failing.submit(input,{"frame-1":"2".repeat(64)}),/network lost/);
  assert.equal(calls,before+1,"ambiguous submission is not automatically repeated");
  const pendingClient = createHyperThumbnailClient({baseUrl:"https://hrs.example",projectId,projectToken:"fixture",outputBucket:"studio",outputPrefix:"projects/studio/",fetch:(async()=>new Response(JSON.stringify({...receipt,state:"generating",output:undefined}))) as typeof fetch});
  assert.equal((await pendingClient.get(input)).state,"generating");
  const expiredClient = createHyperThumbnailClient({baseUrl:"https://hrs.example",projectId,projectToken:"fixture",outputBucket:"studio",outputPrefix:"projects/studio/",fetch:(async()=>new Response(JSON.stringify({...receipt,state:"output-expired",output:{...receipt.output,available:false,downloadUrl:undefined}}))) as typeof fetch});
  assert.equal((await expiredClient.get(input)).state,"output-expired", "an expired candidate remains visible without a new paid render");
  const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const uploadClient = createHyperThumbnailClient({baseUrl:"https://hrs.example",projectId,projectToken:"fixture",outputBucket:"studio",outputPrefix:"projects/studio/",fetch:(async(url,init)=>{
    if(String(url).endsWith("/assets/uploads")) return new Response(JSON.stringify({assetId,bucket:"studio",key:`projects/studio/inputs/${assetId}/frame.png`,verified:false,url:"https://r2.example/upload",headers:{"if-none-match":"*"}}));
    if(String(url) === "https://r2.example/upload") { assert.equal(init?.method,"PUT"); assert.equal((init?.headers as Record<string,string>).authorization,undefined); return new Response(null,{status:200}); }
    if(String(url).endsWith(`/assets/${assetId}/verify`)) return new Response(JSON.stringify({assetId,verified:true}));
    throw new Error("unexpected URL");
  }) as typeof fetch});
  const uploaded = await uploadClient.uploadReference({bytes,name:"frame.png",contentType:"image/png",idempotencyKey:"frame-1"});
  assert.equal(uploaded.sha256,createHash("sha256").update(bytes).digest("hex"));
  assert.equal(uploaded.assetId,assetId);
  console.log("HRS thumbnail client fixtures: ok");
}
void main();
