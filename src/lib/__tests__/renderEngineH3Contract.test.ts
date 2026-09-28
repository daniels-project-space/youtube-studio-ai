import assert from "node:assert/strict";
import {
  RENDER_ENGINE_H3_CONTRACT,
  assertRenderEngineH3BatchHandoff,
  buildRenderEngineH3BatchHandoff,
  exactRenderEngineH3Contract,
  readRenderEngineH3Contract,
} from "@/lib/renderEngineH3Contract";
import { MINIMAX_H3_MANIFEST_SHA256, MINIMAX_H3_PROFILE, MINIMAX_H3_WORKER_CONTRACT } from "@/lib/minimaxH3Admission";

const contract = {
  schema: RENDER_ENGINE_H3_CONTRACT,
  projectName: "youtube-studio",
  workflowId: "a".repeat(32),
  profile: MINIMAX_H3_PROFILE,
  modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
  workerReceiptSchema: MINIMAX_H3_WORKER_CONTRACT,
  firstFrameSourceBucket: "youtube-studio-ai",
  outputBucket: "youtube-studio-ai",
  openingMotionQa: "minimax-h3-opening-motion-qa/v1",
  qualifiedHyper: true,
  paidDispatchEnabled: true,
};
assert.equal(exactRenderEngineH3Contract(contract), true);
assert.equal(exactRenderEngineH3Contract({ ...contract, profile: { ...contract.profile, width: 864, height: 480 } }), false);
assert.equal(exactRenderEngineH3Contract({ ...contract, qualifiedHyper: false }), false);
assert.equal(exactRenderEngineH3Contract({ ...contract, modelManifestSha256: "b".repeat(64) }), false);

const handoff = buildRenderEngineH3BatchHandoff({
  ownerId: "owner1",
  orderKey: "weekly:1",
  receiptKey: "owner/owner1/h3/week.json",
  jobs: [{
    prompt: "A continuous cinematic motion shot of a cyclist riding through a city street.",
    seed: 5,
    firstFrame: { r2Key: "owner/owner1/h3/frame.png", sha256: "a".repeat(64) },
    output: { r2Key: "owner/owner1/h3/shot.mp4" },
    maxCostUsd: 0.4,
  }],
});
assert.equal(handoff.profile.width, 1344);
assert.equal(handoff.profile.height, 768);
assert.equal(handoff.profile.frames, 124);
assert.equal(handoff.jobs[0]?.firstFrame.r2Key, "owner/owner1/h3/frame.png");
assert.equal(handoff.jobs[0]?.output.r2Key, "owner/owner1/h3/shot.mp4");
assert.match(handoff.jobs[0]!.sourceRequestKey, /^[a-f0-9]{64}$/u);
assert.doesNotThrow(() => assertRenderEngineH3BatchHandoff(handoff));
assert.throws(() => assertRenderEngineH3BatchHandoff({ ...handoff, profile: { ...handoff.profile, width: 864 } }), /frozen Studio profile/);
assert.throws(() => assertRenderEngineH3BatchHandoff({ ...handoff, receiptKey: "owner/owner1/../other/week.json" }), /frozen Studio profile/);
assert.throws(() => assertRenderEngineH3BatchHandoff({ ...handoff, jobs: [{ ...handoff.jobs[0]!, sourceRequestKey: "b".repeat(64) }] }), /frozen source request/);
assert.throws(() => buildRenderEngineH3BatchHandoff({
  ownerId: "owner1", orderKey: "weekly:1", receiptKey: "owner/owner1/h3/week.json",
  jobs: [{ ...handoff.jobs[0]!, firstFrame: { r2Key: "owner/other/frame.png", sha256: "a".repeat(64) } }],
}), /outside the owner scope/);

async function main() {
  let calls = 0;
  const env = {
    MINIMAX_H3_HYPER_EMERGENCY: "1",
    RENDER_ENGINE_PROJECT_TOKEN: "a".repeat(64),
    RENDER_ENGINE_CONVEX_SITE_URL: "https://render-engine.example/",
  };
  const result = await readRenderEngineH3Contract({
    env,
    fetcher: async (url, init) => {
      calls += 1;
      assert.equal(init?.method, "GET");
      assert.equal(new URL(String(url)).pathname, "/client/h3-contract");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, `Bearer ${env.RENDER_ENGINE_PROJECT_TOKEN}`);
      return Response.json(contract);
    },
  });
  assert.deepEqual(result, { contractMatched: true, endpoint: "https://render-engine.example", workflowId: contract.workflowId });
  assert.equal(calls, 1);
  assert.deepEqual(await readRenderEngineH3Contract({ env: {}, fetcher: async () => { throw new Error("must not call"); } }),
    { contractMatched: false, reason: "Hyper emergency route is disabled" });
  const missing = await readRenderEngineH3Contract({ env, fetcher: async () => new Response("Not Found", { status: 404 }) });
  assert.deepEqual(missing, { contractMatched: false, reason: "Render Engine exact H3 contract unavailable (HTTP 404)" });
  const weaker = await readRenderEngineH3Contract({ env, fetcher: async () => Response.json({ ...contract, profile: { ...contract.profile, width: 864 } }) });
  assert.equal(weaker.contractMatched, false);
}

void main();
