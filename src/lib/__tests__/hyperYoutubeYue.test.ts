import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readHyperYoutubeYue, renderHyperYoutubeYue } from "@/lib/hyperYoutubeYue";

async function main() {
  const retained=JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json","utf8"));
  const arrangement=retained.request.acceptedArrangement,objects=new Map<string,Uint8Array>();
  const flac=Buffer.from("verified flac"),wav=Buffer.from("decoded wav");let submitCount=0,waits=0,authority=0;
  const source={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",generation:1,
    output:{bucket:"youtube",key:"projects/youtube/jobs/source.flac",sha256:"a".repeat(64),bytes:flac.length,contentType:"audio/flac"}};
  const client:any={submit:async(stage:any,key:string)=>{submitCount++;assert.equal(stage.inputs.lyrics,"");
    assert.equal(stage.inputs.abc,arrangement.symbolicScore);assert.equal(stage.seed,42);return {...source,state:"queued",key}},
    get:async()=>({...source,state:"completed"}),download:async()=>flac};
  const storage:any={bucket:"youtube-private",put:async(key:string,body:Uint8Array)=>{
    if(objects.has(key))throw new Error("already exists");objects.set(key,Buffer.from(body));return key;},
    get:async(key:string)=>{const value=objects.get(key);if(!value)throw new Error("missing");return value}};
  const input={ownerId:arrangement.ownerId,channelId:arrangement.channelId,runId:arrangement.runId,arrangement,seed:42,
    authorize:async()=>{authority++},wait:async()=>{waits++},client,storage,
    decode:async()=>({wav,frames:48000,signal:{reviewReasons:[]} as any})};
  const first=await renderHyperYoutubeYue(input),second=await renderHyperYoutubeYue(input);
  assert.equal(first.candidateSha256,second.candidateSha256);assert.equal(submitCount,2);assert.equal(authority,2);
  assert.equal(waits,2);assert.equal(first.evidence.costStatus,"unreported");
  assert.equal(first.evidence.nativeOutput.frames,48000);assert.equal(first.evidence.request.acceptedArrangement.fingerprint,arrangement.fingerprint);
  assert.equal(objects.size,2);assert.equal(first.evidence.source.key,source.output.key);
  const review=await readHyperYoutubeYue({ownerId:input.ownerId,channelId:input.channelId,runId:input.runId},
    {bucket:storage.bucket,get:storage.get,client,inspect:async()=>({reviewReasons:[]} as any)});
  assert.equal(review?.candidate.jobId,source.id);assert.equal(review?.candidateSha256,first.candidateSha256);
  assert.equal(review?.quality.actualDurationSec,1);assert.equal(review?.quality.status,"blocked",
    "a short output cannot claim the accepted arrangement duration");
  objects.set(first.evidence.audioKey,Buffer.from("changed"));
  await assert.rejects(readHyperYoutubeYue({ownerId:input.ownerId,channelId:input.channelId,runId:input.runId},
    {bucket:storage.bucket,get:storage.get,client,inspect:async()=>({reviewReasons:[]} as any)}),/WAV changed/);
  console.log("HRS YouTube YuE project evidence: ok");
}
void main();
