import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARCHETYPES } from "@/engine/archetypes";
import type { StyleDNA } from "@/engine/creative/types";
import { classifyExecutionError } from "@/engine/executionErrors";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import {
  BADGE_TREATMENTS,
  BananaImageSubmissionError,
  buildThumbBrief,
  generateNanoBananaImageWithReceipt,
  NANO_BANANA_THUMBNAIL_PROFILE,
  resolveBadgeTreatment,
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
import {
  isComparisonTitle,
  isGraveSubject,
  resolveThumbnailCapabilities,
  THUMBNAIL_CAPABILITIES,
} from "@/lib/thumbnailCapabilities";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import {
  FALLBACK_ACCENTS,
  FALLBACK_TEXT_OBJECTS,
  fallbackAccent,
  fallbackTextObject,
  fallbackTextZone,
  spreadDefault,
} from "@/lib/thumbnailDefaults";
import { produceAndCritique } from "@/engine/critiqueLoop";
import {
  classifyThumbnailDefects,
  deriveCriticDoctrine,
  recordThumbnailDefect,
  type ChannelDefectLedger,
} from "@/lib/thumbnailDefectLedger";
import {
  analyseThumbnailCtr,
  CTR_ADVISORY_PREAMBLE,
  type ThumbnailPerformanceSample,
} from "@/lib/thumbnailCtrFeedback";
import { judgeThumbnailStoryInterest } from "@/lib/thumbnailStoryJudge";
import {
  performanceSampleFromAnalytics,
  thumbnailLedgerKey,
  thumbnailPerformanceKey,
} from "@/lib/thumbnailLearningStore";
import { gradeThumbnailForMobile, YOUTUBE_OVERLAY_ZONES } from "@/lib/thumbnailMobileGate";
import {
  estimateTieredCostUsd,
  planThumbnailTiers,
  THUMBNAIL_DRAFT_TIER,
  THUMBNAIL_FINAL_TIER,
} from "@/lib/thumbnailRenderTier";
import {
  fingerprintThumbnail,
  hammingDistance,
  heroOverlap,
  scoreThumbnailSameness,
} from "@/lib/thumbnailSameness";
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

async function assertHybridStoryJudge(): Promise<void> {
  const concept = {
    title: "The Secret Nobody Caught",
    heroProp: "a generic empty office lobby with nobody in it",
    headlineWords: ["THE SECRET", "NOBODY CAUGHT"],
  };
  // The lexicon is gameable by vocabulary: "SECRET", "NOBODY" and "CAUGHT" are
  // all stake words and "nobody" also reads as human agency, so an empty lobby
  // scores full marks. This is the blind spot the judge exists to cover, and it
  // was reproduced against the live model, which scored the same concept 8.
  const deterministic = scoreThumbnailStoryInterest(concept);
  assert.equal(deterministic.score, 100, "the keyword scorer is fooled by stake vocabulary alone");

  const vetoed = await judgeThumbnailStoryInterest({
    deterministic, ...concept,
    askJudge: async () => ({ score: 8, weakness: "an empty lobby has no stake", fix: "put a person mid-consequence in frame" }),
  });
  assert.equal(vetoed.score, 8, "the judge must be able to veto a vocabulary-gamed score");
  assert.equal(vetoed.verdict, "inert");
  assert.equal(vetoed.judgeLoweredScore, true);
  assert.ok(vetoed.liftPrompts.some((lift) => /person mid-consequence/.test(lift)), "its fix must reach the re-plan");

  // RULE 2 — veto only. An LLM asked "is this interesting?" says yes far too
  // readily; letting it raise scores would quietly disable the gate that the
  // regression tests are pinned to.
  const weak = scoreThumbnailStoryInterest({
    title: "How Vault Walls Are Built",
    heroProp: "a thick concrete wall panel",
    headlineWords: ["12 TONNES", "OF STEEL"],
  });
  const notRescued = await judgeThumbnailStoryInterest({
    deterministic: { ...weak, verdict: "weak", score: 45 },
    title: "How Vault Walls Are Built", heroProp: "a thick concrete wall panel", headlineWords: ["12 TONNES"],
    askJudge: async () => ({ score: 99, weakness: "", fix: "" }),
  });
  assert.equal(notRescued.score, 45, "the judge must never inflate a score");
  assert.equal(notRescued.judgeLoweredScore, false);

  // RULE 1 — an inert verdict is already decided, so no call is made at all.
  let called = false;
  const inert = await judgeThumbnailStoryInterest({
    deterministic: { score: 10, verdict: "inert", reasons: [], liftPrompts: ["x"], weakestAxis: "both" },
    title: "t", headlineWords: [],
    askJudge: async () => { called = true; return { score: 90 }; },
  });
  assert.equal(called, false, "an already-inert verdict must not spend a model call");
  assert.equal(inert.score, 10);

  // RULE 3 — a judge failure is not a rejection. Observed live: the judge does
  // not answer every time, so this path is load-bearing, not theoretical.
  const failed = await judgeThumbnailStoryInterest({
    deterministic, ...concept,
    askJudge: async () => { throw new Error("provider timeout"); },
  });
  assert.equal(failed.score, 100, "a provider failure must leave the deterministic verdict untouched");
  assert.equal(failed.judgeLoweredScore, false);

  // Nonsense out of range is ignored rather than trusted.
  const nonsense = await judgeThumbnailStoryInterest({
    deterministic, ...concept, askJudge: async () => ({ score: 5000 }),
  });
  assert.equal(nonsense.score, 100);
}

async function assertFatalDefectsNeverShip(): Promise<void> {
  // The loop distinguished only accepted from not-accepted and, on exhaustion,
  // returned the highest-scoring candidate. Right for a merely weak result —
  // something has to ship — and wrong for a defect that makes the output
  // unusable. A misspelled headline was caught by the reviewer, scored well on
  // everything else, and came back as "best".
  const seen: string[] = [];
  const mixed = await produceAndCritique<string>({
    label: "test", threshold: 1, maxIters: 3, channel: {},
    produce: async (_issues, iter) => { const v = `cand${iter}`; seen.push(v); return v; },
    critique: async (value, iter) => iter === 1
      // Highest score of the run, but unusable.
      ? { score: 0.9, pass: false, issues: ["misspelled headline"], fatal: true }
      : { score: 0.4, pass: false, issues: ["weak but usable"] },
  });
  assert.equal(seen.length, 3, "the loop must keep trying after a fatal candidate");
  assert.notEqual(mixed.value, "cand1", "a fatal candidate must never be returned as best, even scoring highest");
  assert.equal(mixed.fatal, undefined, "a usable fallback exists, so the result is not fatal overall");

  // When EVERY candidate is unusable the caller must be told, not handed one
  // silently — the fail-closed decision belongs to the caller.
  const allBad = await produceAndCritique<string>({
    label: "test", threshold: 1, maxIters: 2, channel: {},
    produce: async (_issues, iter) => `bad${iter}`,
    critique: async () => ({ score: 0.9, pass: false, issues: ["misspelled"], fatal: true }),
  });
  assert.equal(allBad.fatal, true, "an all-fatal run must be flagged so the caller can refuse it");
  assert.equal(allBad.accepted, false);

  // Unmarked runs behave exactly as before.
  const normal = await produceAndCritique<string>({
    label: "test", threshold: 1, maxIters: 2, channel: {},
    produce: async (_i, iter) => `ok${iter}`,
    critique: async (_v, iter) => ({ score: iter === 2 ? 0.8 : 0.2, pass: false, issues: [] }),
  });
  assert.equal(normal.value, "ok2", "best-of selection is unchanged when nothing is fatal");
  assert.equal(normal.fatal, undefined);
}

function assertFamilyMotifsSpread(): void {
  // THE TRUE ROOT. Two rounds of fixes did not stop the plaques, because both
  // were downstream. FAMILY_VISUAL_LANGUAGE assigned ONE motif per family and
  // narrated_stock — the most-used family — mapped to block_plate, so every
  // channel built on it inherited a plate before any channel default or
  // terminal fallback could apply.
  const motifs = new Set(
    ["Blank Frames", "Crush Depth", "Proof Of Purchase", "Investory", "Empires At War", "Parsec Theory"]
      .map((channelName) => buildStyleDnaPlaybook({ dna: DNA, family: "narrated_stock", channelName, now: 1 })
        .visualLanguage?.textObject),
  );
  assert.ok(
    motifs.size >= 3,
    `six channels on ONE family must not share one motif, got ${motifs.size} distinct: ${[...motifs].join(", ")}`,
  );
  // Reproducibility still holds — a per-call choice would defeat every cache
  // and checkpoint upstream.
  assert.equal(
    buildStyleDnaPlaybook({ dna: DNA, family: "narrated_stock", channelName: "Crush Depth", now: 1 }).visualLanguage?.textObject,
    buildStyleDnaPlaybook({ dna: DNA, family: "narrated_stock", channelName: "Crush Depth", now: 9 }).visualLanguage?.textObject,
  );
}

function assertFallbackMotifIsNotMetal(): void {
  // The chain terminated at "movie_poster", whose description specifies
  // metallic bevel, so every channel that declared no motif produced a metal
  // plaque. Diversifying the REGISTERED channels fixed nothing for any channel
  // the module had not met yet.
  assert.ok(!FALLBACK_TEXT_OBJECTS.includes("movie_poster" as never), "the metallic default must not be in the pool");
  assert.ok(!FALLBACK_TEXT_OBJECTS.includes("block_plate" as never), "nor the other plate motif");
  const unregistered = ["Blank Frames", "Crush Depth", "Proof Of Purchase", "Some New Channel", "Another One"];
  const motifs = new Set(unregistered.map((name) => fallbackTextObject(name)));
  assert.ok(motifs.size >= 3, `unregistered channels must not share one motif, got ${motifs.size} distinct`);
  assert.equal(fallbackTextObject("Crush Depth"), fallbackTextObject("crush depth"), "must stay deterministic");
}

function assertObjectSubjectClass(): void {
  // Found by running three brand-new channels through the module unaided. An
  // art-theft channel, a deep-sea engineering channel and a consumer-goods
  // channel all thrashed, scoring 0 and 15 for "no human presence or agency in
  // the hero" — when an empty picture frame, a hull bolt and a crisp packet are
  // precisely what those videos are about. Same failure the `icon` class was
  // created to fix, in a class nobody had named.
  const failingBolt = "a single hull bolt blowing out of a steel seam as water floods through the gap";
  const asEvent = scoreThumbnailStoryInterest({ title: "t", heroProp: failingBolt, headlineWords: ["ONE BOLT", "FAILED"] });
  const asObject = scoreThumbnailStoryInterest({ title: "t", heroProp: failingBolt, headlineWords: ["ONE BOLT", "FAILED"], subjectClass: "object" });
  assert.equal(asEvent.verdict, "inert", "the event reading penalises an object subject for being an object");
  assert.ok(asObject.score > asEvent.score + 30, `the object reading must not punish the subject for existing (${asEvent.score} -> ${asObject.score})`);

  // But it must not become a free pass: an object nobody is doing anything to
  // is a product shot, and a product shot is still not a thumbnail.
  const inertShelf = scoreThumbnailStoryInterest({
    title: "t", heroProp: "a crisp packet on a supermarket shelf", headlineWords: ["THE BAG"], subjectClass: "object",
  });
  assert.equal(inertShelf.verdict, "inert", "an unhandled object must still fail");
  assert.ok(
    inertShelf.liftPrompts.some((lift) => /Put hands on it/.test(lift)),
    "and it must say what to do about it",
  );
  assert.equal(inertShelf.weakestAxis, "both");
}

function assertDefaultsSpreadRatherThanCollapse(): void {
  // The bug class this exists for: a single constant fallback reads as a
  // sensible safety net and silently makes every channel that omits a field
  // identical to every other channel that omits it. The previous accent
  // constant was #ffd400, which is why an audit of eleven renders found seven
  // in the amber band.
  const channels = [
    "Investory", "Empires At War", "Vault Breach", "Parsec Theory",
    "Gratitude Springs", "Sealed Records", "The Getaway Files", "Overbuilt",
  ];
  const accents = new Set(channels.map((name) => fallbackAccent(name)));
  assert.ok(accents.size >= 4, `unset accents must spread across the wheel, got ${accents.size} distinct`);
  assert.ok(!FALLBACK_ACCENTS.includes("#ffd400" as never), "the gold constant that caused the bias must not be the pool");

  const zones = new Set(channels.map((name) => fallbackTextZone(name)));
  assert.ok(zones.size >= 3, `unset type zones must move between channels, got ${zones.size} distinct`);

  // Determinism is non-negotiable: a default that varied per call would make
  // renders irreproducible and defeat every cache and checkpoint upstream.
  for (const name of channels) {
    assert.equal(fallbackAccent(name), fallbackAccent(name));
    assert.equal(fallbackTextZone(name), fallbackTextZone(`${name}`));
  }
  assert.equal(fallbackAccent("Investory"), fallbackAccent("  investory  "), "identity must normalise");

  // Degenerate inputs must not throw at a paid boundary.
  assert.ok(FALLBACK_ACCENTS.includes(fallbackAccent("") as never));
  assert.equal(spreadDefault("anything", ["only"]), "only");
}

function assertSelfWritingDoctrine(): void {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000 * DAY;
  let ledger: ChannelDefectLedger = { channelName: "Investory", observations: [] };

  assert.deepEqual(classifyThumbnailDefects("the hero is too small and lost in the frame"), ["hero-too-small"]);
  assert.deepEqual(classifyThumbnailDefects("nothing wrong here"), []);

  // ONE bad video is not a channel pattern. The critique loop can reject the
  // same candidate three times in a single run, and that is one bad video.
  for (let attempt = 0; attempt < 3; attempt++) {
    ledger = recordThumbnailDefect(ledger, { videoKey: "video-a", reason: "hero is too small", at: now - DAY });
  }
  assert.deepEqual(
    deriveCriticDoctrine({ ledger, now }).rules, [],
    "three rejections of ONE video must not become standing doctrine",
  );

  // Three DISTINCT videos is a blind spot.
  for (const videoKey of ["video-b", "video-c"]) {
    ledger = recordThumbnailDefect(ledger, { videoKey, reason: "subject too small, too much background", at: now - DAY });
  }
  const promoted = deriveCriticDoctrine({ ledger, now });
  assert.equal(promoted.rules.length, 1);
  assert.equal(promoted.rules[0]?.defectId, "hero-too-small");
  assert.equal(promoted.rules[0]?.videoCount, 3);
  assert.match(promoted.doctrine, /far larger/);

  // Doctrine DECAYS. Without this the brief accumulates commandments forever
  // and eventually crowds out the identity contract and the golden bar.
  const stale = deriveCriticDoctrine({ ledger, now: now + 200 * DAY });
  assert.deepEqual(stale.rules, [], "a defect that stopped recurring must stop being cited");

  // The doctrine is capped, most persistent first.
  let noisy: ChannelDefectLedger = { channelName: "Noisy", observations: [] };
  const reasons = [
    "hero is too small", "copy is illegible", "instruction words rendered",
    "misspelled copy should read", "identity contract must show", "muddy blur at browse size",
  ];
  for (const reason of reasons) {
    for (const videoKey of ["v1", "v2", "v3"]) {
      noisy = recordThumbnailDefect(noisy, { videoKey, reason, at: now - DAY });
    }
  }
  assert.ok(deriveCriticDoctrine({ ledger: noisy, now }).rules.length <= 4, "doctrine must stay bounded");
}

function assertLearningPersistence(): void {
  // Keys are per channel and namespaced, so two channels cannot read each
  // other's doctrine or pollute each other's evidence.
  const a = thumbnailLedgerKey("chan/", "Investory");
  const b = thumbnailLedgerKey("chan/", "Inked Histories");
  assert.notEqual(a, b);
  assert.match(a, /investory/);
  assert.match(thumbnailPerformanceKey("chan/", "Chalk & Compound"), /chalk-compound/);
  assert.equal(
    thumbnailLedgerKey("chan/", "  Investory  "),
    thumbnailLedgerKey("chan/", "investory"),
    "channel naming drift must not silently split a channel's memory in two",
  );

  // A CTR RATE without its denominator cannot carry weight in a significance
  // test. YouTube does not always serve thumbnail impressions, and recording a
  // sample with a fabricated or zero denominator would corrupt every
  // comparison the channel ever runs — so it is refused instead.
  const base = { channelName: "Investory", videoKey: "v1", publishedAt: 1, traits: { layoutMode: "split" } };
  assert.equal(
    performanceSampleFromAnalytics({ ...base, analytics: { ctr: 5.2 } }),
    null,
    "a CTR rate with no impressions must be refused, not stored as zero",
  );
  assert.equal(performanceSampleFromAnalytics({ ...base, analytics: { thumbnailImpressions: 10_000 } }), null);
  assert.equal(performanceSampleFromAnalytics({ ...base, analytics: { ctr: 5, thumbnailImpressions: 0 } }), null);

  // The metric is a percentage; the analyser works in raw counts.
  const sample = performanceSampleFromAnalytics({ ...base, analytics: { ctr: 5, thumbnailImpressions: 10_000 } });
  assert.equal(sample?.impressions, 10_000);
  assert.equal(sample?.clicks, 500, "5% of 10,000 impressions is 500 clicks, not 5");

  // Clicks can never exceed impressions even if the provider disagrees.
  const absurd = performanceSampleFromAnalytics({ ...base, analytics: { ctr: 250, thumbnailImpressions: 100 } });
  assert.ok((absurd?.clicks ?? 0) <= (absurd?.impressions ?? 0));
}

function assertCtrFeedbackRefusesThinEvidence(): void {
  const now = Date.now();
  const sample = (i: number, layout: string, clicks: number, impressions: number): ThumbnailPerformanceSample =>
    ({ channelName: "Investory", videoKey: `v${i}`, traits: { layoutMode: layout }, clicks, impressions, publishedAt: now });

  // The failure mode this module exists to prevent: a big-looking lift on a
  // handful of impressions. 12% vs 4% is a huge apparent effect and complete
  // noise at this volume.
  const thin = analyseThumbnailCtr({
    samples: [sample(1, "split", 6, 50), sample(2, "centered_hero", 2, 50)],
  });
  assert.equal(thin.conclusive, false, "a two-video sample must never conclude");
  assert.deepEqual(thin.suggestedRules, [], "no rule may be promoted from thin evidence");
  assert.ok(thin.limitation && thin.limitation.length > 0, "it must say WHY it refused");

  // Enough volume, but the two arms genuinely perform the same.
  const flat: ThumbnailPerformanceSample[] = [];
  for (let i = 0; i < 10; i++) flat.push(sample(i, "split", 600, 10_000));
  for (let i = 10; i < 20; i++) flat.push(sample(i, "centered_hero", 600, 10_000));
  const noEffect = analyseThumbnailCtr({ samples: flat });
  assert.equal(noEffect.conclusive, false, "identical performance must not be reported as a finding");
  assert.match(String(noEffect.limitation), /noise|impressions/);

  // A real, large, well-sampled effect IS reported — with its caveat attached.
  const real: ThumbnailPerformanceSample[] = [];
  for (let i = 0; i < 10; i++) real.push(sample(i, "split", 1_200, 10_000));
  for (let i = 10; i < 20; i++) real.push(sample(i, "centered_hero", 500, 10_000));
  const found = analyseThumbnailCtr({ samples: real });
  assert.equal(found.conclusive, true);
  assert.ok(found.suggestedRules.length >= 1);
  assert.ok((found.effects[0]?.liftPoints ?? 0) > 0);

  // CTR must stay SUBORDINATE. The craft rules encode what CTR cannot see —
  // whether the channel still looks like itself, whether the identity contract
  // holds, whether the subject is worth a thumbnail — while CTR is correlation
  // confounded by title and topic. A channel that chases its own CTR history
  // converges on whatever it published before, which is the opposite of the
  // variety the sameness gate protects.
  assert.match(found.advisory, /LOWEST priority/, "the advisory must state its own rank");
  assert.match(found.advisory, /identity contract/, "it must name what overrides it");
  assert.match(found.advisory, /tiebreak/, "it must be framed as a tiebreak, not a rule");
  assert.match(CTR_ADVISORY_PREAMBLE, /never as a reason to repeat a past composition/);
  assert.equal(thin.advisory, "", "an inconclusive report must emit no advisory at all");
  assert.equal(noEffect.advisory, "");

  // Capped, so a pile of observed correlations cannot outweigh the craft rules
  // by sheer volume of text in the brief.
  const many: ThumbnailPerformanceSample[] = [];
  for (let i = 0; i < 10; i++) many.push({ channelName: "c", videoKey: `a${i}`, traits: { layoutMode: "split", vantage: "worm_tilt_up", energy: "bold" }, clicks: 1_200, impressions: 10_000, publishedAt: now });
  for (let i = 0; i < 10; i++) many.push({ channelName: "c", videoKey: `b${i}`, traits: { layoutMode: "centered_hero", vantage: "eye_level", energy: "sober" }, clicks: 400, impressions: 10_000, publishedAt: now });
  assert.ok(analyseThumbnailCtr({ samples: many }).suggestedRules.length <= 2, "the advisory must stay bounded");
}

function assertTieredRendering(): void {
  // A draft is selected for its CONCEPT. Holding it to the shipping model's
  // typography would reject good ideas for artefacts that never reach
  // production — verified by rendering one identical prompt on both tiers: the
  // layout, hero, copy and badge transferred exactly, while paper depth and
  // type material did not, and the draft additionally rendered incidental
  // collage text that the identity contract forbids.
  assert.equal(THUMBNAIL_DRAFT_TIER.enforceCopyFidelity, false);
  assert.equal(THUMBNAIL_FINAL_TIER.enforceCopyFidelity, true, "the frame that ships gets the full gate");
  assert.equal(THUMBNAIL_DRAFT_TIER.enforceMobileGate, true, "browse-size legibility is a concept property and does transfer");

  // Nano Banana 1 was measured dropping mandated headline words and staging
  // heroes far too small; drafting on it would send the loop chasing defects
  // that never reach production.
  assert.notEqual(THUMBNAIL_DRAFT_TIER.model, "fal-ai/nano-banana");
  assert.ok(THUMBNAIL_DRAFT_TIER.outputImageUsd < THUMBNAIL_FINAL_TIER.outputImageUsd);

  // DRAFT TIER IS DISABLED BY OWNER DECISION. Selecting a concept on a frame
  // that differs materially from the frame that ships means the critique loop
  // judges something the viewer never sees. Every plan must return the final
  // tier for every iteration, whatever the loop length.
  for (const maxIterations of [1, 2, 3, 8]) {
    const plan = planThumbnailTiers({ maxIterations });
    assert.equal(plan.perIteration.tier, "final", `${maxIterations} iterations must still render on the shipping model`);
    assert.equal(plan.finalPass, null, "there is no separate final pass when every pass is final");
  }
  // And no configuration may re-enable it.
  assert.equal(planThumbnailTiers({ maxIterations: 4, forceFinalOnly: false }).perIteration.tier, "final");
  assert.equal(estimateTieredCostUsd({ iterations: 3 }).savedUsd, 0, "there is no saving to claim while drafting is off");
}

async function assertThumbnailSameness(): Promise<void> {
  const golden = (name: string) => join(process.cwd(), "public/golden", `${name}.jpg`);

  // A file against itself is the one unambiguous duplicate.
  const rich = await fingerprintThumbnail({ imagePath: golden("rich"), heroProp: "a billionaire portrait cutout over torn newsprint" });
  assert.equal(hammingDistance(rich.phash, rich.phash), 0);
  assert.equal(rich.phash.length, 16, "the hash must be a full 64-bit value");

  // Genuinely different approved thumbnails must be far apart, or the whole
  // instrument is useless.
  const hannibal = await fingerprintThumbnail({ imagePath: golden("hannibal"), heroProp: "a war elephant advancing through alpine snow" });
  assert.ok(
    hammingDistance(rich.phash, hannibal.phash) > 12,
    "two unrelated approved thumbnails must not read as duplicates",
  );

  // Hero vocabulary is the PRIMARY signal, because the perceptual bands
  // overlap: a re-rendered identical scene measured 26 while different videos
  // on one channel measured 28.
  assert.equal(heroOverlap(["tower", "crane", "haze"], ["tower", "crane", "haze"]), 1);
  assert.equal(heroOverlap(["tower", "crane"], ["briefcase", "lounge"]), 0);

  const repeat = scoreThumbnailSameness({
    candidate: { phash: rich.phash, heroTokens: ["woman", "floating", "water", "ripples"] },
    recent: [{ phash: hannibal.phash, heroTokens: ["woman", "floating", "water", "ripples"] }],
  });
  assert.equal(repeat.tooSimilar, true, "a recycled hero idea must be caught even when the render looks different");
  assert.ok(repeat.reasons.join(" ").includes("repeats a recent idea"));

  // Channel consistency must NOT be punished: same palette and type family,
  // genuinely different subject.
  const consistent = scoreThumbnailSameness({
    candidate: { phash: rich.phash, heroTokens: ["tower", "crane", "haze"] },
    recent: [{ phash: hannibal.phash, heroTokens: ["briefcase", "lounge", "swap"] }],
  });
  assert.equal(consistent.tooSimilar, false, "a channel is supposed to look like itself");

  // No history is never a duplicate.
  assert.equal(
    scoreThumbnailSameness({ candidate: rich, recent: [] }).tooSimilar,
    false,
    "the first thumbnail on a channel cannot repeat anything",
  );
}

async function assertMobileSquintGate(): Promise<void> {
  // Calibration contract. The gate is only trustworthy if it passes the work
  // this repo has already approved, so the approved golden set IS the test: a
  // threshold that rejects a golden reference is a broken threshold, not a
  // strict one.
  const goldens = ["rich", "scandal", "hannibal", "samurai", "stoic_anger", "stoic_memento"];
  for (const name of goldens) {
    const verdict = await gradeThumbnailForMobile({
      imagePath: join(process.cwd(), "public/golden", `${name}.jpg`),
    });
    assert.equal(
      verdict.passed, true,
      `golden reference ${name} must survive the 120px squint test (contrast ${verdict.squintContrast}): ` +
      verdict.failures.join("; "),
    );
    assert.ok(verdict.squintContrast > 0, "the measurement must actually parse luma statistics");
  }

  // A flat mid-grey frame is the definition of a muddy blur at browse size.
  const scratch = await mkdtemp(join(tmpdir(), "squint-"));
  try {
    const flat = join(scratch, "flat.png");
    await solidImage(flat, 1280, 720, "#808080");
    const verdict = await gradeThumbnailForMobile({ imagePath: flat });
    assert.equal(verdict.passed, false, "a flat frame must fail the squint test");
    assert.match(verdict.failures.join(" "), /muddy blur/, "the failure must say why in art-direction terms");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  // Overlay zones are reported, never used to reject — the channel badge lives
  // bottom-right by design and every golden reference trips a naive check.
  assert.equal(YOUTUBE_OVERLAY_ZONES.length, 2);
  const rich = await gradeThumbnailForMobile({
    imagePath: join(process.cwd(), "public/golden/rich.jpg"),
  });
  assert.ok(rich.occludedZones.length > 0, "the golden reference does have ink in the badge corner");
  assert.equal(rich.passed, true, "…and that must not reject it");
}

function assertCapabilityRoutingDoesNotRegressExistingChannels(): void {
  // Every capability must be able to state what it would break. A capability
  // that cannot name its own blast radius is one nobody can review.
  for (const capability of THUMBNAIL_CAPABILITIES) {
    assert.ok(capability.appliesWhen.length > 20, `${capability.id} must say when it applies`);
    assert.ok(capability.risk.length > 20, `${capability.id} must state what it damages if misrouted`);
  }

  // REGRESSION GUARD. These are the channels and titles that already produce
  // good thumbnails. No newly added capability may fire on any of them.
  const untouched = [
    ["Investory", "The £40,000 Pension Mistake Nobody Warns You About"],
    ["Investory", "The Reality Of Retiring At 55"],
    ["Investory", "What Actually Happens To Your Pension"],
    ["Inked Histories", "The Night Rome's Treasury Vanished"],
    ["Gratitude Springs", "Let The Water Take The Weight"],
    ["Vault Breach", "The Bank That Was Robbed Through Its Own Wall"],
    ["The Getaway Files", "The Airport Switch That Fooled Everyone"],
    ["Chalk & Compound", "How Tax Brackets Actually Work"],
  ] as const;
  const base = {
    source: "style_dna_foundation" as const,
    rules: [], avoid: [], patterns: [], refsUsed: [], distilledAt: 0, visualLanguage: {},
  };
  for (const [channelName, title] of untouched) {
    const playbook = applyThumbnailChannelIdentity({ channelName, playbook: { ...base } });
    const resolved = resolveThumbnailCapabilities({
      title,
      subjectClass: playbook.identityContract?.subjectClass,
      composition: playbook.visualLanguage?.composition,
    });
    assert.equal(
      resolved.forcedLayout, undefined,
      `"${title}" must not be split into a comparison — that would destroy a single-hero story`,
    );
    assert.equal(
      resolved.energyOverride, undefined,
      `"${title}" is dramatic but not grave; overriding to sober would drain the channel's register`,
    );
    assert.equal(
      resolved.defaultVantage, undefined,
      `${channelName} did not ask for a heroic upward tilt`,
    );
  }

  // The loose first draft of the comparison detector matched a bare "reality"
  // and "what actually", which fired on both Investory titles above.
  assert.equal(isComparisonTitle("The Reality Of Retiring At 55"), false);
  assert.equal(isComparisonTitle("What Actually Happens To Your Pension"), false);
  assert.equal(isComparisonTitle("The Render They Sold You vs What Actually Got Built"), true);
  assert.equal(isComparisonTitle("Dubai: Expectation vs Reality"), true);
  assert.equal(isComparisonTitle("The Same Street Before And After The Flood"), true);

  // Grave detection stays tight: dramatic is not grave.
  assert.equal(isGraveSubject("The £40,000 Pension Mistake Nobody Warns You About"), false);
  assert.equal(isGraveSubject("The Bank That Was Robbed Through Its Own Wall"), false);
  assert.equal(isGraveSubject("The Tower That Killed 96 Workers Before It Opened"), true);

  // The channels that DID opt in must still get their capabilities.
  const overbuilt = applyThumbnailChannelIdentity({ channelName: "Overbuilt", playbook: { ...base } });
  const icon = resolveThumbnailCapabilities({
    title: "Why The Burj Khalifa Is A Terrible Building",
    subjectClass: overbuilt.identityContract?.subjectClass,
    composition: overbuilt.visualLanguage?.composition,
  });
  assert.equal(icon.defaultVantage, "worm_tilt_up", "an icon channel must still get the looming vantage");
  assert.ok(icon.active.includes("subject_class_hero"));

  const sealed = applyThumbnailChannelIdentity({ channelName: "Sealed Records", playbook: { ...base } });
  const person = resolveThumbnailCapabilities({
    title: "The Secret Deal That Buried The Epstein Case For A Decade",
    subjectClass: sealed.identityContract?.subjectClass,
    composition: sealed.visualLanguage?.composition,
  });
  // The Gemini Developer API refuses a recognizable real likeness
  // (finishReason=IMAGE_OTHER); fal renders the identical prompt. Re-pointing a
  // person channel at Gemini to save a few cents would silently kill it.
  assert.equal(person.requiredProviderRoute, "fal", "a person channel must be pinned to the provider that will render a likeness");
  assert.ok(person.active.includes("photo_cutout_collage"), "the expose register is a photo cutout over collage, not a rendered scene");
}

function assertBadgeIsAChannelConstant(): void {
  const brief = (channelName: string, over: Partial<Parameters<typeof buildThumbBrief>[0]> = {}) =>
    buildThumbBrief({
      channelName,
      scene: "a hero doing something",
      lines: [{ text: "HOOK", payoff: true }],
      badge: channelName,
      badgeTreatment: resolveBadgeTreatment({
        channelName,
        configured: (over as { badgeTreatment?: string }).badgeTreatment,
        textObject: over.textObject,
      }),
      ...over,
    });

  // The badge must not vary with the video. Same channel, different episodes,
  // different scenes and hooks — identical corner mark.
  const episodeA = brief("Vault Breach", { scene: "a tunnel through a wall", lines: [{ text: "SIX MONTHS", payoff: true }] });
  const episodeB = brief("Vault Breach", { scene: "a guard finding an empty box", lines: [{ text: "GONE", payoff: true }] });
  const badgeClause = (prompt: string) => prompt.slice(prompt.indexOf("CHANNEL BADGE"));
  assert.equal(
    badgeClause(episodeA),
    badgeClause(episodeB),
    "the same channel must produce a byte-identical badge clause on every video",
  );
  assert.match(badgeClause(episodeA), /BOTTOM-RIGHT/, "the badge stays bottom-right");
  assert.match(badgeClause(episodeA), /render it identically on every video/i, "the badge must be declared a fixed signature");

  // Resolution is a pure function of channel constants.
  assert.equal(
    resolveBadgeTreatment({ channelName: "Vault Breach" }),
    resolveBadgeTreatment({ channelName: "Vault Breach" }),
    "badge resolution must be deterministic",
  );
  // An explicitly stored channel choice always wins.
  assert.equal(
    resolveBadgeTreatment({ channelName: "Vault Breach", configured: "tape_label", textObject: "scene_forged" }),
    "tape_label",
    "a channel's stored badge choice must override every derivation",
  );
  // Otherwise it stays within the set that is coherent with the channel's
  // signature type motif.
  assert.ok(
    ["engraved_plate", "outline_pill"].includes(
      resolveBadgeTreatment({ channelName: "Vault Breach", textObject: "scene_forged" }),
    ),
    "an unset badge must stay coherent with the channel's signature type motif",
  );
  // …and the channel name must distinguish channels that share a motif, or the
  // badge is consistent per channel but identical across the whole catalogue.
  const sharedMotif = ["Vault Breach", "Inked Histories", "Investory", "Gratitude Springs", "The Getaway Files"]
    .map((name) => resolveBadgeTreatment({ channelName: name, textObject: "scene_forged" }));
  assert.ok(
    new Set(sharedMotif).size > 1,
    `channels sharing a type motif must not all collapse to one badge (got ${sharedMotif.join(", ")})`,
  );
  // Garbage stored data must degrade to a valid treatment, never crash or leak.
  const degraded = resolveBadgeTreatment({ channelName: "Vault Breach", configured: "not_a_real_badge" });
  assert.ok(BADGE_TREATMENTS.includes(degraded), "unknown persisted badge data must degrade to a valid treatment");
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
    await assertMobileSquintGate();
await assertThumbnailSameness();
assertTieredRendering();
await assertHybridStoryJudge();
await assertFatalDefectsNeverShip();
assertFamilyMotifsSpread();
assertFallbackMotifIsNotMetal();
assertObjectSubjectClass();
assertDefaultsSpreadRatherThanCollapse();
assertSelfWritingDoctrine();
assertLearningPersistence();
assertCtrFeedbackRefusesThinEvidence();
assertCapabilityRoutingDoesNotRegressExistingChannels();
assertBadgeIsAChannelConstant();
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
