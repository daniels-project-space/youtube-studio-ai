import assert from "node:assert/strict";
import Module, {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import type {StageContext} from "@/engine/types";
import {AcceptedMusicArrangementSchema} from "@/engine/acceptedMusicArrangement";
import {z} from "zod";

const retained=z.object({request:z.object({acceptedArrangement:AcceptedMusicArrangementSchema})})
  .parse(JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json","utf8")));
const arrangement=retained.request.acceptedArrangement, candidateSha256="a".repeat(64),audioSha256="b".repeat(64);
const root=`owner/${arrangement.ownerId}/runs/${arrangement.runId}/music/yue2-evaluation/`;
const jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";let submissions=0;
const material={candidateSha256,request:{acceptedArrangement:arrangement},candidate:{jobId,audioSha256,nativeOutput:{frames:48000}},
  listeningAudioKey:`${root}audio-native-${audioSha256}.wav`,quality:{status:"needs_audition"}};
type ModuleLoader={_load(request:string,parent?:unknown,isMain?:boolean):unknown};
const loader=Module as unknown as ModuleLoader,original=loader._load;
loader._load=function(request,parent,isMain) {
  if(request==="@/lib/hyperYoutubeYue")return {renderHyperYoutubeYue:async(input:{arrangement:typeof arrangement;authorize:()=>Promise<void>})=>{
    submissions++;assert.equal(input.arrangement.fingerprint,arrangement.fingerprint);await input.authorize();
    return {candidateSha256,candidateKey:`${root}candidate-hrs.json`};},readHyperYoutubeYue:async()=>material};
  if(request==="@/lib/bootstrap")return {bootstrapSecrets:async()=>{}};
  return original.call(this,request,parent,isMain);
};
async function main(){
  try {
    const {createHyperYuE2MusicManifest}=createRequire(__filename)("../yue2Music") as typeof import("../yue2Music");
    const ctx={ownerId:arrangement.ownerId,channelId:arrangement.channelId,runId:arrangement.runId,
      keyPrefix:`owner/${arrangement.ownerId}/`,params:{seed:42,personalCreatorAcknowledged:true},
      store:{topic:arrangement.topic,acceptedMusicArrangement:arrangement},assertInlinePaidExecutionLease:async()=>{},log:()=>{}} as unknown as StageContext;
    const manifest=createHyperYuE2MusicManifest(),result=await manifest.execute(ctx);
    const parsedCandidate=manifest.produces.yue2MusicCandidate.schema.parse(result.yue2MusicCandidate);
    assert.ok(parsedCandidate&&typeof parsedCandidate==="object"&&!Array.isArray(parsedCandidate));
    const candidate=parsedCandidate as Record<string,unknown>;
    assert.equal(candidate.version,"shared-yue2-music-candidate/v2-hrs");assert.equal(candidate.jobId,jobId);
    assert.equal(candidate.allocatedCostUsdMicros,null);assert.equal(candidate.costBasis,"unreported");
    assert.equal(candidate.productionApproved,false);assert.equal(submissions,1);
    await assert.rejects(manifest.execute({...ctx,ownerId:"foreign"}));assert.equal(submissions,1);
    console.log("YouTube HRS YuE module handoff: ok");
  } finally { loader._load=original; }
}
void main();
