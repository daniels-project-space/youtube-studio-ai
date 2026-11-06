import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {canonicalJson} from "@/lib/canonicalJson";
import {makePlanWeekHrsProviderRenderReceipt,planWeekHrsCandidateIdentity,
  validatePlanWeekProviderRenderReceipt,verifyPlanWeekProviderReceiptCryptography} from "@/lib/planWeekRenderReceipt";

async function main() {
  const scope = {ownerId:"owner",channelId:"channel",batchId:"batch",itemId:"item",attempt:1,
    requestKey:"request",checkpointKey:"thumbnail:item:1",destinationKey:"projects/studio/final.jpg"};
  const candidateId=createHash("sha256").update(planWeekHrsCandidateIdentity(scope)).digest("hex");
  const request={candidateId,videoId:"studio-1",revision:1,title:"Title",hook:"Hook",heroSubject:"Hero",visualDirection:"Scene",creativeDirection:'Render "HERO"',referenceAssets:[]};
  const identity={provider:"google-gemini-api" as const,modelId:"gemini-3-pro-image" as const,
    settings:{aspectRatio:"16:9" as const,imageSize:"2K" as const},candidateId,request,referenceAssets:[]};
  const result={id:"one",projectId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",videoId:request.videoId,revision:1,state:"completed" as const,completedAt:"2026-11-04T12:00:00.000Z",
    ...identity,requestSha256:createHash("sha256").update(canonicalJson(identity)).digest("hex"),sourceSha256:null,
    output:{bucket:"studio",key:"projects/studio/native.png",sha256:"a".repeat(64),bytes:42,contentType:"image/png" as const,downloadUrl:"https://r2.example/output",expiresInSeconds:900}};
  const receipt=makePlanWeekHrsProviderRenderReceipt(scope,{result,sourceKey:"projects/studio/source",width:2752,height:1536,expectedWords:["HERO"],estimatedCostUsd:0.135});
  assert.equal(validatePlanWeekProviderRenderReceipt(receipt,scope),true);
  assert.equal(await verifyPlanWeekProviderReceiptCryptography(receipt),true);
  assert.equal(await verifyPlanWeekProviderReceiptCryptography({...receipt,candidateId:"0".repeat(64)}),false);
  assert.equal(validatePlanWeekProviderRenderReceipt({...receipt,ownerId:"other"},scope),false);
  assert.equal(receipt.accounting,"estimate");
  const replay=makePlanWeekHrsProviderRenderReceipt(scope,{result,sourceKey:"projects/studio/source",width:2752,height:1536,expectedWords:["HERO"],estimatedCostUsd:0.135});
  assert.deepEqual(replay,receipt,"the server completion timestamp makes receipt replay deterministic");
  assert.equal("downloadUrl" in receipt,false);
  console.log("Plan-week HRS receipt fixtures: ok");
}
void main();
