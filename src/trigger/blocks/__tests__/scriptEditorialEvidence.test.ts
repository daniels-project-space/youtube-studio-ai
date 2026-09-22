import assert from "node:assert/strict";
import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { createModelUsageScope } from "@/lib/modelUsage";
import type { StageContext } from "@/engine/types";
import { qaScript } from "../narratedBlocks";

const claim = "Seed Atlas recorded 20 sprouts in week one and 35 in week two.";
function packet(numericAnchor = "20 and 35") {
  return createEditorialEvidencePacket({
    subject: "Weekly seed growth",
    sources: [{ id: "seed-atlas", name: "Seed Atlas", url: "https://example.org/seed-atlas",
      snapshotSha256: "a".repeat(64), kind: "dataset" }],
    claims: [{ id: "weekly-sprouts", sourceIds: ["seed-atlas"], approvedText: claim,
      numericAnchor, context: "Reviewed weekly comparison." }],
    review: { reviewerId: "fixture-editor", reviewId: "fixture-review", reviewedAt: new Date().toISOString() },
  });
}

async function main() {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  let criticCalls = 0;
  const context: StageContext = {
    ownerId: "editorial-owner", channelId: "editorial-channel", runId: "editorial-run",
    keyPrefix: "owner/editorial-owner/", budgetUsd: 20, params: {}, log: () => {},
    store: { narrationText: claim, editorialEvidencePacket: packet() },
  };
  try {
    process.env.OPENROUTER_API_KEY = "synthetic-no-provider-access";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      criticCalls++;
      const body = JSON.parse(String(init?.body));
      return Response.json({ id: `editorial-fixture-${criticCalls}`, model: body.model,
        choices: [{ message: { content: JSON.stringify({ pass: true, issues: [] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.003 } });
    };
    for (const narrationText of ["Seed Atlas recorded a strong second week.",
      claim.replace("35", "350"), "Seed Atlas recorded 20 sprouts in week one. And 35 in week two."]) {
      const before = criticCalls;
      await assert.rejects(createModelUsageScope().run(() => qaScript.run({ ...context,
        store: { ...context.store, narrationText } })), /qa_script FAILED: editorial evidence/);
      assert.equal(criticCalls, before, "missing/changed/split reviewed claims fail before buying a critic verdict");
    }
    await assert.rejects(qaScript.run({ ...context, store: { ...context.store,
      editorialEvidencePacket: packet("20 and 36") } }), /approved numeric anchor/);
    await assert.rejects(qaScript.run({ ...context, store: { ...context.store,
      editorialEvidencePacket: { ...packet(), contentFingerprint: "0".repeat(64) } } }), /qa_script FAILED: editorial evidence/);
    assert.equal(criticCalls, 0);

    assert.deepEqual(await createModelUsageScope().run(() => qaScript.run(context)), { scriptApproved: true });
    assert.equal(criticCalls, 1, "evidence alignment never replaces the independent craft critic");
    assert.deepEqual(await createModelUsageScope().run(() => qaScript.run({ ...context,
      store: { narrationText: "A fictional seed found water beneath the stone." } })), { scriptApproved: true });
    assert.equal(criticCalls, 2, "packet-free legacy narration keeps its existing critic path");

    registerAllBlocks();
    const graph = validatePipeline([{ block: "editorial_evidence_packet" }, { block: "qa_script" },
      { block: "narration_tts" }], ["editorialEvidencePacketInput", "narrationText"]);
    const stages: Array<{ block: string; status: string }> = [];
    const before = criticCalls;
    const result = await runPipeline(graph, { ownerId: context.ownerId, channelId: context.channelId,
      runId: context.runId, keyPrefix: context.keyPrefix, budgetUsd: 20, defaultRetries: 2,
      seedStore: { editorialEvidencePacketInput: packet(), narrationText: "The reviewed numbers vanished." },
      sink: { async upsert(row) { stages.push({ block: row.block, status: row.status }); } },
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /qa_script FAILED: editorial evidence/);
    assert.equal(result.costTotal, 0);
    assert.equal(criticCalls, before);
    assert.equal(result.store.scriptApproved, undefined);
    assert.equal(stages.some(stage => stage.block === "narration_tts"), false);
    console.log("EDITORIAL PRE-SYNTHESIS PASS: real packet producer/QA/runner stop missing, changed and split claims before critic/TTS; valid and legacy paths preserved");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
