import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
const forbidden: string[] = [];
const imports: string[] = [];
let networkCalls = 0;
loader._load = function (id, ...args) {
  imports.push(id);
  try {
  if (/^@\/trigger\/|^@trigger\.dev|^@\/engine\/blocks$|^@\/lib\/(?:bootstrap|storage|yue2ExecutionAccounting|yue2Evaluation|yue2DurableEvaluation)$/u.test(id)) {
    forbidden.push(id); throw new Error(`preview attempted runtime import: ${imports.join(" -> ")}`);
  }
  return originalLoad.call(this, id, ...args);
  } finally { imports.pop(); }
};
globalThis.fetch = async () => { networkCalls++; throw new Error("preview network forbidden"); };

async function main() {
  try {
    const { POST } = createRequire(import.meta.url)("./route");
    const { assertChannelPipelinePreviewSnapshot } = createRequire(import.meta.url)("@/engine/channelPipelinePreview.server");
    const sourceParams = { seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04,
      executionPolicy: { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
        rate_source: "operator_configured", rate_reference: "synthetic preview fixture, not a current price",
        runtime_id: "youtube-studio-fixture", hourly_rate_usd_micros: 180000, max_execution_seconds: 600,
        termination_grace_seconds: 10, reserved_allocation_usd_micros: 30500 } };
    const request = (body: unknown) => POST(new Request("https://fixture.invalid/api/channel-pipeline-preview", {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
    }));
    for (const [family, playback, role] of [["music_loop", "repeat", "primary_music"],
      ["sleep", "repeat", "meditation_bed"], ["sleep", "once", "meditation_bed"],
      ["narrated_stock", "once", "narration_bed"], ["shorts", "once", "short_form_bed"]] as const) {
      const programBrief = createChannelProgramBrief({ family, nicheKey: "educational", locale: "en",
        concept: `Original ${family} programming for adults.` });
      const body = { programBrief, yue2Music: { musicIntent: { playback, role, requestedDurationSec: 30 }, sourceParams } };
      const response = await request(body);
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.match(response.headers.get("cache-control"), /no-store/u);
      const preview = await response.json();
      assert.ok(preview.blocks.includes("music_arrangement_plan"));
      const legacy = await (await request({ programBrief })).json();
      assert.notEqual(preview.pipelineFingerprint, legacy.pipelineFingerprint);
      assert.throws(() => assertChannelPipelinePreviewSnapshot(legacy, preview), /stale/u,
        "a legacy review snapshot cannot authorize the selected music route");
      for (const patch of [{ maxCostUsd: 0.01 }, { personalCreatorAcknowledged: false }, { provider: "suno" },
        { executionPolicy: { ...sourceParams.executionPolicy, reserved_allocation_usd_micros: 1 } }]) {
        const denied = await request({ ...body, yue2Music: { ...body.yue2Music, sourceParams: { ...sourceParams, ...patch } } });
        assert.equal(denied.status, 400);
        assert.match((await denied.json()).error, /yue2Music/u, "nested validation keeps its field path");
      }
    }
    assert.deepEqual(forbidden, []);
    assert.equal(networkCalls, 0);
    console.log("YUE2 COLD PREVIEW PASS: five family/playback paths, source config rejection, no runtime/provider imports or networking.");
  } finally { loader._load = originalLoad; globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
