import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARCHETYPES } from "@/engine/archetypes";
import type { StyleDNA } from "@/engine/creative/types";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import {
  generateBananaImage,
} from "@/lib/banana";
import { probe, solidImage } from "@/lib/ffmpeg";
import { buildStyleDnaPlaybook } from "@/lib/thumbnailLab";
import { planThumbnailText, type ThumbnailTextZone } from "@/lib/thumbnailLayout";
import {
  buildThumbnailImageRequest,
  isThumbnailBaseProvenance,
  renderThumbnail,
  type ThumbnailRenderSpec,
} from "@/lib/thumbnailRenderer";

const DNA: StyleDNA = {
  source: "research+vision",
  confidence: 0.9,
  groundingGaps: [],
  palette: ["#0a192f", "#b2c8ba", "#fdebd0"],
  recurringSubject: "a luminous river stone beside two resting hands",
  setting: "a calm twilight riverbank with soft mist",
  composition: "subject on the right third with clean negative space",
  colorGrade: "deep twilight blue with a warm cream rim light",
  motifs: ["river stone", "soft mist"],
  variationAxes: ["season"],
  motionVocabulary: ["mist drift"],
  motionDiscipline: "locked camera",
  visualAvoid: ["generic stock meditation pose"],
  thumbnail: {
    composition: "hero on one third; high contrast; clean opposing text zone",
    textRule: "maximum three benefit-led words",
    palette: ["#0a192f", "#b2c8ba", "#fdebd0"],
    subject: "the luminous gratitude stone and human connection",
  },
  audio: {
    genre: "ambient",
    bpmRange: [50, 65],
    instrumentation: ["soft piano"],
    textures: ["river"],
    moodArc: "release into rest",
    loudnessLufs: -16,
    loopable: true,
  },
  seo: {
    titleFormula: "[BENEFIT] for [MOMENT]",
    descriptionStructure: "promise, practice, invitation",
    playlistStrategy: "benefit",
  },
  refreshedAt: 1,
};

function assertFamilyPolicy(): void {
  const productionFamilies: FamilyKey[] = [
    "whiteboard",
    "comic",
    "sleep",
    "music_loop",
    "narrated_stock",
  ];
  for (const familyKey of productionFamilies) {
    const family = FAMILIES[familyKey];
    assert.equal(family.defaultThumbnailStyle, "banana", `${familyKey} must never create a production title card`);
    assert.equal(
      ARCHETYPES[family.archetypeKey].thumbnailTemplate,
      "banana",
      `${familyKey}'s compatibility archetype must use the real engine`,
    );
    const playbook = buildStyleDnaPlaybook({
      dna: DNA,
      family: familyKey,
      channelName: `Fixture ${familyKey}`,
      now: 123,
    });
    assert.equal(playbook.source, "style_dna_foundation");
    assert.equal(playbook.refsUsed.length, 0, "foundation provenance must not pretend to have references");
    assert.equal(playbook.patterns.length, 3);
    assert.ok(playbook.patterns.every((pattern) => pattern.fluxRecipe.includes(DNA.thumbnail.subject)));
    assert.ok(playbook.patterns.every((pattern) => !/title[_ -]?card/i.test(pattern.fluxRecipe)));
  }
}

function assertSceneTypographySplit(): void {
  const spec: ThumbnailRenderSpec = {
    scene: {
      description: "A stoic statue stopping a spear with a cracked golden shield",
      imageStyle: "cinematic marble sculpture",
      palette: ["#111111", "#ffd400"],
      accentColor: "#ffd400",
      textZone: "left",
    },
    typography: {
      lines: [
        { text: "DEFEND YOUR", payoff: false },
        { text: "PEACE", payoff: true },
      ],
      subtitle: "THE QUIET STOIC",
      font: "impact",
      treatment: "plate",
    },
  };
  const request = buildThumbnailImageRequest(spec);
  const prompt = request.prompt;
  assert.equal(request.allowText, false);
  assert.equal(request.tier, "flash");
  assert.equal(request.aspectRatio, "16:9");
  assert.doesNotMatch(prompt, /DEFEND YOUR|PEACE|QUIET STOIC/i);
  assert.match(prompt, /no text, letters, words, numbers/i);
  assert.match(prompt, /left 42%/i);

  assert.throws(
    () => buildThumbnailImageRequest({
      ...spec,
      scene: { ...spec.scene, description: "A plaque reading DEFEND YOUR beside the statue" },
    }),
    /typography leaked into scene prompt/i,
  );
  assert.doesNotThrow(
    () => buildThumbnailImageRequest({
      ...spec,
      scene: { ...spec.scene, description: "A peaceful marble guardian at sunrise" },
    }),
    "one semantic headline keyword must remain legal scene grounding",
  );

  assert.equal(isThumbnailBaseProvenance(undefined, "left"), false);
  assert.equal(isThumbnailBaseProvenance({
    contract: "thumbnail-base-v1", textFree: true, safeZone: "right", source: "verified-video-still",
  }, "left"), false);
  assert.equal(isThumbnailBaseProvenance({
    contract: "thumbnail-base-v1", textFree: true, safeZone: "left", source: "verified-video-still",
  }, "left"), true);
}

