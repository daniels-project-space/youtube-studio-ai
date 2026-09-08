import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createChannelProgramBrief,
  type ChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { deriveCreatorIntentDiagnosis } from "@/engine/creatorIntentDiagnosis";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { POST } from "./route";

const DEFAULT_TOGGLES = {
  quotes: true,
  captions: true,
  chapters: true,
  notify: true,
  crosspost: false,
  shorts: true,
  documentaryCandidates: false,
  visualMatter: true,
};

const ROUTED_FAMILIES = [
  "narrated_stock",
  "music_loop",
  "sleep",
  "comic",
  "shorts",
  "whiteboard",
  "loreshort",
  "quizyear",
  "illustrated_explainer",
  "cinematic",
] as const;

function briefFor(family: typeof ROUTED_FAMILIES[number]): ChannelProgramBrief {
  return createChannelProgramBrief({
    family,
    nicheKey: "educational",
    locale: "en",
    concept: `A repeatable original ${family} channel for curious adult viewers.`,
    ...(family === "quizyear"
      ? { programIntent: { kind: "certified_quiz" as const, profile: "world_geography" as const } }
      : {}),
  });
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://studio.test/api/channel-pipeline-preview", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function directDesign(
  programBrief: ChannelProgramBrief,
  input: Pick<DesignOptions, "toggles" | "approvedForPublish">,
) {
  const programRoute = resolveChannelProgramRoute(programBrief);
  const creatorIntentDiagnosis = deriveCreatorIntentDiagnosis({ programBrief, programRoute });
  return {
    programRoute,
    design: designPipeline({
      family: programBrief.family,
      nicheKey: programBrief.nicheKey,
      programBrief,
      programRoute,
      creatorIntentDiagnosis,
      locale: programBrief.locale,
      publishMode: "draft",
      toggles: input.toggles,
      approvedForPublish: input.approvedForPublish,
      ...(programRoute.syntheticScenarioProfile
        ? { syntheticScenario: syntheticScenarioContract(programRoute.syntheticScenarioProfile) }
        : {}),
      ...(programRoute.quizProfile ? { quizProfile: programRoute.quizProfile } : {}),
      capabilitySelections: [],
    }),
  };
}

