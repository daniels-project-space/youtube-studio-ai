import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARCHETYPES } from "@/engine/archetypes";
import type { StyleDNA } from "@/engine/creative/types";
import { classifyExecutionError } from "@/engine/executionErrors";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import {
  BananaImageSubmissionError,
  generateNanoBananaImageWithReceipt,
  NANO_BANANA_THUMBNAIL_PROFILE,
} from "@/lib/banana";
import { GEMINI_RUNTIME_OPT_IN_ENV } from "@/lib/gemini";
import { createImageUsageScope } from "@/lib/imageUsage";
import {
  buildThumbnailTextFilterGraph,
  probe,
  regionLuma,
  resolveThumbnailTextStyle,
  solidImage,
  thumbnailText,
  THUMBNAIL_TEXT_OBJECTS,
} from "@/lib/ffmpeg";
import { buildStyleDnaPlaybook } from "@/lib/thumbnailLab";
import { GOLDEN_THUMBNAIL_CRAFT_RULES } from "@/lib/thumbnailGoldenStandard";
import { thumbnailOcrMatchesExpected } from "@/lib/thumbnailOcr";
import {
  scoreThumbnailStoryInterest,
  STORY_INTEREST_DOCTRINE,
} from "@/lib/thumbnailStoryInterest";
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

