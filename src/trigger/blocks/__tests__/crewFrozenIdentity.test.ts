import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { z } from "zod";
import { buildChannelProfile } from "@/engine/channelProfile";
import type { ShowBible } from "@/engine/creative/types";
import type { StageContext } from "@/engine/types";
import { openRouterModel } from "@/lib/openRouter";
import { arrangementComposerReservation } from "@/lib/arrangementComposerBudget";

type Request = { role: string; prompt: string; schema: z.ZodType; beforeDispatch?: () => Promise<void> };
const calls: Request[] = [];
const arrangement = {
  role: "primary_music", direction: "Quiet original instrumental music.", requestedDurationSec: 30,
  form: "continuous", ending: "natural_cadence", playback: "repeat",
  sections: Array.from({ length: 4 }, (_, index) => ({ id: `section-${index}`, label: `Section ${index}`,
    startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.2, instruction: "Keep the texture steady." })),
};
const responses: Record<string, unknown> = {
  crew_director: { hook: "A quiet opening", beats: [{ name: "Opening", intentSec: 30, note: "Observe." }] },
  cinematographer: { footageQueries: ["quiet forest morning"], promptStyle: "Natural light" },
  editor: { sections: [{ name: "Opening", cutsPerMin: 3 }], transitions: "crossfade" },
  composer: { musicPrompt: "Quiet original instrumental music.", duckDb: -12, bedLufs: -22 },
  critic: { assertions: [{ id: "duration", description: "Positive duration", check: "deterministic",
    metric: "durationSec", op: ">", threshold: 0, severity: "block" }] },
  composer_arrangement: { arrangement, duckDb: -12, bedLufs: -22, symbolicScore: "fixture score: no GPU execution" },
};
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("No network permitted in identity regression"); };
loader._load = function (id, ...args) {
  if (id === "@/agents/mastra") return {
    agentJsonConfiguration: () => ({ model: openRouterModel("intelligence"), system: "Fixture composer system" }),
    agentJson: async (request: Request) => {
      await request.beforeDispatch?.();
      calls.push(request);
      const response = structuredClone(responses[request.role]) as Record<string, unknown>;
      if (request.role === "composer_arrangement") {
        const persona = /Channel persona: ([^\n]+)/u.exec(request.prompt)?.[1];
        const topic = /Video topic: "([^"]+)"/u.exec(request.prompt)?.[1];
        const sections = (response.arrangement as { sections: Array<{ id: string }> }).sections;
        const sectionIds = sections.map((section) => section.id);
        response.channelGrounding = [
          { source: "channel_persona", cue: persona, decisions: [
            { dimension: "space", choice: "Keep the stereo image close and intimate, avoiding distant or arena-sized reverb." },
            { dimension: "dynamics", choice: "Limit dynamic growth so no gesture becomes theatrical or attention seeking." },
          ], sectionIds },
          { source: "episode_topic", cue: topic, decisions: [
            { dimension: "texture", choice: "Use a restrained upper haze that evokes the named episode without literal effects." },
            { dimension: "harmony", choice: "Hold open intervals without a triumphant cadence or sentimental arrival." },
          ], sectionIds },
        ];
      }
      return request.schema.parse(response);
    },
  };
  return originalLoad.call(this, id, ...args);
};

