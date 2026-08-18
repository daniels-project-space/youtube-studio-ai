/**
 * No-publish render proof for the fixed 32-second Netflix / Blockbuster
 * documentary short. This runs inside Trigger's scoped vault environment;
 * it deliberately does not copy provider credentials to a VPS or local file.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { craftDocuMotion, normalizeDocuPlan, validatePlan } from "@/lib/documotion";
import { probe } from "@/lib/ffmpeg";
import { makeRunTempDir } from "@/lib/files";
import { getStyle } from "@/remotion/docuStyles";
import { presignDownload, publicUrl, putObjectFromFile } from "@/lib/storage";
import { reviewRender, type VisualReviewIntent } from "@/lib/visualReview";
import { hasNovitaZImageTurbo } from "@/lib/novitaZImageTurbo";
import { netflixBlockbusterSearchFirstPlan } from "../../scripts/render-netflix-blockbuster-search-first-32-v6";

const TOPIC = "How Netflix's $50 million offer to Blockbuster became the new way to watch";
const DURATION_SEC = 32;

export interface RenderNetflixBlockbusterSearchFirst32V6Input {
  /** Supply this only when the caller needs an idempotent retry. */
  runId?: string;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!normalized) throw new Error("render-netflix-blockbuster-search-first-32-v6 requires a safe runId");
  return normalized;
}

async function durableLink(key: string): Promise<{ url: string; delivery: "public" | "signed_7d" }> {
  try {
    return { url: publicUrl(key), delivery: "public" };
  } catch {
    return { url: await presignDownload(key, { expiresIn: 7 * 24 * 60 * 60 }), delivery: "signed_7d" };
  }
}

function reviewIntent(plan: ReturnType<typeof normalizeDocuPlan>): VisualReviewIntent {
  let cursor = 0;
  const transcriptCues = plan.shots.map((shot) => {
    const startSec = cursor;
    cursor += shot.durationSec;
    return { startSec, endSec: cursor, text: shot.narration };
  });
  return {
    title: plan.title,
    topic: TOPIC,
    niche: "business-history documentary short",
    channelWorld: "A premium, paper-cutout archival documentary: tangible sourced imagery, layered depth, deliberate camera movement, restrained editorial typography.",
    expectedStructure: "Six coherent cause-and-effect beats, each anchored to its narration; no unrelated imagery, generic stock montage, or reference-video footage.",
    allowedVisualConditions: [
      "portrait 9:16 editorial collage with foreground, subject, and background depth layers",
      "source-backed historical imagery when available; generated stills only as clearly thematic fallback art",
      "calm cinematic motion, cutout parallax, depth of field, and sparse legible typography",
    ],
    expectTitleCard: false,
    expectOutroCard: false,
    transcriptCues,
    focusWindows: transcriptCues.map((cue) => ({
      startSec: cue.startSec,
      endSec: cue.endSec,
      reason: "reviewer" as const,
    })),
  };
}

/**
 * Manual proof task. It is intentionally no-publish and fails closed unless
 * the final independent visual review passes.
 */
export const renderNetflixBlockbusterSearchFirst32V6Task = task({
  id: "render-netflix-blockbuster-search-first-32-v6",
  machine: "large-2x",
  maxDuration: 1800,
  retry: { maxAttempts: 1 },
  run: async (input: RenderNetflixBlockbusterSearchFirst32V6Input) => {
    // FAL is thumbnail-only. For documentary QA, prefer Groq and use Gemini
    // strictly as a vision-judge fallback; neither provider creates assets.
    delete process.env.VISION_DISABLE_GEMINI;
    process.env.VISION_PROVIDERS = "groq,gemini";
    process.env.DOCU_ELEVEN_VOICE_ID ??= "JBFqnCBsd6RMkjVDRZzb";
    await bootstrapSecrets((message) => console.log(`[netflix-32] ${message}`), {
      required: ["ELEVENLABS_API_KEY"],
      vaultAuthoritativeKeys: [
        "ELEVENLABS_API_KEY",
        "PEXELS_API_KEY",
        "NOVITA_API_KEY",
        "GROQ_API_KEY",
        "GEMINI_API_KEY",
      ],
    });
    if (!hasNovitaZImageTurbo()) {
      throw new Error("NOVITA_API_KEY is required for the documentary Z-Image Turbo fallback");
    }
    if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
      throw new Error("A Groq or Gemini vision key is required to verify documentary assets before provider spend");
    }

    const plan = normalizeDocuPlan(netflixBlockbusterSearchFirstPlan());
    const problems = validatePlan(plan, DURATION_SEC, getStyle("archival_collage"), {
      narrationWordsPerSec: 1.65,
    });
    if (problems.length) throw new Error(`Netflix Short preflight failed: ${problems.join("; ")}`);

    const runId = safeId(input.runId ?? `netflix-blockbuster-v6-${randomUUID()}`);
    const keyPrefix = `validation/netflix-blockbuster/${runId}/`;
    const runDir = await makeRunTempDir(runId, "documotion");
    const result = await craftDocuMotion({
      topic: TOPIC,
      style: "archival_collage",
      durationSec: DURATION_SEC,
      runDir,
      outPath: join(runDir, "final.mp4"),
      format: "short",
      plan,
      lockShotDurations: true,
      // Native Shorts must fit narration inside editorially locked picture beats.
      // This remains a natural George take, not a time-stretched delivery.
      narrationSpeed: 1.08,
      // V3 adds dramatic pauses unpredictably. Multilingual v2 preserves the
      // George voice while keeping broadcast narration timing stable.
      elevenModelId: "eleven_multilingual_v2",
      narrationWordsPerSec: 1.65,
      maxRefineRounds: 2,
      log: (message) => console.log(`[netflix-32] ${message}`),
    });
    if (!result.verdict.pass) throw new Error("Netflix Short renderer ended without a passing shot-level verdict");

    const rendered = await probe(result.outPath);
    if (!rendered.hasVideo || !rendered.hasAudio || !Number.isFinite(rendered.durationSec)) {
      throw new Error("Netflix Short produced an invalid media artifact");
    }
    if (rendered.durationSec < 31.5 || rendered.durationSec > 32.5) {
      throw new Error(`Netflix Short expected 32 seconds, received ${rendered.durationSec.toFixed(2)}s`);
    }

    const review = await reviewRender(result.outPath, rendered.durationSec, reviewIntent(plan), {
      runId,
      keyPrefix,
      required: true,
      maxFrames: 48,
      maxFocusFrames: 24,
      log: (message) => console.log(`[netflix-32] ${message}`),
    });
    if (review.verdict !== "pass") {
      throw new Error(`Netflix Short final visual review did not pass: ${review.summary}`);
    }

    const videoKey = `${keyPrefix}final.mp4`;
    await putObjectFromFile(videoKey, result.outPath, { contentType: "video/mp4" });
    const video = await durableLink(videoKey);
    const evidence = review.evidence.manifestKey
      ? await durableLink(review.evidence.manifestKey)
      : null;
    return {
      status: "pass" as const,
      durationSec: Number(rendered.durationSec.toFixed(2)),
      visualReview: {
        verdict: review.verdict,
        framesReviewed: review.evidence.frames.length,
        maxGapSec: review.evidence.coverage.maxGapSec,
        summary: review.summary,
      },
      video: { key: videoKey, ...video },
      evidence: evidence ? { key: review.evidence.manifestKey, ...evidence } : null,
    };
  },
});