function assertNativeCopyOcrGate(): void {
  assert.deepEqual(
    thumbnailOcrMatchesExpected({
      ocrText: "$1K/MO\nCASH ENGINE\nINVESTORY",
      expectedWords: ["$1K/MO", "CASH ENGINE"],
    }),
    {
      matched: true,
      exact: true,
      missing: [],
      misspelled: [],
      leaked: [],
      normalizedOcr: "$1K/MO CASH ENGINE INVESTORY",
    },
  );
  const mutated = thumbnailOcrMatchesExpected({
    ocrText: "$1,000/M0\nCASH LOOP\nINVESTORY",
    expectedWords: ["$1K/MO", "CASH ENGINE"],
  });
  assert.equal(mutated.exact, false, "provider-mutated native copy must fail closed");
  assert.deepEqual(mutated.missing, ["$1K/MO", "CASH ENGINE"]);

  // LEAK GUARD: an art-direction word baked into the artwork adds no missing
  // copy, so a presence-only check scores it exact and ships it. This is the
  // defect that put "HUGE" on an Inked Histories thumbnail and "PAYOFF" on an
  // Investory one.
  const leak = thumbnailOcrMatchesExpected({
    ocrText: "EMPTY\nBY DAWN\nHUGE\nINKED HISTORIES",
    expectedWords: ["EMPTY", "BY DAWN"],
  });
  assert.deepEqual(leak.missing, [], "the leaked word does not remove any planned copy");
  assert.equal(leak.matched, true, "presence-only checking cannot see this defect");
  assert.deepEqual(leak.leaked, ["HUGE"], "instruction words rendered as artwork must be reported");
  assert.equal(leak.exact, false, "a rendered instruction word must fail closed");

  // A channel that genuinely plans one of those words is unaffected.
  const planned = thumbnailOcrMatchesExpected({
    ocrText: "THE PAYOFF\nEXPLAINED",
    expectedWords: ["THE PAYOFF", "EXPLAINED"],
  });
  assert.deepEqual(planned.leaked, [], "planned copy must never be treated as a leak");
  assert.equal(planned.exact, true);

  // SPELLING GUARD: the fuzzy allowance exists so stylized type is not read as
  // absent copy, but silently passing a near-miss ships a misspelled thumbnail.
  const misspelt = thumbnailOcrMatchesExpected({
    ocrText: "GONE QUIETLI\nINVESTORY",
    expectedWords: ["GONE QUIETLY"],
  });
  assert.deepEqual(misspelt.missing, [], "the word was attempted, not omitted");
  assert.equal(misspelt.matched, true, "the lenient reading still finds it");
  assert.deepEqual(
    misspelt.misspelled,
    [{ expected: "QUIETLY", observed: "QUIETLI" }],
    "a word that only survived on spelling fuzz must be reported",
  );
  assert.equal(misspelt.exact, false, "a misspelled headline must fail closed");

  const spelled = thumbnailOcrMatchesExpected({
    ocrText: "GONE QUIETLY\nINVESTORY",
    expectedWords: ["GONE QUIETLY"],
  });
  assert.deepEqual(spelled.misspelled, [], "correct spelling must not be flagged");
  assert.equal(spelled.exact, true);

  // A reader clipping the last glyph of oversized type is an OCR crop, not a
  // spelling error. Blocking on it would fail correct thumbnails, so a strict
  // prefix/suffix of the planned word must pass.
  const clipped = thumbnailOcrMatchesExpected({
    ocrText: "THE SWITCH\n60 SECON",
    expectedWords: ["THE SWITCH", "60 SECONDS"],
  });
  assert.deepEqual(clipped.misspelled, [], "an OCR truncation must not be reported as a misspelling");
  assert.equal(clipped.exact, true, "a clipped read of correct copy must not fail closed");
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
  const request = buildThumbnailImageRequest(spec.scene);
  const prompt = request.prompt;
  assert.equal(request.allowText, false);
  assert.equal(request.tier, "flash");
  assert.equal(request.aspectRatio, "16:9");
  assert.doesNotMatch(prompt, /DEFEND YOUR|PEACE|QUIET STOIC/i);
  assert.match(prompt, /no text, letters, words, numbers/i);
  assert.match(prompt, /left 42%/i);
  assert.match(prompt, /avoid a dead 50\/50 split/i);
  assert.match(prompt, /intrude 6-10%/i);
  assert.ok(
    GOLDEN_THUMBNAIL_CRAFT_RULES.every((rule) => prompt.includes(rule)),
    "provider scene prompt must carry every user-approved Golden craft rule",
  );

  const treatedRequest = buildThumbnailImageRequest({
    ...spec.scene,
    requiredVisualDirectives: [
      "original clearly illustrative fictional artwork only",
      "never a recognizable real person, real place, or factual map",
    ],
  });
  assert.equal(treatedRequest.allowText, false, "policy directions must not move disclosure text into provider pixels");
  assert.match(treatedRequest.prompt, /non-negotiable visual treatment/i);
  assert.match(treatedRequest.prompt, /illustrative fictional artwork only/i);
  assert.match(treatedRequest.prompt, /never a recognizable real person, real place, or factual map/i);

  assert.doesNotThrow(
    () => buildThumbnailImageRequest({
        ...spec.scene,
        description: "A market crash survival scene with a shielded investor at sunrise",
    }),
    "week-ahead fallback scenes may legitimately describe the title subject",
  );
  const sameSceneRequest = buildThumbnailImageRequest({ ...spec.scene });
  assert.equal(sameSceneRequest.prompt, prompt, "scene-only provider request must be deterministic");

  assert.equal(isThumbnailBaseProvenance(undefined, "left"), false);
  assert.equal(isThumbnailBaseProvenance({
    contract: "thumbnail-base-v1", textFree: true, safeZone: "right", source: "verified-video-still",
  }, "left"), false);
  assert.equal(isThumbnailBaseProvenance({
    contract: "thumbnail-base-v1", textFree: true, safeZone: "left", source: "verified-video-still",
  }, "left"), true);
}

