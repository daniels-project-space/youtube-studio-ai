/**
 * A channel's declared visual identity must survive into every prompt the
 * pipeline builds, and must be the thing that DIFFERENTIATES two channels.
 *
 * The failure this exists to catch is specific and, on this codebase, proven to
 * recur: a hard-coded house look quietly standing in for a channel's own. It
 * had already happened three times — an amber accent for every channel that
 * declared none, one identical line-art description for every undeclared drawn
 * channel, and one narrator persona hard-coded in two blocks. Each read as a
 * sensible default and each erased the channel's identity.
 *
 * Asserting "the style string appears in the prompt" is not enough on its own,
 * because a prompt could contain the channel's words AND a stronger generic
 * clause that overrides them. So this is a DIFFERENTIAL test: the same story is
 * planned twice under two deliberately incompatible visual identities, and the
 * outputs must diverge. A watercolour channel and a hyperreal channel that
 * produce substantially the same prompts have lost the golden reference
 * whatever words survive in them.
 */
import assert from "node:assert/strict";

import { planVisualMatter, visualMatterAssetRequests } from "@/engine/visualMatter";

const story = {
  continuityLedger: {
    version: "1.0.0" as const,
    entities: [{ id: "entity-mara", name: "Mara", look: "a ship's cartographer with a salt-bleached coat" }],
    locations: [{ id: "location-deck", name: "Weather deck", look: "a wet timber deck under low cloud" }],
    era: "1770s",
    wardrobe: ["salt-bleached coat"],
    props: ["rolled chart", "brass dividers"],
    palette: ["storm grey", "wet timber", "pale sail"],
    cameraGrammar: ["slow handheld drift"],
    negativeConstraints: ["text", "watermarks"],
  },
  narrativeBeats: [{
    id: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    purpose: "establish the chart and the doubt",
    evidenceRefs: ["script:sentence:1"],
  }],
  shotList: [{
    id: "shot-0001",
    beatId: "beat-0001",
    sourceSentenceIds: ["sentence-0001"],
    t0: 0,
    t1: 6,
    coveragePurpose: "establish the chart and the doubt",
    literalContent: "Mara unrolls a chart across the wet deck.",
    entities: ["entity-mara"],
    locationId: "location-deck",
    era: "1770s",
    wardrobe: ["salt-bleached coat"],
    props: ["rolled chart", "brass dividers"],
    continuityState: "Mara and the deck remain coherent",
    cameraMove: "dolly_push" as const,
    shotScale: "medium" as const,
    lens: "35mm natural",
    lighting: "flat overcast",
    motion: "Mara flattens the chart against the wind.",
    negative: "text, watermarks",
    generationProfile: "production" as const,
    candidateCount: 2,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Mara and the chart on the weather deck.",
    seconds: 6,
    storyFunction: "introduction",
    section: "section-001",
    seed: 100001,
  }],
  dpVisualSpecs: [{
    shotId: "shot-0001",
    keyframePrompt: "Mara flattens a chart on a wet deck.",
    motionPrompt: "Slow drift as the chart lifts at one corner.",
    negativePrompt: "text, watermarks",
    styleLock: "storm grey, wet timber",
    firstFrameConstraint: "Mara holds the chart rolled at 0.00s",
    lastFrameConstraint: "Mara has flattened the chart at 6.00s",
    continuityState: "Mara and the deck remain coherent",
  }],
};

/** Everything the planner will hand to a renderer, flattened for comparison. */
function promptSurface(styleDNA: Record<string, unknown>, channelName: string): string {
  return surfaces(styleDNA, channelName).full;
}

/**
 * Two views of the same plan: the whole prompt surface, and the channelWorld
 * clause that carries the visual identity.
 *
 * They must be compared differently. Both channels tell the SAME story, so most
 * vocabulary — the cartographer, the chart, the deck, the era, the continuity
 * locks — is story content that SHOULD be identical. Measuring divergence over
 * the whole surface therefore reads 87% overlap for two opposite identities and
 * says nothing: that number is dominated by content the style has no business
 * changing. The style carrier is where divergence is meaningful.
 */
