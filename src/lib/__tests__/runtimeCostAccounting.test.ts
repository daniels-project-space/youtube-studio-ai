import assert from "node:assert/strict";

import {
  PRICE,
  bananaUnitRate,
  falFluxProImageCost,
  narrationTtsCost,
  qaVisualCost,
  thumbnailGenerationCost,
} from "@/engine/pricing";
import { classifyExecutionError } from "@/engine/executionErrors";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import {
  MOTION_COMIC_MAX_LINE_CHARS,
  MOTION_COMIC_MAX_LINES_PER_PANEL,
  MOTION_COMIC_MAX_MUSIC_GENERATIONS,
  boundMotionComicLine,
  boundMotionComicDialogueLines,
  elevenDialogue,
  motionComicDialogueCharacterCeiling,
  motionComicImageCallCeiling,
  motionComicPanelCount,
  motionComicTtsBillableCharacterCeiling,
  motionComicTtsProviderCallCeiling,
  motionComicVisionCallCeiling,
} from "@/lib/motionComic";
import {
  WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  WHITEBOARD_MAX_CHARS_PER_WORD,
  WHITEBOARD_MAX_PANELS,
  WHITEBOARD_MAX_WORDS_PER_PANEL,
  whiteboardImageCallCeiling,
  whiteboardNarrationCharacterCeiling,
  whiteboardPanelCount,
  whiteboardTtsBillableCharacterCeiling,
  whiteboardTtsProviderCallCeiling,
} from "@/lib/whiteboardSync";
import { music } from "@/trigger/blocks/lofiBlocks";
import { qaVisual } from "@/trigger/blocks/narratedBlocks";
import { synthNarration, TtsError } from "@/lib/tts";
import {
  NARRATION_CHAPTER_HEADING_MAX_CHARS,
  NARRATION_COLD_OPEN_MAX_CHARS,
  NARRATION_MAX_CHAPTER_CARDS,
  boundNarrationChapterHeadings,
  boundNarrationColdOpen,
  narrationChapterHeadingCharacterCeiling,
} from "@/lib/narrationBounds";
import { gateColdOpen, narrationPhysics } from "@/lib/voicecraft";

function providerAwarePricing(): void {
  assert.equal(
    classifyExecutionError(new TtsError("provider response may already be billed")).retryable,
    false,
  );
  assert.equal(bananaUnitRate("flash", {}), PRICE.bananaFlashUsd);
  assert.equal(bananaUnitRate("pro", {}), PRICE.bananaProUsd);
  assert.equal(
    bananaUnitRate("flash", { IMAGE_DISABLE_GEMINI: "1" }),
    (1024 * 576 * 0.003) / 1_000_000,
  );
  assert.equal(
    bananaUnitRate("pro", { IMAGE_PROVIDERS: " fal,gemini " }),
    (1024 * 576 * 0.04) / 1_000_000,
  );
  assert.equal(
    bananaUnitRate(
      "pro",
      { IMAGE_DISABLE_GEMINI: "1" },
      { hasReferences: true },
    ),
    0.04,
  );
  assert.equal(falFluxProImageCost(1344, 768, {}), (1344 * 768 * 0.04) / 1_000_000);
  assert.throws(
    () => bananaUnitRate("flash", {
      IMAGE_DISABLE_GEMINI: "1",
      FAL_IMAGE_MODEL_FLASH: "fal-ai/custom-unpriced-model",
    }),
    /authoritative request schema and price/,
  );
  assert.equal(
    bananaUnitRate("flash", { BANANA_FORCE_MODEL: "gemini-3-pro-image-preview" }),
    PRICE.bananaProUsd,
  );
  assert.equal(
    bananaUnitRate("pro", { BANANA_FORCE_MODEL: "gemini-2.5-flash-image" }),
    PRICE.bananaFlashUsd,
  );
  assert.equal(
    bananaUnitRate("flash", { IMAGE_PROVIDERS: "gemini,fal" }),
    PRICE.bananaFlashUsd,
  );
}

