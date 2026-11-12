import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hyperYoutubeStillKey, renderHyperYoutubeStill } from "@/lib/hyperYoutubeStill";
import { configuredHyperYoutubeStageClient, type HyperYoutubeJob } from "@/lib/hyperYoutubeStageClient";
import { composeHyperYoutubeStill16x9 } from "@/lib/hyperYoutubeStillComposition";
import { rasterImageDimensions } from "@/lib/imageDimensions";

async function main() {
  const scope={ownerId:"owner",channelId:"channel",runId:"run",attempt:1,prompt:"A cozy lakeside room"};
  const source=Buffer.from("native bytes"), states=["running","completed"], keys:string[]=[];
  const jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",environmentId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const makeJob=(state:string,key:string):HyperYoutubeJob=>({id:jobId,projectId,modelId:"ernie-image-turbo",state,generation:1,
    idempotencyKey:key,environmentId,environmentSha256:"c".repeat(64),outputDestination:{bucket:"youtube",projectPrefix:"projects/youtube/"},
    output:{projectId,jobId,generation:1,bucket:"youtube",key:`projects/youtube/jobs/${jobId}/1/output.png`,
      sha256:"a".repeat(64),bytes:source.length,contentType:"image/png",available:true,downloadUrl:"https://example.com/output.png"}});
  const client:ReturnType<typeof configuredHyperYoutubeStageClient>={
    binding:async()=>({baseUrl:"https://hrs.example",projectId,projectToken:"test-token",outputBucket:"youtube",outputPrefix:"projects/youtube/"}),
    createEnvironment:async(modelId)=>({id:environmentId,modelId,sha256:"c".repeat(64)}),
    getEnvironment:async(id,modelId)=>({id,modelId,sha256:"c".repeat(64)}),
    submit:async(_stage,key)=>{keys.push(key);return makeJob("queued",key)},
    get:async(_id,_stage,key)=>makeJob(states.shift()??"completed",key),download:async()=>source};
  let waits=0;
  const rendered=await renderHyperYoutubeStill({scope,client,wait:async()=>{waits++}});
  assert.equal(waits,2);assert.equal(rendered.jobId,jobId);assert.deepEqual(rendered.bytes,source);
  states.push("completed");await renderHyperYoutubeStill({scope,client,wait:async()=>{}});
  assert.equal(keys[0],keys[1],"a retry submits the exact same HRS job identity");
  assert.equal(hyperYoutubeStillKey(scope),hyperYoutubeStillKey({...scope,prompt:"changed"}),
    "a changed retry must conflict with the existing immutable request rather than create another job");
  await assert.rejects(renderHyperYoutubeStill({scope,client:{...client,submit:async(_stage,key)=>makeJob("failed",key)},wait:async()=>{}}),/ended failed/);
  const dir=await mkdtemp(join(tmpdir(),"hrs-still-test-"));
  try {
    const original=join(dir,"original.png"), input=join(dir,"input.png"), output=join(dir,"output.png");
    execFileSync("ffmpeg",["-loglevel","error","-f","lavfi","-i","testsrc=size=1024x1024:rate=1","-frames:v","1","-threads","1",original]);
    const image=await readFile(original), composed=await composeHyperYoutubeStill16x9(image,input,output);
    const dimensions=rasterImageDimensions(composed);assert.equal(dimensions.width,2048);assert.equal(dimensions.height,1152);
    const rgba=(path:string,filter?:string)=>execFileSync("ffmpeg",["-loglevel","error","-i",path,...(filter?["-vf",filter]:[]),"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","-"],{maxBuffer:5_000_000});
    const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest(rgba(output,"crop=1024:1024:512:64")),digest(rgba(original)),"the native picture remains fully intact in the center");
    await assert.rejects(composeHyperYoutubeStill16x9(Buffer.from("invalid"),input,output));
  } finally { await rm(dir,{recursive:true,force:true}); }
  const caller=await readFile(join(process.cwd(),"src/trigger/blocks/lofiBlocks.ts"),"utf8");
  assert.match(caller,/renderHyperYoutubeStill\(/);assert.match(caller,/composeHyperYoutubeStill16x9\(/);
  assert.match(caller,/getObjectBytes\(key,bucket,\{maxBytes:100_000_000\}\)/);
  assert.match(caller,/getObjectBytes\(receiptKey,bucket,\{maxBytes:100_000\}\)/,
    "the actual keyframe caller verifies the stored project receipt before returning");
  console.log("HRS YouTube still handoff: ok");
}
void main();