async function main() {
  const load = createRequire(__filename);
  const { CREW_BLOCKS } = load("../crewBlocks") as typeof import("../crewBlocks");
  const { registerAllBlocks } = load("@/engine/blocks") as typeof import("@/engine/blocks");
  const { getManifest } = load("@/engine/registry") as typeof import("@/engine/registry");
  const { ComposerBriefWithArrangementSchema } = load("@/engine/creative/crew") as typeof import("@/engine/creative/crew");
  const { musicArrangementPlan } = load("../musicArrangementBlocks") as typeof import("../musicArrangementBlocks");
  registerAllBlocks();
  const bible: ShowBible = { positioning: "Careful observation", vibe: "Patient", iconicMotif: "A horizon",
    worksInSpace: ["Understatement"], avoidInSpace: ["Hype"], refreshedAt: 1,
    activeCrew: ["director", "cinematographer", "editor", "composer", "critic"] };
  const blocks = [...CREW_BLOCKS, getManifest("composer_brief", "3.1.0-yue2-score-grounding")!.block];
  assert.equal(CREW_BLOCKS.length, 5);
  const stale = { channelName: "STALE HYPE BRAND", niche: "STALE CELEBRITY NICHE", persona: "STALE PERSONA",
    styleGrammar: "STALE GRAMMAR", channelSlug: "stale-slug", showBible: { ...bible, positioning: "STALE BIBLE" } };
  for (const identity of [
    { name: "Forest Study", niche: "Quiet field observation", persona: "Patient naturalist", styleGrammar: "Restrained detail" },
    { name: "Evening Piano", niche: "Instrumental relaxation", persona: "Intimate performer", styleGrammar: "Unhurried and warm" },
    { name: "Unspecified Niche", persona: "Precise observer", styleGrammar: "No invented category" },
  ]) {
    const profile = buildChannelProfile({ row: { _id: "channel-fixture", name: identity.name, slug: "canonical-channel",
      status: "active", template: "narrated_stock", budget: 1,
      identity: { ...identity, creativeBrief: bible } }, archetype: "narrated_stock",
      pipeline: CREW_BLOCKS.map(block => ({ block: block.id, params: { family: "narrated_stock" } })) });
    for (const block of blocks) {
      const ctx: StageContext = { ownerId: "owner-fixture", channelId: "channel-fixture", runId: "run-fixture",
        keyPrefix: "fixture/", params: { family: "narrated_stock" }, budgetUsd: 1,
        stageBudgetUsd: arrangementComposerReservation(openRouterModel("intelligence"), true),
        assertInlinePaidExecutionLease: async () => {}, log: () => {},
        store: { ...stale, topic: "A quiet morning", channelProfile: structuredClone(profile) } };
      const before = structuredClone({ store: ctx.store, params: ctx.params });
      const patch = await block.run(ctx);
      const prompt = calls.at(-1)!.prompt;
      assert.ok(prompt.startsWith(`Channel: ${identity.name}${identity.niche ? ` (${identity.niche})` : ""}.`), block.id);
      assert.doesNotMatch(prompt, /STALE/, `${block.id} must not mix canonical and loose identity`);
      assert.deepEqual(ctx.store, before.store);
      assert.deepEqual(ctx.params, before.params);
      if (calls.at(-1)!.role === "composer_arrangement") {
        const brief = ComposerBriefWithArrangementSchema.parse(patch.musicBrief);
        assert.equal(brief.reviewContext!.channelName, identity.name);
        assert.ok(brief.reviewContext!.promptContext.includes(identity.persona));
        assert.ok(brief.reviewContext!.promptContext.includes(identity.styleGrammar));
        const accepted = await musicArrangementPlan.run({ ...ctx, store: { ...ctx.store, ...patch } });
        assert.deepEqual((accepted.acceptedMusicArrangement as { reviewContext: unknown }).reviewContext, brief.reviewContext);
      }
      const count = calls.length;
      await assert.rejects(block.run({ ...ctx, store: { ...ctx.store, channelProfile: { id: "malformed" } } }));
      assert.equal(calls.length, count, "invalid frozen identity fails before text dispatch, not loose-key fallback");
    }
  }
  // Historical invocations without the canonical profile retain their loose-key identity.
  for (const block of CREW_BLOCKS) {
    await block.run({ ownerId: "owner-fixture", channelId: "channel-fixture", runId: "legacy-fixture", keyPrefix: "fixture/",
      params: { family: "narrated_stock" }, budgetUsd: 0, log: () => {}, store: { ...stale, topic: "Legacy topic" } });
    assert.ok(calls.at(-1)!.prompt.startsWith(`Channel: ${stale.channelName} (${stale.niche}).`));
  }
  assert.equal(networkCalls, 0);
  console.log("CREW FROZEN IDENTITY PASS: five real prompt producers plus scored composer, distinct identities, absent niche, malformed profile before dispatch, review-context handoff, legacy parity; no providers");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
});