function costPatches(): void {
  const thumbnail = thumbnailGenerationCost(
    { pro: 2, flash: 3, fal: 4, falCostUsd: 0 },
    { pro: 3, flash: 5, fal: 5, falCostUsd: 0.013 },
    2,
    0.01,
  );
  const images = PRICE.bananaProUsd + 2 * PRICE.bananaFlashUsd + 0.013;
  const judges = 2 * PRICE.visionGraderUsd;
  assert.equal(thumbnail, images + judges + 0.01);

  assert.equal(qaVisual.paid, true);
  // A release review has a 48-frame broad pass and 24-frame focused re-review:
  // six managed-vision batches at the 12-image batch size.
  const qaEvidenceBatches = 6;
  assert.equal(qaVisualCost({}), PRICE.qaBaseUsd * qaEvidenceBatches);
  assert.equal(
    qaVisualCost({ nativeWatch: true, audioQa: true }),
    PRICE.qaBaseUsd * qaEvidenceBatches + PRICE.nativeVideoQaUsd + PRICE.audioQaUsd,
  );
}

function requestBounds(): void {
  assert.equal(whiteboardPanelCount(999), WHITEBOARD_MAX_PANELS);
  assert.equal(
    whiteboardImageCallCeiling(999),
    WHITEBOARD_MAX_PANELS * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  );
  assert.equal(
    whiteboardNarrationCharacterCeiling(999, Number.MAX_SAFE_INTEGER),
    WHITEBOARD_MAX_PANELS * WHITEBOARD_MAX_WORDS_PER_PANEL * WHITEBOARD_MAX_CHARS_PER_WORD,
  );
  assert.equal(
    whiteboardTtsBillableCharacterCeiling(999, Number.MAX_SAFE_INTEGER),
    WHITEBOARD_MAX_PANELS * WHITEBOARD_MAX_WORDS_PER_PANEL * WHITEBOARD_MAX_CHARS_PER_WORD,
  );
  assert.equal(whiteboardTtsProviderCallCeiling(), 3);

  assert.equal(motionComicPanelCount(999), 12);
  // Text-native identity removes four character sheets + their recoveries.
  assert.equal(motionComicImageCallCeiling(999, 999), 24);
  assert.equal(motionComicDialogueCharacterCeiling(999), 4_224);
  assert.equal(motionComicTtsBillableCharacterCeiling(999), 4_224);
  assert.equal(
    motionComicTtsBillableCharacterCeiling(999, Number.MAX_SAFE_INTEGER),
    11_520,
  );
  assert.equal(motionComicTtsProviderCallCeiling(999), 108);
  assert.equal(motionComicVisionCallCeiling(999), 24);
  assert.equal(MOTION_COMIC_MAX_MUSIC_GENERATIONS, 1);
  assert.ok(
    boundMotionComicLine("word ".repeat(500)).length <= MOTION_COMIC_MAX_LINE_CHARS,
  );
  assert.equal(MOTION_COMIC_MAX_LINES_PER_PANEL, 3);

  const boundedDialogue = boundMotionComicDialogueLines(
    Array.from({ length: 4 }, () => [
      "alpha ".repeat(100).trim(),
      "beta ".repeat(100).trim(),
      "gamma ".repeat(100).trim(),
    ]),
    10,
  );
  assert.equal(boundedDialogue.length, 4, "every panel/story beat is preserved");
  assert.ok(boundedDialogue.every((lines) => lines.length === 3 && lines.every(Boolean)));
  assert.ok(
    boundedDialogue.flat().reduce((sum, line) => sum + line.length, 0) <=
      motionComicDialogueCharacterCeiling(4, 10),
  );
  assert.ok(boundedDialogue.flat().every((line) => /^(?:alpha|beta|gamma)(?: (?:alpha|beta|gamma))*$/.test(line)));
}

