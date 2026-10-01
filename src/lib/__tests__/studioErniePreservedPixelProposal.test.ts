import assert from "node:assert/strict";
import test from "node:test";
import { buildStudioErniePreservedPixelProposal } from "../studioErniePreservedPixelProposal";
import { STUDIO_ERNIE_CONTRACT } from "../renderEngineErnieClient";
for (const [profileId, width, height] of [["production",1920,1088],["hero",2048,1152]] as const) {
  test(`${profileId} proposal preserves exact approved pixels and all Final settings without admitting execution`, () => {
    const proposal = buildStudioErniePreservedPixelProposal({ profileId, candidate: { id:"s0-c0", prompt:"A dramatic natural landscape", seed:1234 }, maxCostUsd:2 });
    assert.equal(proposal.dispatchable,false); assert.equal(proposal.registered,false); assert.equal(proposal.finalQualified,false);
    assert.deepEqual(proposal.reviewGraph["6"].inputs,{width,height,batch_size:1});
    assert.equal(proposal.reviewGraph["7"].inputs.steps,50); assert.equal(proposal.reviewGraph["7"].inputs.cfg,4);
    assert.deepEqual(proposal.runtimeArgs,["--bf16-unet"]);
    assert.ok(proposal.reviewGraph["11"].inputs.prompt.includes(JSON.stringify({prompt:"A dramatic natural landscape",width,height})));
    assert.equal(proposal.currentWorker.acceptsGeometry,false); assert.equal(proposal.currentWorker.sha256,STUDIO_ERNIE_CONTRACT.workerSha256);
    assert.equal(proposal.maxCostUsd,2); assert.equal(proposal.candidate.seed,1234);
    assert.equal(proposal.sourceSupport.comfy.dimensionStep,16); assert.equal(width%16,0); assert.equal(height%16,0);
  });
}
test("proposal rejects invalid prompt, seed and spending caps before freezing a review candidate", () => {
  const args = { profileId:"production" as const, candidate:{ id:"s0-c0",prompt:"A dramatic natural landscape",seed:1 },maxCostUsd:2 };
  assert.throws(()=>buildStudioErniePreservedPixelProposal({...args,candidate:{...args.candidate,seed:0x100000000}}),/outside/);
  assert.throws(()=>buildStudioErniePreservedPixelProposal({...args,candidate:{...args.candidate,prompt:""}}),/outside/);
  assert.throws(()=>buildStudioErniePreservedPixelProposal({...args,maxCostUsd:0}),/outside/);
});
