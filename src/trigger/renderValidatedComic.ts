/**
 * A deliberately isolated, no-publish proof run for the Inked Histories
 * motion-comic lane. It exercises the same production renderer and visual
 * release gate as a channel pipeline without creating a YouTube draft.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { task } from "@trigger.dev/sdk";
import { makeRunTempDir } from "@/lib/files";
import { probe } from "@/lib/ffmpeg";
import {
  castMotionComic,
  hasMotionComic,
  type MotionComicBrief,
  type MotionComicImageRequest,
  type MotionComicResult,
} from "@/lib/motionComic";
import { generatePinnedGeminiProImage } from "@/lib/banana";
import { createAttestedNovitaImageGenerator } from "@/lib/novitaMedia";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";
import { presignDownload, publicUrl, putObjectFromFile } from "@/lib/storage";
import type { VisualRepairSignal } from "@/engine/healer";
import {
  channelVisualReviewProfile,
  reviewRender,
  visualRepairSignals,
  type VisualReviewIntent,
  type VisualReviewWindow,
} from "@/lib/visualReview";
import { bootstrapSecrets } from "@/lib/bootstrap";

const CHANNEL = {
  name: "Inked Histories",
  persona:
    "A scholarly yet dramatic narrator, guiding viewers through the turning pages of history as if revealing a lost epic. The tone is immersive and reverent, focusing on the human story within grand events.",
  styleGrammar:
    "motion comic, 3d papercraft, layered paper cutout, parallax scrolling, cross-hatching, ink wash, sepia tone, parchment texture, dramatic lighting, cinematic composition",
  qualityDimensions: ["identity", "thumbnail"],
} as const;

const NO_TEXT_GUARD =
  "ABSOLUTELY NO speech bubbles, NO captions, NO lettering, NO text of any kind anywhere in the image.";
const MAX_LAYOUT_REPAIR_CYCLES = 2;

export interface RenderValidatedComicInput {
  /** A caller-supplied stable identifier makes an infrastructure retry cache-safe. */
  runId?: string;
  topic?: string;
  facts?: string;
  /**
   * `novita` is the normal channel renderer. `gemini_pro_one_off` is an
   * explicit, audited delivery-only route for when the production fleet is
   * unavailable; it is never selected automatically by a channel pipeline.
   */
  renderer?: "novita" | "gemini_pro_one_off";
  /** Explicitly select Fish only for a proof run when ElevenLabs is unavailable. */
  voiceProvider?: "elevenlabs" | "fish_one_off";
}

function safeId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!normalized) throw new Error("render-validated-comic requires a non-empty safe runId");
  return normalized;
}

function channelReviewProfile() {
  return channelVisualReviewProfile({
    contentLaneKey: "motion_comic",
    primaryRenderer: "motion_comic",
    channelName: CHANNEL.name,
    persona: CHANNEL.persona,
    styleGrammar: CHANNEL.styleGrammar,
    qualityDimensions: [...CHANNEL.qualityDimensions],
  });
}

function reviewIntent(
  result: MotionComicResult,
  topic: string,
  focusWindows: VisualReviewWindow[] = [],
): VisualReviewIntent {
  const profile = channelReviewProfile();
  return {
    title: result.title,
    topic,
    niche: "historical motion comic",
    channelWorld: profile.channelWorld,
    expectedStructure: profile.expectedStructure,
    allowedVisualConditions: profile.allowedVisualConditions,
    // The page renderer starts on art, not a title/outro card. Review the
    // actual comic contract rather than inventing cards that this lane lacks.
    expectTitleCard: false,
    expectOutroCard: false,
    overlays: result.reviewTimeline.bubbles.map((bubble) => ({
      id: bubble.id,
      startSec: bubble.startSec,
      endSec: bubble.endSec,
      kind: "comic_bubble" as const,
      rect: bubble.rect,
      keepClear: bubble.keepClear,
      expected: "A speech bubble fully inside its panel and clear of faces and hero artwork",
    })),
    focusWindows,
  };
}

function focusedRepairWindows(signals: readonly VisualRepairSignal[]): VisualReviewWindow[] {
  return signals.flatMap((signal) => {
    if (!Number.isFinite(signal.startSec) || !Number.isFinite(signal.endSec)) return [];
    return [{
      startSec: Math.max(0, signal.startSec - 0.5),
      endSec: Math.max(signal.startSec, signal.endSec + 0.5),
      reason: "repair" as const,
    }];
  });
}

