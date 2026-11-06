import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readHyperYoutubeYue, renderHyperYoutubeYue } from "@/lib/hyperYoutubeYue";
import { configuredHyperYoutubeStageClient, type HyperYoutubeJob } from "@/lib/hyperYoutubeStageClient";
import type { NativeAudioSignal } from "@/lib/nativeAudioSignal";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import { z } from "zod";

async function main() {
  const retained=z.object({request:z.object({acceptedArrangement:AcceptedMusicArrangementSchema})})
    .parse(JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json","utf8")));
  const arrangement=retained.request.acceptedArrangement,objects=new Map<string,Uint8Array>();
  const flac=Buffer.from("verified flac"),wav=Buffer.from("decoded wav");let submitCount=0,waits=0,authority=0;
  const jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const makeJob=(state:string,key:string):HyperYoutubeJob=>({id:jobId,projectId,modelId:"yue2",state,generation:1,
    idempotencyKey:key,outputDestination:{bucket:"youtube-private",projectPrefix:"projects/youtube/"},
    output:{projectId,jobId,generation:1,bucket:"youtube-private",key:`projects/youtube/jobs/${jobId}/1/output.flac`,
      sha256:"a".repeat(64),bytes:flac.length,contentType:"audio/flac",available:true,downloadUrl:"https://example.com/output.flac"}});
  const client:ReturnType<typeof configuredHyperYoutubeStageClient>={
    binding:async()=>({baseUrl:"https://hrs.example",projectId,projectToken:"test-token",outputBucket:"youtube-private",outputPrefix:"projects/youtube/"}),
    submit:async(stage,key)=>{if(stage.modelId!=="yue2")throw new Error("unexpected model");submitCount++;assert.equal(stage.inputs.lyrics,"");
      assert.equal(stage.inputs.abc,arrangement.symbolicScore);assert.equal(stage.seed,42);return makeJob("queued",key)},
    get:async(_id,_stage,key)=>makeJob("completed",key),download:async()=>flac};
  const storage:NonNullable<Parameters<typeof renderHyperYoutubeYue>[0]["storage"]>={bucket:"youtube-private",
    put:async(key,body)=>{if(!(body instanceof Uint8Array))throw new Error("unexpected R2 body");
      if(objects.has(key))throw new Error("already exists");objects.set(key,Buffer.from(body));return key;},
    get:async(key)=>{const value=objects.get(key);if(!value)throw new Error("missing");return value}};
  const signal:NativeAudioSignal={version:"native-audio-signal/v1",frames:48000,sampleRateHz:48000,channels:2,
    nonFiniteSamples:0,samplesAtOrAboveFullScale:0,maximumConsecutiveFullScaleSamples:0,quietWindowDurationSec:0.1,
    quietThresholdDbfs:-60,quietWindowFraction:0,longestQuietWindowRunSec:0,
    monoFoldDown:{method:"arithmetic_channel_mean",finiteFrames:48000,nonZeroFrames:48000,peakAmplitude:0.5,rmsAmplitude:0.25},
    channelMeasurements:[0,1].map(()=>({peakAmplitude:0.5,rmsAmplitude:0.25,dcOffset:0,finiteSamples:48000,nonZeroSamples:48000})),
    reviewReasons:[]};
  const input={ownerId:arrangement.ownerId,channelId:arrangement.channelId,runId:arrangement.runId,arrangement,seed:42,
    authorize:async()=>{authority++},wait:async()=>{waits++},client,storage,
    decode:async()=>({wav,frames:48000,signal})};
  const first=await renderHyperYoutubeYue(input),second=await renderHyperYoutubeYue(input);
  assert.equal(first.candidateSha256,second.candidateSha256);assert.equal(submitCount,2);assert.equal(authority,2);
  assert.equal(waits,2);assert.equal(first.evidence.costStatus,"unreported");
  assert.equal(first.evidence.nativeOutput.frames,48000);assert.equal(first.evidence.request.acceptedArrangement.fingerprint,arrangement.fingerprint);
  assert.equal(objects.size,2);assert.equal(first.evidence.source.key,`projects/youtube/jobs/${jobId}/1/output.flac`);
  const review=await readHyperYoutubeYue({ownerId:input.ownerId,channelId:input.channelId,runId:input.runId},
    {bucket:storage.bucket,get:storage.get,client,inspect:async()=>signal});
  assert.equal(review?.candidate.jobId,jobId);assert.equal(review?.candidateSha256,first.candidateSha256);
  assert.equal(review?.quality.actualDurationSec,1);assert.equal(review?.quality.status,"blocked",
    "a short output cannot claim the accepted arrangement duration");
  objects.set(first.evidence.audioKey,Buffer.from("changed"));
  await assert.rejects(readHyperYoutubeYue({ownerId:input.ownerId,channelId:input.channelId,runId:input.runId},
    {bucket:storage.bucket,get:storage.get,client,inspect:async()=>signal}),/WAV changed/);
  console.log("HRS YouTube YuE project evidence: ok");
}
void main();