async function cachedMusicIsFree(): Promise<void> {
  const ctx: StageContext = {
    ownerId: "owner-test",
    runId: "run-test",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/test/",
    params: {},
    store: { topic: "A bounded test", reuseMusicKey: "runs/base/music.mp3" },
    budgetUsd: 1,
    log: () => {},
  };
  const result = await music.run(ctx);
  assert.equal(result[COST_PATCH_KEY], 0);
}

async function successfulTinyTtsIsTerminal(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalFishKey = process.env.FISH_AUDIO_API_KEY;
  const originalElevenKey = process.env.ELEVENLABS_API_KEY;
  process.env.FISH_AUDIO_API_KEY = "test-fish-key";
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";

  try {
    for (const provider of ["fish", "elevenlabs"] as const) {
      let calls = 0;
      let billableCharacters = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(new Uint8Array(32), { status: 200 });
      };
      const text = `bill ${provider} once`;
      await assert.rejects(
        synthNarration({
          text,
          provider,
          elevenVoiceId: "voice-test",
          onBillableCharacters: (characters) => { billableCharacters += characters; },
        }),
        /tiny audio after a successful response/,
      );
      assert.equal(calls, 1, `${provider} must not retry a potentially billable 2xx response`);
      assert.equal(billableCharacters, text.length);

      calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("provider failed after submission", { status: 503 });
      };
      await assert.rejects(
        synthNarration({ text, provider, elevenVoiceId: "voice-test" }),
        (error: unknown) =>
          error instanceof TtsError && error.retryable === false && error.status === 503,
      );
      assert.equal(calls, 1, `${provider} must not resubmit after an ambiguous 503`);

      calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        throw new TypeError("socket reset after upload");
      };
      await assert.rejects(
        synthNarration({ text, provider, elevenVoiceId: "voice-test" }),
        (error: unknown) =>
          error instanceof TtsError && error.retryable === false && /not retrying/i.test(error.message),
      );
      assert.equal(calls, 1, `${provider} must not resubmit after transport ambiguity`);
    }

    let dialogueCalls = 0;
    let dialogueCharacters = 0;
    globalThis.fetch = async () => {
      dialogueCalls += 1;
      return new Response(new Uint8Array(32), { status: 200 });
    };
    await assert.rejects(
      elevenDialogue(
        [{ text: "one dialogue charge", voice_id: "voice-test" }],
        (characters) => { dialogueCharacters += characters; },
      ),
      /tiny audio after a successful response/,
    );
    assert.equal(dialogueCalls, 1);
    assert.equal(dialogueCharacters, "one dialogue charge".length);

    dialogueCalls = 0;
    globalThis.fetch = async () => {
      dialogueCalls += 1;
      return new Response("provider failed after submission", { status: 503 });
    };
    await assert.rejects(
      elevenDialogue([{ text: "one dialogue charge", voice_id: "voice-test" }]),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { retryable?: boolean; status?: number }).retryable === false &&
        (error as Error & { status?: number }).status === 503,
    );
    assert.equal(dialogueCalls, 1, "dialogue must not resubmit after an ambiguous 503");

    dialogueCalls = 0;
    globalThis.fetch = async () => {
      dialogueCalls += 1;
      throw new TypeError("socket reset after upload");
    };
    await assert.rejects(
      elevenDialogue([{ text: "one dialogue charge", voice_id: "voice-test" }]),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { retryable?: boolean }).retryable === false &&
        /not retrying/i.test(error.message),
    );
    assert.equal(dialogueCalls, 1, "dialogue must not resubmit after transport ambiguity");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFishKey === undefined) delete process.env.FISH_AUDIO_API_KEY;
    else process.env.FISH_AUDIO_API_KEY = originalFishKey;
    if (originalElevenKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenKey;
  }
}