async function main(): Promise<void> {
  const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const wizardSource = readFileSync(
    new URL("../../(app)/channels/new/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(routeSource, /authorizeStudioRoute/, "read-only compilation must not require owner verification");
  assert.doesNotMatch(routeSource, /process\.env|Trigger|Convex/, "preview compilation must have no provider or persistence authority");
  assert.match(routeSource, /MAX_PREVIEW_BODY_BYTES/, "preview input must be bounded");
  assert.doesNotMatch(wizardSource, /function previewBlocks|ARCHETYPES|FAMILY_CREW|CREW_ROLE_BLOCK/);
  assert.match(wizardSource, /fetch\("\/api\/channel-pipeline-preview"/);
  assert.match(wizardSource, /pipelinePreview\.status !== "ready"/);

  for (const family of ROUTED_FAMILIES) {
    const programBrief = briefFor(family);
    const response = await POST(request({ programBrief, toggles: DEFAULT_TOGGLES }));
    assert.equal(response.status, 200, `${family} must produce a read-only exact preview`);
    const preview = await response.json() as {
      version: string;
      routeKey: string;
      routeFingerprint: string;
      pipelineFingerprint: string;
      blocks: string[];
      episodeLengthSeconds: number;
      contentLane: string;
    };
    const { programRoute, design: expected } = directDesign(programBrief, {
      toggles: DEFAULT_TOGGLES,
    });
    assert.equal(preview.version, "channel-pipeline-preview/v1");
    assert.equal(preview.routeKey, programRoute.routeKey);
    assert.equal(preview.routeFingerprint, programRoute.fingerprint);
    assert.deepEqual(preview.blocks, expected.pipeline.map((entry) => entry.block));
    assert.equal(preview.pipelineFingerprint, sha256Hex(canonicalJson(expected.pipeline)));
    assert.equal(preview.episodeLengthSeconds, expected.episodeLengthSeconds);
    assert.equal(preview.contentLane, expected.contentLane.key);
  }

  const toggleVariants: Array<{
    label: string;
    toggles: NonNullable<DesignOptions["toggles"]>;
    approvedForPublish?: boolean;
  }> = [
    { label: "quotes off", toggles: { ...DEFAULT_TOGGLES, quotes: false } },
    { label: "captions off", toggles: { ...DEFAULT_TOGGLES, captions: false } },
    { label: "chapters off", toggles: { ...DEFAULT_TOGGLES, chapters: false } },
    { label: "notify off", toggles: { ...DEFAULT_TOGGLES, notify: false } },
    { label: "shorts off", toggles: { ...DEFAULT_TOGGLES, shorts: false } },
    { label: "documentary candidates", toggles: { ...DEFAULT_TOGGLES, documentaryCandidates: true } },
    {
      label: "crosspost approved",
      toggles: { ...DEFAULT_TOGGLES, crosspost: true },
      approvedForPublish: true,
    },
  ];
  for (const family of ROUTED_FAMILIES) {
    const programBrief = briefFor(family);
    for (const variant of toggleVariants) {
      let expected: ReturnType<typeof directDesign> | undefined;
      let expectedError: unknown;
      try {
        expected = directDesign(programBrief, variant);
      } catch (error) {
        expectedError = error;
      }
      const response = await POST(request({
        programBrief,
        toggles: variant.toggles,
        ...(variant.approvedForPublish ? { approvedForPublish: true } : {}),
      }));
      if (expectedError) {
        assert.equal(response.status, 400, `${family} / ${variant.label} must expose the compiler rejection`);
        continue;
      }
      assert.equal(response.status, 200, `${family} / ${variant.label} must compile`);
      const actual = await response.json() as { blocks: string[]; pipelineFingerprint: string };
      assert.deepEqual(actual.blocks, expected!.design.pipeline.map((entry) => entry.block));
      assert.equal(actual.pipelineFingerprint, sha256Hex(canonicalJson(expected!.design.pipeline)));
    }
  }

  const narratedBrief = briefFor("narrated_stock");
  const expandedResponse = await POST(request({
    programBrief: narratedBrief,
    approvedForPublish: true,
    toggles: {
      ...DEFAULT_TOGGLES,
      quotes: false,
      notify: false,
      crosspost: true,
      shorts: false,
      documentaryCandidates: true,
    },
  }));
  assert.equal(expandedResponse.status, 200);
  const expanded = await expandedResponse.json() as { blocks: string[]; pipelineFingerprint: string };
  assert.equal(expanded.blocks.includes("quote_overlays"), false);
  assert.equal(expanded.blocks.includes("notify"), false);
  assert.equal(expanded.blocks.includes("shorts_spinoff"), false);
  assert.equal(expanded.blocks.includes("crosspost"), true);
  assert.equal(expanded.blocks.includes("documentary_short_candidates"), true);

  const chapterlessResponse = await POST(request({
    programBrief: narratedBrief,
    toggles: { ...DEFAULT_TOGGLES, chapters: false },
  }));
  assert.equal(chapterlessResponse.status, 200);
  const chapterless = await chapterlessResponse.json() as { blocks: string[]; pipelineFingerprint: string };
  const baseline = await (await POST(request({
    programBrief: narratedBrief,
    toggles: DEFAULT_TOGGLES,
  }))).json() as { blocks: string[]; pipelineFingerprint: string };
  assert.deepEqual(chapterless.blocks, baseline.blocks);
  assert.notEqual(
    chapterless.pipelineFingerprint,
    baseline.pipelineFingerprint,
    "the fingerprint must represent parameter-only compiler changes as well as visible block order",
  );

  const requiredCaptionResponse = await POST(request({
    programBrief: narratedBrief,
    toggles: { ...DEFAULT_TOGGLES, captions: false },
  }));
  assert.equal(requiredCaptionResponse.status, 400);
  assert.match(
    (await requiredCaptionResponse.json() as { error: string }).error,
    /missing required module captions/,
  );

  const unknownField = await POST(request({
    programBrief: narratedBrief,
    toggles: DEFAULT_TOGGLES,
    runtimeTarget: { injected: true },
  }));
  assert.equal(unknownField.status, 400, "browser input cannot supply server runtime authority");

  const staleBrief = { ...narratedBrief, catalogFingerprint: "0".repeat(64) };
  assert.equal((await POST(request({ programBrief: staleBrief }))).status, 400);
  assert.equal((await POST(new Request("https://studio.test/api/channel-pipeline-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }))).status, 400);
  assert.equal((await POST(request({}, { "content-length": String(65 * 1024) }))).status, 413);

  console.log("Channel pipeline preview exact-compiler tests passed");
}

void main();
