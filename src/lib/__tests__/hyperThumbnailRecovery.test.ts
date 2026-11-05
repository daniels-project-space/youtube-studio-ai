import assert from "node:assert/strict";
import { canonicalJson } from "@/lib/canonicalJson";
import { recoverHyperThumbnailIntent, type HyperThumbnailIntent } from "@/lib/hyperThumbnailRecovery";

async function main() {
  const candidateId="a".repeat(64), request={candidateId,videoId:"video",revision:0,title:"title",hook:"hook",heroSubject:"hero",visualDirection:"scene",creativeDirection:"HERO",referenceAssets:[]};
  const intent:HyperThumbnailIntent={version:"hrs-thumbnail-intent/v1",request,expectedReferenceHashes:{},expectedWords:["HERO"],mode:"native-scene-and-typography",estimatedGenerationCostUsd:0.135,estimatedImageCostUsd:0.135};
  let posts=0, gets=0, downloads=0;
  const client:any={submit:async()=>{posts++;throw new Error("lost POST response")},get:async()=>{gets++;return {state:"completed"}},download:async()=>{downloads++;return Buffer.from("verified")}};
  await assert.rejects(client.submit(),/lost POST response/);
  const read=async()=>Buffer.from(canonicalJson(intent));
  const recovered=await recoverHyperThumbnailIntent({key:"intent",requestHash:candidateId,client,read});
  assert.equal(recovered.state,"completed");assert.equal(posts,1);assert.equal(gets,1);assert.equal(downloads,1);
  for(const state of ["generating","uncertain","output-expired"]) {
    client.get=async()=>{gets++;return {state}};
    const pending=await recoverHyperThumbnailIntent({key:"intent",requestHash:candidateId,client,read});
    assert.equal(pending.state,state);
  }
  assert.equal(posts,1,"pending and uncertain recovery must never submit again");
  assert.equal(downloads,1);
  await assert.rejects(recoverHyperThumbnailIntent({key:"intent",requestHash:"b".repeat(64),client,read}),/invalid/i);
  console.log("HRS thumbnail recovery fixtures: ok");
}
void main();