async function coldOpenAccounting(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalElevenKey = process.env.ELEVENLABS_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  const probeText = "The opening narration should sound measured, natural, and completely clean.";
  const physics = narrationPhysics("documentary");
  const bounded = boundNarrationColdOpen(`${"complete ".repeat(100)}tail`);
  assert(bounded.length <= NARRATION_COLD_OPEN_MAX_CHARS);
  assert(!bounded.endsWith("com"), "cold-open cap keeps complete words");
  const oversizedHeadings = Array.from(
    { length: NARRATION_MAX_CHAPTER_CARDS + 20 },
    (_, index) => `Useful heading ${index + 1} ${"complete ".repeat(40)}`,
  );
  const boundedHeadings = boundNarrationChapterHeadings(oversizedHeadings);
  assert.equal(boundedHeadings.length, NARRATION_MAX_CHAPTER_CARDS);
  assert(boundedHeadings.every((heading) => heading.length <= NARRATION_CHAPTER_HEADING_MAX_CHARS));
  const actualSpokenHeadingCharacters = boundedHeadings.reduce(
    (total, heading, index) => total + `Chapter ${index + 1}: ${heading.replace(/[.:;,\s]+$/, "")}.`.length,
    0,
  );
  assert(
    actualSpokenHeadingCharacters <= narrationChapterHeadingCharacterCeiling(),
    "oversized chapter output cannot exceed the paid heading ceiling",
  );
  assert.equal(narrationChapterHeadingCharacterCeiling(), 2_385);
  try {
    let ttsCalls = 0;
    let judgeRequests = 0;
    let billableCharacters = 0;
    let audioJudgeCalls = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.elevenlabs.io")) {
        ttsCalls += 1;
        // judgeNarrationTake uses CBR byte length as its local duration probe.
        return new Response(new Uint8Array(48_000), { status: 200 });
      }
      judgeRequests += 1;
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                register: 8,
                pace: 8,
                performance: 8,
                clean: 8,
                why: "production ready",
              }),
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await gateColdOpen({
      text: probeText,
      elevenVoiceId: "voice-test",
      physics,
      onBillableCharacters: (characters) => { billableCharacters += characters; },
      onAudioJudgeCall: () => { audioJudgeCalls += 1; },
    });
    assert.equal(ttsCalls, 1);
    assert.equal(judgeRequests, 1);
    assert.equal(billableCharacters, probeText.length);
    assert.equal(audioJudgeCalls, 1);
    assert.equal(
      narrationTtsCost("elevenlabs", billableCharacters, audioJudgeCalls),
      (probeText.length * PRICE.ttsElevenPerKCharUsd) / 1_000 + PRICE.visionGraderUsd,
    );
    assert.equal(
      narrationTtsCost("fish", 0, 0),
      0,
      "a resumed/cache-restored narration performs no new paid work",
    );

    // A provider-accepted but invalid response can consume character quota.
    // It is counted once and is terminal; gateColdOpen must not buy take two.
    ttsCalls = 0;
    billableCharacters = 0;
    audioJudgeCalls = 0;
    globalThis.fetch = async () => {
      ttsCalls += 1;
      return new Response(new Uint8Array(32), { status: 200 });
    };
    await assert.rejects(
      gateColdOpen({
        text: probeText,
        elevenVoiceId: "voice-test",
        physics,
        onBillableCharacters: (characters) => { billableCharacters += characters; },
        onAudioJudgeCall: () => { audioJudgeCalls += 1; },
      }),
      /tiny audio after a successful response/,
    );
    assert.equal(ttsCalls, 1);
    assert.equal(billableCharacters, probeText.length);
    assert.equal(audioJudgeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalElevenKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  }
}

async function main(): Promise<void> {
  providerAwarePricing();
  costPatches();
  requestBounds();
  await cachedMusicIsFree();
  await successfulTinyTtsIsTerminal();
  await coldOpenAccounting();
  console.log("RUNTIME COST ACCOUNTING PASS: provider routes, patches, cache reuse, request bounds");
}

void main();