function layoutRepairs(signals: readonly VisualRepairSignal[]): NonNullable<MotionComicBrief["layoutRepair"]> {
  return signals.flatMap((signal) => {
    if (signal.owner !== "motion_comic" || signal.action !== "reflow_bubble") return [];
    const panel = typeof signal.targetId === "string" ? signal.targetId.match(/^p(\d+)-b\d+$/) : null;
    return [{
      action: "reflow_bubble" as const,
      ...(panel ? { panelIndex: Number(panel[1]) } : {}),
      ...(signal.targetId ? { targetId: signal.targetId } : {}),
      ...(signal.forbiddenRects?.length ? { forbiddenRects: signal.forbiddenRects } : {}),
    }];
  });
}

async function durableLink(key: string): Promise<{ url: string; delivery: "public" | "signed_7d" }> {
  try {
    return { url: publicUrl(key), delivery: "public" };
  } catch {
    return { url: await presignDownload(key, { expiresIn: 7 * 24 * 60 * 60 }), delivery: "signed_7d" };
  }
}

/**
 * Production-only, manually triggered demo. It never calls upload_draft,
 * publish intent, or any YouTube API. A link is returned only after a PASS.
 */
export const renderValidatedComicTask = task({
  id: "render-validated-comic",
  machine: "large-2x",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (input: RenderValidatedComicInput) => {
    await bootstrapSecrets((message) => console.log(`[render-validated-comic] ${message}`));
    const renderer = input.renderer ?? "novita";
    if (renderer !== "novita" && renderer !== "gemini_pro_one_off") {
      throw new Error("render-validated-comic renderer must be novita or gemini_pro_one_off");
    }
    const voiceProvider = input.voiceProvider ?? "elevenlabs";
    if (voiceProvider !== "elevenlabs" && voiceProvider !== "fish_one_off") {
      throw new Error("render-validated-comic voiceProvider must be elevenlabs or fish_one_off");
    }
    if (!hasMotionComic()) {
      throw new Error(
        "render-validated-comic requires the production storyboard and ElevenLabs configuration",
      );
    }
    if (renderer === "novita" && !hasNovitaRenderFarmConfig()) {
      throw new Error("render-validated-comic requires the attested Novita renderer configuration");
    }
    if (renderer === "gemini_pro_one_off" && !process.env.GEMINI_API_KEY) {
      throw new Error("render-validated-comic one-off Gemini Pro route requires GEMINI_API_KEY");
    }
    if (voiceProvider === "fish_one_off" && !process.env.FISH_AUDIO_API_KEY) {
      throw new Error("render-validated-comic one-off Fish route requires FISH_AUDIO_API_KEY");
    }

    const runId = safeId(input.runId ?? `validated-comic-${randomUUID()}`);
    const keyPrefix = `validation/inked-histories/${runId}/`;
    const runDir = await makeRunTempDir(runId, "motion_comic");
    const outPath = join(runDir, "final.mp4");
    const topic = input.topic ?? "The Christmas Truce of 1914 — the night enemies met in No Man's Land";
    const facts = input.facts ??
      "December 1914, the Western Front, Flanders. British and German soldiers spent Christmas Eve in freezing trenches yards apart. German troops lit candles and small trees and sang carols; British troops answered. Men called greetings across the lines, then climbed into No Man's Land unarmed. They exchanged cigarettes, chocolate and family photographs, helped bury the dead, and in some places played football. The guns fell silent briefly before the war resumed.";
    const imageReceipts: Array<{ model: string; route: string; width: number; height: number; responseId?: string }> = [];
    const imageGenerator: (request: MotionComicImageRequest) => Promise<Buffer> = renderer === "novita"
      ? createAttestedNovitaImageGenerator<MotionComicImageRequest>({
        prefix: `${keyPrefix}motion-comic-art`,
        id: (request) => request.id,
        profileId: "production",
      })
      : async (request) => {
        const generated = await generatePinnedGeminiProImage({
          prompt: [
            request.prompt,
            request.negativePrompt ? `Avoid: ${request.negativePrompt}` : "",
            NO_TEXT_GUARD,
          ].filter(Boolean).join("\n\n"),
          aspectRatio: "16:9",
          imageSize: "2K",
          maxProviderAttempts: 1,
          idempotencyContext: `${runId}:${request.id}`,
        });
        imageReceipts.push({
          model: generated.model,
          route: generated.route,
          width: generated.width,
          height: generated.height,
          ...(generated.responseId ? { responseId: generated.responseId } : {}),
        });
        return generated.bytes;
      };

    const baseBrief: MotionComicBrief = {
      topic,
      facts,
      // Four panels is the engine minimum. A 30-second target keeps the demo
      // faithful to Inked Histories without quietly shortening its quality bar.
      panels: 4,
      targetSeconds: 30,
      width: 1920,
      ttsProvider: voiceProvider === "fish_one_off" ? "fish" : "elevenlabs",
      // This is deliberately confined to the labelled proof route.  It keeps
      // its narration inside the 30-second delivery gate without changing the
      // normal channel voice cadence or provider defaults.
      ...(voiceProvider === "fish_one_off" ? { ttsSpeed: 1.4 } : {}),
      music: true,
      musicPrompt:
        "Tender, aching historical cinematic underscore: solo piano, warm strings, faint carol-like motif, hopeful but sorrowful, restrained, instrumental, no vocals",
      style: `${CHANNEL.styleGrammar}. ${NO_TEXT_GUARD}`,
    };

    let repairs: VisualRepairSignal[] = [];
    let repairCycles = 0;
    let latest: { result: MotionComicResult; durationSec: number; review: Awaited<ReturnType<typeof reviewRender>> } | null = null;

    for (let cycle = 0; cycle <= MAX_LAYOUT_REPAIR_CYCLES; cycle += 1) {
      const result = await castMotionComic({
        brief: {
          ...baseBrief,
          ...(repairs.length ? { layoutRepair: layoutRepairs(repairs) } : {}),
        },
        runDir,
        outPath,
        generateImage: imageGenerator,
        log: (message) => console.log(`[render-validated-comic] ${message}`),
      });
      const rendered = await probe(result.outPath);
      if (!rendered.hasVideo || !rendered.hasAudio || !Number.isFinite(rendered.durationSec)) {
        throw new Error("render-validated-comic produced an invalid media artifact");
      }
      if (rendered.durationSec < 26 || rendered.durationSec > 36) {
        throw new Error(`render-validated-comic expected approximately 30 seconds, received ${rendered.durationSec.toFixed(2)}s`);
      }

      const intent = reviewIntent(result, topic, focusedRepairWindows(repairs));
      const review = await reviewRender(result.outPath, rendered.durationSec, intent, {
        runId,
        keyPrefix,
        required: true,
        maxFrames: 48,
        maxFocusFrames: 24,
        log: (message) => console.log(`[render-validated-comic] ${message}`),
      });
      latest = { result, durationSec: rendered.durationSec, review };
      if (review.verdict === "pass") break;
      if (review.verdict !== "fail" || cycle === MAX_LAYOUT_REPAIR_CYCLES) {
        throw new Error(`render-validated-comic review did not pass after ${cycle} repair cycle(s): ${review.summary}`);
      }

      const signals = visualRepairSignals(review, intent).filter(
        (signal) => signal.owner === "motion_comic" && signal.action === "reflow_bubble",
      );
      if (!signals.length) {
        throw new Error(`render-validated-comic found no safe layout-only repair for: ${review.summary}`);
      }
      repairs = [...repairs, ...signals];
      repairCycles += 1;
      console.log(`[render-validated-comic] applying ${signals.length} layout-only repair signal(s), then focused rereview`);
    }

    if (!latest || latest.review.verdict !== "pass") {
      throw new Error("render-validated-comic reached an impossible no-pass terminal state");
    }

    const videoKey = `${keyPrefix}final.mp4`;
    await putObjectFromFile(videoKey, latest.result.outPath, { contentType: "video/mp4" });
    const video = await durableLink(videoKey);
    const evidence = latest.review.evidence.manifestKey
      ? await durableLink(latest.review.evidence.manifestKey)
      : null;
    return {
      status: "pass" as const,
      channel: CHANNEL.name,
      renderer: renderer === "novita" ? "novita-production" : "gemini-3-pro-image-one-off",
      oneOffRenderer: renderer === "gemini_pro_one_off",
      imageReceipts,
      voiceRenderer: voiceProvider === "fish_one_off" ? "fish-one-off" : "elevenlabs-production",
      oneOffVoiceRenderer: voiceProvider === "fish_one_off",
      title: latest.result.title,
      durationSec: Number(latest.durationSec.toFixed(2)),
      panels: latest.result.panels,
      repairCycles,
      visualReview: {
        verdict: latest.review.verdict,
        framesReviewed: latest.review.evidence.frames.length,
        maxGapSec: latest.review.evidence.coverage.maxGapSec,
        summary: latest.review.summary,
      },
      video: { key: videoKey, ...video },
      evidence: evidence
        ? { key: latest.review.evidence.manifestKey, ...evidence }
        : null,
    };
  },
});