function assertStoryInterestIntelligence(): void {
  // The two real candidates this gate was built from. Same channel genre, same
  // craft quality, same centred layout — the only difference is whether the
  // SUBJECT carries a human stake.
  const inert = scoreThumbnailStoryInterest({
    title: "The Bank That Was Robbed Through Its Own Wall",
    heroProp: "a steel vault door fills the centre while two gloved hands drive a diamond core drill into its lock collar",
    headlineWords: ["18 INCHES", "OF CONCRETE"],
  });
  const compelling = scoreThumbnailStoryInterest({
    title: "The Airport Switch That Fooled Everyone",
    heroProp: "a man in a wide-lapel 1970s suit sits dead centre facing the lens, his shoe pushing an identical briefcase across the carpet, caught mid-swap",
    headlineWords: ["THE SWITCH", "60 SECONDS"],
  });
  assert.equal(compelling.verdict, "compelling", "a human caught mid-deception must score as a strong subject");
  assert.notEqual(inert.verdict, "compelling", "a measurement of a building material must not pass as a strong subject");
  assert.ok(
    compelling.score > inert.score + 20,
    `the human-stake concept must clearly outrank the inert-material one (${compelling.score} vs ${inert.score})`,
  );
  assert.ok(
    inert.reasons.some((reason) => /measurement of an inert material/.test(reason)),
    "the gate must name WHY the subject is weak, not just score it",
  );
  assert.ok(inert.liftPrompts.length > 0, "a weak subject must come with concrete corrections");

  // A bare material with nobody acting on it is the floor case.
  const floor = scoreThumbnailStoryInterest({
    title: "How Vault Walls Are Built",
    heroProp: "a thick concrete wall panel",
    headlineWords: ["12 TONNES", "OF STEEL"],
  });
  assert.equal(floor.verdict, "inert", "an unattended raw material must score as inert");

  // Craft words must not rescue a dull subject, and a strong subject must not
  // be punished for lacking them.
  assert.ok(
    STORY_INTEREST_DOCTRINE.some((rule) => /never the story/i.test(rule)),
    "the art director must be told outright that materials are not subjects",
  );
}