async function assertRealCallPaths(): Promise<void> {
  const paths = [
    "src/lib/thumbnailLab.ts",
    "src/trigger/blocks/intelligenceBlocks.ts",
    "src/trigger/planWeekAhead.ts",
    "src/lib/speechThumbnail.ts",
  ];
  for (const path of paths) {
    const source = await readFile(join(process.cwd(), path), "utf8");
    assert.doesNotMatch(source, /bananaUsesNativeTypography|bananaThumbnail\s*\(|allowText\s*:\s*true/,
      `${path} must never delegate thumbnail typography to an image provider`);
  }
  const production = await readFile(
    join(process.cwd(), "src/trigger/blocks/intelligenceBlocks.ts"),
    "utf8",
  );
  assert.match(production, /buildStyleDnaPlaybook/, "no-playbook path must use the Style-DNA foundation");
  assert.doesNotMatch(production, /titleCardFallback|fal-route judge rejection/,
    "generic cards must not be automatic recovery");
  assert.match(production, /draft_preview_placeholder/);
}

function assertSafePlans(): void {
  const titles = [
    "Gratitude for the People Beside You",
    "The Basic Conceptual Framework of Taxation",
    "7 Secrets of the Forgotten Battlefield Relic",
  ];
  const zones: ThumbnailTextZone[] = ["left", "right", "upperLeft", "upperRight", "center"];
  for (const title of titles) {
    for (const zone of zones) {
      const plan = planThumbnailText({ lines: [{ text: title }], zone });
      assert.ok(plan.lines.length >= 2, `${title} should wrap in ${zone}`);
      for (const line of plan.lines) {
        assert.ok(line.x >= plan.safeInset, `${zone} left bound`);
        assert.ok(line.y >= plan.safeInset, `${zone} top bound`);
        assert.ok(line.x + line.width <= plan.width - plan.safeInset, `${zone} right bound`);
        assert.ok(line.y + line.height <= plan.height - plan.safeInset, `${zone} bottom bound`);
      }
    }
  }
}

async function assertRenderedLayout(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "thumbnail-root-cause-"));
  try {
    const basePath = await solidImage(join(directory, "base.jpg"), 1_280, 720, "#16243a");
    const outJpg = join(directory, "thumbnail.jpg");
    let generated = 0;
    await renderThumbnail({
      spec: {
        scene: {
          description: "A luminous river stone beside two resting hands",
          imageStyle: "ethereal twilight editorial scene",
          textZone: "left",
        },
        typography: {
          lines: [{ text: "Gratitude for the People Beside You", payoff: true }],
          subtitle: "Gratitude Springs",
          accentColor: "#b2c8ba",
          font: "serif",
          uppercase: false,
          treatment: "clean",
        },
      },
      outJpg,
      tmpDir: directory,
      baseArt: {
        path: basePath,
        provenance: {
          contract: "thumbnail-base-v1",
          textFree: true,
          safeZone: "left",
          source: "verified-video-still",
        },
      },
      generateScene: async () => {
        generated += 1;
        throw new Error("verified base must be reused");
      },
    });
    assert.equal(generated, 0);
    const media = await probe(outJpg);
    assert.equal(media.width, 1_280);
    assert.equal(media.height, 720);
    assert.equal(media.hasVideo, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertRetryBoundarySignal(): Promise<void> {
  const previous = {
    fetch: globalThis.fetch,
    geminiKey: process.env.GEMINI_API_KEY,
    disableGemini: process.env.IMAGE_DISABLE_GEMINI,
    providers: process.env.IMAGE_PROVIDERS,
    forcedModel: process.env.BANANA_FORCE_MODEL,
  };
  let calls = 0;
  try {
    process.env.GEMINI_API_KEY = "fixture";
    process.env.IMAGE_DISABLE_GEMINI = "0";
    delete process.env.IMAGE_PROVIDERS;
    process.env.BANANA_FORCE_MODEL = "fixture-image-model";
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("fixture transport failure");
    }) as typeof fetch;
    await assert.rejects(
      generateBananaImage({ prompt: "fixture", allowText: false, tier: "flash" }),
      /provider retry budget exhausted.*fixture transport failure/i,
    );
    assert.equal(calls, 2, "the provider owns one bounded two-attempt loop");
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.geminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.geminiKey;
    if (previous.disableGemini === undefined) delete process.env.IMAGE_DISABLE_GEMINI;
    else process.env.IMAGE_DISABLE_GEMINI = previous.disableGemini;
    if (previous.providers === undefined) delete process.env.IMAGE_PROVIDERS;
    else process.env.IMAGE_PROVIDERS = previous.providers;
    if (previous.forcedModel === undefined) delete process.env.BANANA_FORCE_MODEL;
    else process.env.BANANA_FORCE_MODEL = previous.forcedModel;
  }
}

async function main(): Promise<void> {
  assertFamilyPolicy();
  assertSceneTypographySplit();
  assertSafePlans();
  await assertRealCallPaths();
  await assertRenderedLayout();
  await assertRetryBoundarySignal();
  console.log("THUMBNAIL ROOT-CAUSE PASS");
}

void main();