function surfaces(styleDNA: Record<string, unknown>, channelName: string): { full: string; world: string } {
  const manifest = planVisualMatter({
    topic: "The cartographer who found her own chart was wrong",
    channelName,
    styleDNA,
    visualBrief: { mood: "cold doubt at sea" },
    ...story,
  } as Parameters<typeof planVisualMatter>[0]);
  return {
    full: [
      manifest.channelWorld,
      ...manifest.storyboard.map((frame) => `${frame.promptAddendum} ${frame.motionAddendum}`),
      ...visualMatterAssetRequests(manifest, 8).map((request) => request.prompt),
    ].join("\n").toLowerCase(),
    world: manifest.channelWorld.toLowerCase(),
  };
}

const tokens = (text: string) => new Set(text.split(/[^a-z0-9-]+/).filter((word) => word.length > 3));

function overlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}

const WATERCOLOUR = {
  setting: "hand-painted watercolour seascape",
  colorGrade: "soft washed indigo and bone",
  lighting: "diffuse paper-grain light",
};
const HYPERREAL = {
  setting: "photoreal cinema, macro texture detail",
  colorGrade: "high-contrast teal and rust",
  lighting: "hard raking sunlight",
};

function main(): void {
  const watercolour = promptSurface(WATERCOLOUR, "Lorecraft");
  const hyperreal = promptSurface(HYPERREAL, "Ironclad");

  // 1. Each channel's own declared language must actually reach the prompts.
  for (const [label, surface, words] of [
    ["watercolour", watercolour, ["watercolour", "indigo", "paper-grain"]],
    ["hyperreal", hyperreal, ["photoreal", "teal", "raking"]],
  ] as const) {
    for (const word of words) {
      assert.ok(surface.includes(word), `${label} channel lost "${word}" from its prompts`);
    }
  }

  // 2. And must NOT contain the other channel's. A generic house clause strong
  //    enough to override either identity would show up in both.
  for (const foreign of ["watercolour", "paper-grain"]) {
    assert.ok(!hyperreal.includes(foreign), `hyperreal channel leaked "${foreign}" from the other identity`);
  }
  for (const foreign of ["photoreal", "raking"]) {
    assert.ok(!watercolour.includes(foreign), `watercolour channel leaked "${foreign}" from the other identity`);
  }

  // 3. DIVERGENCE, measured on the style carrier and calibrated against a
  //    control rather than a guessed number. Two opposite identities overlap
  //    48% here; the same style under a different channel name overlaps 92%.
  //    A threshold of 70% separates them, and the control below proves the
  //    metric actually responds — without it, a channelWorld that had become
  //    generic boilerplate would pass this test silently.
  const wcWorld = surfaces(WATERCOLOUR, "Lorecraft").world;
  const hrWorld = surfaces(HYPERREAL, "Ironclad").world;
  const sameStyleWorld = surfaces(WATERCOLOUR, "Ironclad").world;

  const divergent = overlap(wcWorld, hrWorld);
  const control = overlap(wcWorld, sameStyleWorld);
  assert.ok(
    divergent < 0.7,
    `two opposite visual identities share ${(divergent * 100).toFixed(0)}% of their style clause — ` +
    "the channel style is not driving the prompts",
  );
  assert.ok(
    control > divergent + 0.2,
    `the metric does not discriminate: same-style ${(control * 100).toFixed(0)}% vs ` +
    `different-style ${(divergent * 100).toFixed(0)}%`,
  );

  // 4. The style must reach the CHARACTER SHEET too, which is the asset most
  //    likely to be written as a generic model sheet and the one whose drift
  //    would then propagate into every shot that references the character.
  const sheets = visualMatterAssetRequests(
    planVisualMatter({
      topic: "The cartographer who found her own chart was wrong",
      channelName: "Lorecraft",
      styleDNA: { setting: "hand-painted watercolour seascape", colorGrade: "soft washed indigo and bone" },
      visualBrief: { mood: "cold doubt at sea" },
      ...story,
    } as Parameters<typeof planVisualMatter>[0]),
    8,
  ).filter((request) => request.kind === "character_sheet");
  assert.ok(sheets.length >= 1, "the fixture must plan a character sheet");
  for (const sheet of sheets) {
    assert.match(
      sheet.prompt.toLowerCase(),
      /watercolour/,
      `a character turnaround must stay in the channel's medium: ${sheet.prompt.slice(0, 160)}`,
    );
  }

  console.log(
    `STYLE FIDELITY PASS — opposite identities share ${(divergent * 100).toFixed(0)}% of their style clause, ` +
    `same identity ${(control * 100).toFixed(0)}%`,
  );
}

main();
