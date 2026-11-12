import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderWeeklyHyperStills } from "@/lib/hyperYoutubeWeeklyStills";
import { loadWeeklyHyperStillsForConsumer } from "@/lib/hyperYoutubeWeeklyStillConsumer";
import { assertPlanWeekPreparedImagesArgs } from "@/lib/planWeekPreparedImagesArgs";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";
import type { HyperYoutubeJob, configuredHyperYoutubeStageClient } from "@/lib/hyperYoutubeStageClient";

const scope = { ownerId:"owner", channelId:"channel", channelSlug:"channel", batchId:"batch", itemId:"item" };
const payload = assertPlanWeekPreparedImagesArgs({ ...scope, manifestKey:planWeekPreparationKey(scope), manifestSha256:"a".repeat(64),
  shots:[{id:"one",prompt:"A quiet archive",seed:7,candidateCount:1},
    {id:"two",prompt:"A known person",candidateCount:1,referenceImages:["approved-reference"]}],maxCostUsd:2 });
const source=Buffer.alloc(512); Buffer.from([137,80,78,71,13,10,26,10]).copy(source); source.writeUInt32BE(13,8);
source.write("IHDR",12);source.writeUInt32BE(1024,16);source.writeUInt32BE(1024,20);
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const projectId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",envId="cccccccc-cccc-4ccc-8ccc-cccccccccccc",jobId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const objects=new Map<string,Uint8Array>();let submits=0,creates=0,reads=0,badReceipt=false,wrongBucket=false,wrongProject=false,failOnce=true;
const storage={ get:async (key:string,bucket?:string)=>{assert.equal(bucket,"youtube");const v=objects.get(key);
  if(!v)throw Object.assign(new Error("absent"),{name:"NoSuchKey",$metadata:{httpStatusCode:404}});return v;},
  put:async (key:string,bytes:Uint8Array,options?:{bucket?:string;ifNoneMatch?:string})=>{assert.equal(options?.bucket,"youtube");
    assert.equal(options?.ifNoneMatch,"*");if(objects.has(key))throw new Error("exists");objects.set(key,Buffer.from(bytes));return key;} };
const job=(key:string):HyperYoutubeJob=>({id:jobId,projectId:wrongProject?"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee":projectId,modelId:"ernie-image-turbo",state:"completed",generation:1,
  idempotencyKey:key,environmentId:envId,environmentSha256:"c".repeat(64),outputDestination:{bucket:"youtube",projectPrefix:"projects/youtube/"},
  output:{projectId,jobId,generation:1,bucket:"youtube",key:`projects/youtube/jobs/${jobId}/1/output.png`,sha256:badReceipt?"f".repeat(64):hash(source),
    bytes:source.length,contentType:"image/png",available:true,downloadUrl:"https://example.test/output"}});
const client:ReturnType<typeof configuredHyperYoutubeStageClient>={
  binding:async()=>({baseUrl:"https://example.test",projectId,projectToken:"fixture",outputBucket:wrongBucket?"other":"youtube",outputPrefix:"projects/youtube/"}),
  createEnvironment:async modelId=>{creates++;return {id:envId,modelId,sha256:"c".repeat(64)}},
  getEnvironment:async(id,modelId)=>({id,modelId,sha256:"c".repeat(64)}),
  submit:async(stage,key,env)=>{submits++;assert.equal(stage.modelId,"ernie-image-turbo");assert.equal(stage.seed,7);assert.equal(env?.id,envId);
    if(failOnce){failOnce=false;throw new Error("lost response")}return job(key)},
  get:async(_id,_stage,key,env)=>{reads++;assert.equal(env?.id,envId);return job(key)},download:async()=>source,
};
async function main(){
 const args={payload,outputRoot:"weekly/hrs",bucket:"youtube",wait:async()=>{},client,storage};
 await assert.rejects(renderWeeklyHyperStills(args),/lost response/);
 assert.equal(creates,1);assert.equal(submits,1);
 const result=await renderWeeklyHyperStills(args);
 assert.equal(result.reused,false);
 assert.equal(creates,1);assert.equal(submits,2);assert.equal(result.receipt.items[0].status,"ready");
 assert.equal(result.receipt.items[1].status,"blocked");assert.equal(result.receipt.referenceConditioning,false);
 assert.equal(result.receipt.items[1].reason,"reference_image_conditioning_unsupported");
 const again=await renderWeeklyHyperStills(args);assert.deepEqual(again.receipt,result.receipt);assert.equal(again.reused,true);
 assert.equal(submits,2);assert.ok(reads>0);
 wrongBucket=true;await assert.rejects(renderWeeklyHyperStills(args),/buckets must match/);wrongBucket=false;
 wrongProject=true;await assert.rejects(renderWeeklyHyperStills(args),/receipt does not match/);wrongProject=false;
 badReceipt=true;await assert.rejects(renderWeeklyHyperStills(args),/receipt does not match/);badReceipt=false;
 const imageKey=result.receipt.items[0].stillKey as string;objects.set(imageKey,Buffer.alloc(source.length,1));
 await assert.rejects(renderWeeklyHyperStills(args));
 const originalBucket=process.env.R2_BUCKET;process.env.R2_BUCKET="youtube";
 try {
   const cleanPayload={...payload,shots:[payload.shots[0]]},outputRoot="owner/owner/plan-batches/batch/hrs";
   const produced=await renderWeeklyHyperStills({...args,payload:cleanPayload,outputRoot});
   const consumer={receiptKey:produced.receiptKey,manifestSha256:payload.manifestSha256,ownerId:"owner",channelId:"channel",
     keyPrefix:"owner/owner",profileId:"production" as const,
     shots:[{id:"one",candidateCount:1,requiredPrompt:"A quiet archive",requiresReference:false}],client,read:storage.get};
   const manifest=await loadWeeklyHyperStillsForConsumer(consumer);
   assert.equal(manifest.generation.contractVersion,"hrs-ernie/v1");
   assert.equal(manifest.items[0].stillKey,produced.receipt.items[0].stillKey);
   assert.equal(manifest.items[0].sourceSha256,hash(source));
   await assert.rejects(loadWeeklyHyperStillsForConsumer({...consumer,shots:[{...consumer.shots[0],requiresReference:true}]}),/reference evidence/);
   await assert.rejects(loadWeeklyHyperStillsForConsumer({...consumer,shots:[{...consumer.shots[0],visualDirective:"locked visual directive"}]}),/visual directive/);
   objects.set(manifest.items[0].stillKey,Buffer.alloc(source.length,3));
   await assert.rejects(loadWeeklyHyperStillsForConsumer(consumer),/retained bytes failed verification|image dimensions/);
 } finally { if(originalBucket===undefined)delete process.env.R2_BUCKET;else process.env.R2_BUCKET=originalBucket; }
 console.log("Weekly HRS ERNIE dispatch, reference holds, receipt, isolation and resume: ok");
}
void main();
