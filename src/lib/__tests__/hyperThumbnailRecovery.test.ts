import assert from "node:assert/strict";
import { canonicalJson } from "@/lib/canonicalJson";
import { recoverHyperThumbnailIntent, type HyperThumbnailIntent, type RecoveryClient } from "@/lib/hyperThumbnailRecovery";
import type { HyperThumbnailResult } from "@/lib/hyperThumbnailClient";

async function main() {
  const candidateId="a".repeat(64), request={candidateId,videoId:"video",revision:0,title:"title",hook:"hook",heroSubject:"hero",visualDirection:"scene",creativeDirection:"HERO",referenceAssets:[]};
  const intent:HyperThumbnailIntent={version:"hrs-thumbnail-intent/v1",request,expectedReferenceHashes:{},expectedWords:["HERO"],mode:"native-scene-and-typography",estimatedGenerationCostUsd:0.135,estimatedImageCostUsd:0.135};
  let posts=0, gets=0, downloads=0;
  const completed:HyperThumbnailResult={id:"job",candidateId:request.candidateId,projectId:"project",videoId:request.videoId,
    revision:request.revision,state:"completed",provider:"google-gemini-api",modelId:"gemini-3-pro-image",
    settings:{aspectRatio:"16:9",imageSize:"2K"},request,completedAt:"2026-11-05T00:00:00.000Z",
    requestSha256:"c".repeat(64),referenceAssets:[],sourceSha256:null,
    output:{bucket:"youtube",key:"projects/youtube/jobs/video/output.png",sha256:"d".repeat(64),bytes:8,
      contentType:"image/png",downloadUrl:"https://example.com/output.png",expiresInSeconds:300}};
  let state="completed";
  const client:RecoveryClient={get:async()=>{gets++;return state==="completed"?completed:{state}},
    download:async()=>{downloads++;return Buffer.from("verified")}};
  const submit=async()=>{posts++;throw new Error("lost POST response")};
  await assert.rejects(submit(),/lost POST response/);
  const read=async()=>Buffer.from(canonicalJson(intent));
  const recovered=await recoverHyperThumbnailIntent({key:"intent",requestHash:candidateId,client,read});
  assert.equal(recovered.state,"completed");assert.equal(posts,1);assert.equal(gets,1);assert.equal(downloads,1);
  for(const pendingState of ["generating","uncertain","output-expired"]) {
    state=pendingState;
    const pending=await recoverHyperThumbnailIntent({key:"intent",requestHash:candidateId,client,read});
    assert.equal(pending.state,pendingState);
  }
  assert.equal(posts,1,"pending and uncertain recovery must never submit again");
  assert.equal(downloads,1);
  await assert.rejects(recoverHyperThumbnailIntent({key:"intent",requestHash:"b".repeat(64),client,read}),/invalid/i);
  console.log("HRS thumbnail recovery fixtures: ok");
}
void main();
