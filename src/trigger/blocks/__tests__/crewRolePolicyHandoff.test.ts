import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { z } from "zod";
import { buildChannelProfile } from "@/engine/channelProfile";
import type { ShowBible } from "@/engine/creative/types";
import type { StageContext } from "@/engine/types";

const requests: Array<{ role: string; prompt: string }> = [];
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network forbidden in crew policy regression"); };
loader._load = function (id, ...args) {
  if (id === "@/agents/mastra") return {
    agentJson: async (request: { role: string; prompt: string; schema: z.ZodType }) => {
      requests.push(request);
      return request.schema.parse(request.role === "editor"
        ? { sections: [{ name: "Opening", cutsPerMin: 3 }], transitions: "crossfade",
          captionStyle: "none", overlayRule: "No overlays" }
        : { assertions: [{ id: "duration", description: "Positive duration", check: "deterministic",
          metric: "durationSec", op: ">", threshold: 0, severity: "block" }] });
    },
  };
  return originalLoad.call(this, id, ...args);
};

const bible: ShowBible = { positioning: "Patient observation", vibe: "Quiet", iconicMotif: "Horizon",
  worksInSpace: [], avoidInSpace: [], activeCrew: ["editor", "critic"], refreshedAt: 1 };

async function main() {
  const { editorBriefBlock, criticSpecBlock } = createRequire(__filename)("../crewBlocks") as typeof import("../crewBlocks");
  for (const frozen of [false, true]) {
    for (const test of [
      { block: editorBriefBlock, params: { preset: "meditation" }, crew: {}, expected: { cadence: "still" } },
      { block: editorBriefBlock, params: { preset: "shorts" }, crew: { editorCadence: "slow" }, expected: { cadence: "frenetic" } },
      { block: editorBriefBlock, params: { preset: "meditation", cadence: "snappy" }, crew: {}, expected: { cadence: "snappy" } },
      { block: editorBriefBlock, params: {}, crew: { editorCadence: "slow" }, expected: { cadence: "slow" } },
      { block: criticSpecBlock, params: { preset: "meditation" }, crew: {}, expected: { strictness: "lenient", marketAware: false } },
      { block: criticSpecBlock, params: { preset: "documentary" }, crew: { criticStrictness: "lenient" }, expected: { strictness: "strict", marketAware: true } },
      { block: criticSpecBlock, params: { preset: "meditation", strictness: "strict", marketAware: true }, crew: {}, expected: { strictness: "strict", marketAware: true } },
      { block: criticSpecBlock, params: {}, crew: { criticStrictness: "lenient", marketAwareCritic: false }, expected: { strictness: "lenient", marketAware: false } },
    ]) {
      const moduleOverrides = { "show-bible": test.crew, [test.block.id]: test.params };
      const profile = buildChannelProfile({ row: { _id: "channel", name: "C", slug: "c", status: "active",
        template: "narrated_stock", budget: 0, identity: { creativeBrief: bible } }, archetype: "narrated_stock",
        pipeline: [{ block: test.block.id }], moduleOverrides });
      const ctx: StageContext = { ownerId: "owner", channelId: "channel", runId: "run", keyPrefix: "fixture/",
        params: {}, budgetUsd: 0, log: () => {}, store: { topic: "Dawn", ...(frozen
          ? { channelProfile: profile }
          : { showBible: bible, channelSlug: "c", channelModuleConfig: moduleOverrides }) } };
      // Historic invocations receive their effective role params from the runner.
      if (!frozen) ctx.params = test.params;
      const before = structuredClone({ store: ctx.store, params: ctx.params });
      const patch = await test.block.run(ctx);
      const output = (patch.cutSheet ?? patch.validationSpec) as { config: Record<string, unknown>; directives?: unknown };
      for (const [key, value] of Object.entries(test.expected)) {
        assert.equal(output.config[key], value, `${frozen ? "frozen" : "legacy"} ${test.block.id} ${JSON.stringify(test.params)} ${key}`);
      }
      const directiveLine = requests.at(-1)!.prompt.split("\n").find(line => line.startsWith("Operator role directives: "))!;
      assert.deepEqual(JSON.parse(directiveLine.slice("Operator role directives: ".length)), JSON.parse(JSON.stringify(output.directives ?? output.config)));
      assert.deepEqual(ctx.store, before.store);
      assert.deepEqual(ctx.params, before.params);
    }
  }
  console.log("CREW ROLE POLICY PASS: 16 real block handoffs; role presets, explicit knobs and crew fallback; prompt/output agreement; no network");
}

void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
});