function assertMotifImplementations(): void {
  const signatures = new Set<string>();
  const expected: Record<(typeof THUMBNAIL_TEXT_OBJECTS)[number], RegExp> = {
    torn_strip: /0xfff4d6.*t=fill/,
    paint_smear: /0x42d6c5@0\.82:t=fill/,
    censor_bar: /0x42d6c5@0\.96:t=fill/,
    grunge_sticker: /color=black@0\.96:t=fill/,
    spaced_elegant: /M  A  R  K  E  T/,
    block_plate: /:h=8:color=0x42d6c5@0\.95:t=fill/,
    neon_sign: /borderw=15:bordercolor=0x42d6c5@0\.20/,
    spray_paint: /:w=5:h=18:color=0x42d6c5@0\.76:t=fill/,
    stamp_ink: /fontcolor=0x42d6c5@0\.34/,
    movie_poster: /fontcolor=black@0\.72/,
    ransom_note: /0xff8f80@0\.96:t=fill/,
    carved: /fontcolor=white@0\.34/,
    // Scene-integrated headline: carved depth on the tall condensed face at
    // dominant scale, distinct from `carved`'s editorial serif.
    scene_forged: /BebasNeue\.ttf/,
  };
  for (const textObject of THUMBNAIL_TEXT_OBJECTS) {
    const style = resolveThumbnailTextStyle({ textObject });
    assert.equal(style.motif, textObject);
    const graph = buildThumbnailTextFilterGraph({
      title: "MARKET CRASH",
      lines: [{ text: "MARKET", accent: false }, { text: "CRASH", payoff: true }],
      position: "left",
      subtitle: "INVESTORY",
      accentColor: "#42d6c5",
      textObject,
    });
    assert.match(graph, expected[textObject], `${textObject} must reach its executable FFmpeg treatment`);
    signatures.add(graph);
  }
  assert.equal(signatures.size, THUMBNAIL_TEXT_OBJECTS.length, "every Style-DNA motif must render distinctly");
  assert.equal(
    resolveThumbnailTextStyle({ textObject: "future_unvalidated_motif", treatment: "plate" }).motif,
    "legacy",
    "unknown persisted motif data must degrade before rendering rather than crash after paid scene generation",
  );
  assert.equal(
    resolveThumbnailTextStyle({ treatment: "clean", font: "bebas" }).motif,
    "movie_poster",
    "older clean condensed Style DNA must inherit a physical Golden text motif",
  );
  assert.equal(
    resolveThumbnailTextStyle({ treatment: "stamp", font: "marker" }).motif,
    "stamp_ink",
    "older stamped Style DNA must inherit the executable ink motif",
  );

  const cornerBadgeGraph = buildThumbnailTextFilterGraph({
    title: "MARKET CRASH",
    lines: [{ text: "MARKET CRASH", payoff: true }],
    subtitle: "INVESTORY",
    badgePlacement: "bottomRight",
  });
  assert.match(cornerBadgeGraph, /text='INVESTORY'.*x=w-text_w-62:y=h-104/,
    "compact channel identity belongs in the lower-right corner by default");

  const speechGraph = buildThumbnailTextFilterGraph({
    title: "STAY HARD",
    lines: [{ text: "STAY HARD", payoff: true }],
    subtitle: "MINDSET",
    footerLabel: "David Goggins",
    accentColor: "#ffd27a",
  });
  assert.match(speechGraph, /text='MINDSET'.*x=w-text_w-44:y=38/);
  assert.match(speechGraph, /text='D A V I D.*G O G G I N S'.*y=h-58/);
  assert.doesNotMatch(speechGraph, /text='MINDSET'.*y=h\*0\.92/,
    "speech badge and speaker footer must never share the bottom baseline");

  const grungePunctuation = buildThumbnailTextFilterGraph({
    title: "MARKET:",
    lines: [{ text: "MARKET:", payoff: true }],
    position: "left",
    textObject: "grunge_sticker",
  });
  assert.match(grungePunctuation, /text='market\\:'/);
  assert.doesNotMatch(grungePunctuation, /text='market\\:\.'/,
    "grunge casing must preserve existing terminal punctuation");

  const smearContrast = buildThumbnailTextFilterGraph({
    title: "CRASH",
    lines: [{ text: "CRASH", payoff: true }],
    position: "left",
    accentColor: "#42d6c5",
    textObject: "paint_smear",
  });
  assert.match(smearContrast, /drawtext=.*fontcolor=black:/,
    "paint-smear text must use the measured high-contrast foreground, not the smear color");
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
  assert.match(
    production,
    /resolveGoldenThumbnailPlaybook/,
    "no-playbook path must use the shared Golden Style-DNA foundation",
  );
  assert.doesNotMatch(production, /titleCardFallback|fal-route judge rejection/,
    "generic cards must not be automatic recovery");
  assert.doesNotMatch(production, /draft_preview_placeholder|thumbnailer\s*===\s*["']title_card["']/,
    "every thumbnail execution must use Nano Banana; title-card previews are not an executable route");
  assert.match(production, /thumbnailDescription/,
    "the image route must receive a concrete visual handoff rather than infer a scene from the title alone");
  const weekAhead = await readFile(join(process.cwd(), "src/trigger/planWeekAhead.ts"), "utf8");
  assert.doesNotMatch(weekAhead, /enacts\s+\\?"\$\{o\.title\}/,
    "the deterministic scene fallback must not inject headline/title copy into provider art");
  assert.match(weekAhead, /subject through people, objects, and action:\s*\$\{o\.topic\}/);
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
          textObject: "spaced_elegant",
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

    const percentPath = join(directory, "percent-thumbnail.jpg");
    await thumbnailText({
      basePath,
      outJpg: percentPath,
      title: "%",
      lines: [{ text: "%", payoff: true }],
      position: "left",
      textObject: "spaced_elegant",
      textColor: "white",
      accentColor: "#ffffff",
      textShadow: false,
    });
    const [baseLuma, renderedLuma] = await Promise.all([
      regionLuma(basePath, 0, 0.2),
      regionLuma(percentPath, 0, 0.2),
    ]);
    assert.ok(
      renderedLuma > baseLuma + 1,
      `literal-percent headline must render visible pixels (base=${baseLuma}, rendered=${renderedLuma})`,
    );

    const longBase = await solidImage(join(directory, "long-base.png"), 1_280, 720, "#000000");
    const longPath = join(directory, "long-thumbnail.png");
    const longText = "DONAUDAMPFSCHIFFFAHRTSGESELLSCHAFT";
    const spaced = resolveThumbnailTextStyle({ textObject: "spaced_elegant" });
    const longPlan = planThumbnailText({
      lines: [{ text: longText, payoff: true }],
      zone: "left",
      tracking: spaced.tracking,
      fontScale: spaced.fontScale,
    });
    assert.ok(longPlan.lines.length >= 3, "overlong unbroken words must hard-wrap before rendering");
    assert.ok(longPlan.lines.every((line) => line.x + line.width <= 704));
    await thumbnailText({
      basePath: longBase,
      outJpg: longPath,
      title: longText,
      lines: [{ text: longText, payoff: true }],
      position: "left",
      textObject: "spaced_elegant",
      textColor: "white",
      accentColor: "#ffffff",
      textShadow: false,
    });
    const [longLeft, longRight, longBaseRight] = await Promise.all([
      regionLuma(longPath, 0, 0.5),
      regionLuma(longPath, 0.55, 0.45),
      regionLuma(longBase, 0.55, 0.45),
    ]);
    assert.ok(longLeft > longBaseRight + 1, "hard-wrapped tracked headline must remain visible");
    assert.ok(
      longRight <= longBaseRight + 1,
      `tracked headline must stay out of the hero zone (base=${longBaseRight}, right=${longRight})`,
    );
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
      generateNanoBananaImageWithReceipt({ prompt: "fixture" }),
      (error: unknown) =>
        error instanceof BananaImageSubmissionError &&
        error.retryable === false &&
        classifyExecutionError(error).retryable === false,
    );
    assert.equal(calls, 1, "ambiguous transport must never repeat a potentially-paid submission");

    // A server error is equally ambiguous and must not fall through from the
    // requested Pro model to a second (lower-quality) model.
    calls = 0;
    delete process.env.BANANA_FORCE_MODEL;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "fixture upstream failure" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await assert.rejects(
      generateNanoBananaImageWithReceipt({ prompt: "outer-recovery-fixture" }),
      (error: unknown) =>
        error instanceof BananaImageSubmissionError &&
        error.status === 503 &&
        classifyExecutionError(error).retryable === false,
    );
    assert.equal(calls, 1, "an ambiguous response must not retry or switch image models");
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

async function assertStrictNanoBananaRoute(): Promise<void> {
  const previous = {
    fetch: globalThis.fetch,
    geminiKey: process.env.GEMINI_API_KEY,
    disableGemini: process.env.IMAGE_DISABLE_GEMINI,
    providers: process.env.IMAGE_PROVIDERS,
    forcedModel: process.env.BANANA_FORCE_MODEL,
    falKey: process.env.FAL_KEY,
  };
  let calls = 0;
  const providerPng = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(providerPng, 0);
  providerPng.writeUInt32BE(13, 8);
  providerPng.write("IHDR", 12, "ascii");
  providerPng.writeUInt32BE(1_344, 16);
  providerPng.writeUInt32BE(768, 20);
  try {
    process.env.GEMINI_API_KEY = "fixture";
    process.env.IMAGE_DISABLE_GEMINI = "1";
    process.env.IMAGE_PROVIDERS = "fal,gemini";
    process.env.BANANA_FORCE_MODEL = "forbidden-model-override";
    process.env.FAL_KEY = "fixture-fal-that-must-not-be-used";
    globalThis.fetch = (async (input, init) => {
      calls += 1;
      assert.match(String(input), /\/v1beta\/models\/gemini-2\.5-flash-image:generateContent/);
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{
          text?: string;
          inlineData?: { data: string; mimeType: string };
        }> }>;
        generationConfig: { responseModalities: string[]; imageConfig: Record<string, string> };
      };
      assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
      assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: "16:9" });
      if (calls === 1) {
        assert.equal(body.contents[0].parts.length, 1);
        assert.match(body.contents[0].parts[0].text ?? "", /ABSOLUTE RULE — PICTURE ONLY, NO TEXT/);
      } else {
        assert.equal(body.contents[0].parts.length, 2);
        assert.doesNotMatch(body.contents[0].parts[0].text ?? "", /ABSOLUTE RULE — PICTURE ONLY, NO TEXT/);
        assert.match(body.contents[0].parts[0].text ?? "", /"Night Focus"/);
        assert.match(body.contents[0].parts[0].text ?? "", /"4K"/);
        assert.equal(body.contents[0].parts[1].inlineData?.mimeType, "image/png");
      }
      return new Response(JSON.stringify({
        modelVersion: "gemini-2.5-flash-image-2025-08",
        responseId: "fixture-nano-response",
        usageMetadata: {
          candidatesTokenCount: 1_290,
          promptTokenCount: 96,
          totalTokenCount: 1_386,
        },
        candidates: [{ content: { parts: [{
          inlineData: { data: providerPng.toString("base64"), mimeType: "image/png" },
        }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const usageScope = createImageUsageScope();
    const result = await usageScope.run(() => generateNanoBananaImageWithReceipt({
      prompt: "A text-free Stoic scene",
      idempotencyContext: "fixture-attempt-1",
    }));
    assert.equal(calls, 1);
    assert.deepEqual(result.bytes, providerPng);
    assert.equal(result.receipt.provider, NANO_BANANA_THUMBNAIL_PROFILE.provider);
    assert.equal(result.receipt.model, NANO_BANANA_THUMBNAIL_PROFILE.model);
    assert.equal(result.receipt.route, NANO_BANANA_THUMBNAIL_PROFILE.route);
    assert.equal(result.receipt.width, 1344);
    assert.equal(result.receipt.height, 768);
    assert.equal(result.receipt.promptTokenCount, 96);
    assert.equal(result.receipt.promptCostUsd, 0.0000288);
    assert.equal(result.receipt.outputCostUsd, 0.039);
    assert.equal(result.receipt.costUsd, 0.0390288);
    assert.equal(result.receipt.modelVersion, "gemini-2.5-flash-image-2025-08");
    assert.equal(result.receipt.responseId, "fixture-nano-response");
    const usage = usageScope.snapshot();
    assert.equal(usage.calls, 1);
    assert.equal(usage.records[0]?.provider, "gemini");
    assert.equal(usage.records[0]?.route, "nano-banana-flash");
    assert.equal(usage.records[0]?.width, 1344);
    assert.equal(usage.records[0]?.height, 768);
    assert.equal(usage.records[0]?.costUsd, 0.0390288);

    await assert.rejects(
      generateNanoBananaImageWithReceipt({
        prompt: "x".repeat(NANO_BANANA_THUMBNAIL_PROFILE.maxPromptUtf8Bytes),
      }),
      /fail-closed maximum/,
    );
    assert.equal(calls, 1, "oversized prompt must be rejected before a provider submission");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["GEMINI_API_KEY", previous.geminiKey],
      ["IMAGE_DISABLE_GEMINI", previous.disableGemini],
      ["IMAGE_PROVIDERS", previous.providers],
      ["BANANA_FORCE_MODEL", previous.forcedModel],
      ["FAL_KEY", previous.falKey],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function main(): Promise<void> {
  const originalGeminiRuntime = process.env[GEMINI_RUNTIME_OPT_IN_ENV];
  process.env[GEMINI_RUNTIME_OPT_IN_ENV] = "1";
  try {
    assertFamilyPolicy();
    assertNativeCopyOcrGate();
    assertSceneTypographySplit();
    assertStoryInterestIntelligence();
assertMotifImplementations();
    assertSafePlans();
    await assertRealCallPaths();
    await assertRenderedLayout();
    await assertRetryBoundarySignal();
    await assertStrictNanoBananaRoute();
    console.log("THUMBNAIL ROOT-CAUSE PASS");
  } finally {
    if (originalGeminiRuntime === undefined) delete process.env[GEMINI_RUNTIME_OPT_IN_ENV];
    else process.env[GEMINI_RUNTIME_OPT_IN_ENV] = originalGeminiRuntime;
  }
}

void main();
