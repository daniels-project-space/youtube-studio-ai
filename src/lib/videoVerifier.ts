/**
 * Per-artifact QA evaluators (ported/extended from autostudio video_verifier).
 * Each artifact is graded SEPARATELY: video frames, thumbnail, stock footage,
 * SEO metadata, and channel-identity alignment. Vision checks use Gemini on
 * local image files; text checks use Gemini JSON. Every evaluator is
 * self-guarding (returns a skipped verdict if no key / on error) so QA never
 * crashes — the qa_visual block decides what is a hard failure.
 */
import { geminiVisionLocal, geminiJson, hasGeminiKey, parseJsonLoose } from "@/lib/gemini";

export interface Verdict {
  score: number; // 0-10
  issues: string[];
  skipped?: boolean;
}

const SKIP: Verdict = { score: 10, issues: [], skipped: true };

function coerce(raw: unknown): Verdict {
  const v = raw as { score?: unknown; issues?: unknown; pass?: unknown };
  let score = typeof v.score === "number" ? v.score : v.pass === false ? 3 : 8;
  if (score < 0) score = 0;
  if (score > 10) score = 10;
  const issues = Array.isArray(v.issues)
    ? v.issues.filter((x): x is string => typeof x === "string").slice(0, 6)
    : [];
  return { score, issues };
}

/**
 * Shared vision-grade: guard → Gemini vision (the centralized geminiVisionLocal)
 * → coerced {score, issues} Verdict, returning SKIP on no-key / no-images / error.
 * The per-artifact evaluators below differ ONLY in their rubric prompt.
 */
async function gradeImage(imagePaths: string[], prompt: string, maxTokens = 400): Promise<Verdict> {
  if (!hasGeminiKey() || imagePaths.length === 0) return SKIP;
  try {
    return coerce(parseJsonLoose(await geminiVisionLocal({ prompt, imagePaths, json: true, maxTokens })));
  } catch {
    return SKIP;
  }
}

/** Video frames: clarity, relevance to the topic, no glitches/black/artifacts. */
export async function evaluateVisualFrames(
  imagePaths: string[],
  ctx: { topic: string; niche?: string },
): Promise<Verdict> {
  const prompt =
    `These are frames from a video about "${ctx.topic}"` +
    (ctx.niche ? ` (niche: ${ctx.niche})` : "") +
    ". Grade visual quality: clarity, relevance to the topic, and absence of " +
    "glitches/black frames/distortion. " +
    'Return STRICT JSON {"score":0-10,"issues":string[]}.';
  return gradeImage(imagePaths, prompt, 500);
}

/** Thumbnail: clickability, legible text, on-brand (palette/persona), title match. */
export async function evaluateThumbnail(
  imagePath: string,
  ctx: { title: string; persona?: string; palette?: string[] },
): Promise<Verdict> {
  const prompt =
    `This is a YouTube thumbnail for the video titled "${ctx.title}".` +
    (ctx.persona ? ` Channel persona: ${ctx.persona}.` : "") +
    (ctx.palette?.length ? ` Brand palette: ${ctx.palette.join(", ")}.` : "") +
    " Grade it: visual click-appeal, legibility of any text, on-brand colour/mood, " +
    "and whether it fits the title. " +
    'Return STRICT JSON {"score":0-10,"issues":string[]}.';
  return gradeImage([imagePath], prompt);
}

/** Stock footage: is the chosen footage appropriate/relevant to the topic? */
export async function evaluateFootage(
  imagePaths: string[],
  ctx: { topic: string; niche?: string },
): Promise<Verdict> {
  const prompt =
    `These are sample frames from the STOCK FOOTAGE chosen for a video about ` +
    `"${ctx.topic}"${ctx.niche ? ` (${ctx.niche})` : ""}. ` +
    "Is the footage relevant and appropriate to the subject (not random/off-topic)? " +
    'Return STRICT JSON {"score":0-10,"issues":string[]}.';
  return gradeImage(imagePaths, prompt);
}

/** SEO: title/description/tags quality, length, niche-fit, power words. */
export async function evaluateSeo(ctx: {
  title: string;
  description?: string;
  tags?: string[];
  niche?: string;
}): Promise<Verdict> {
  if (!hasGeminiKey()) return SKIP;
  try {
    const raw = await geminiJson({
      prompt:
        `Grade the YouTube SEO of this metadata for a ${ctx.niche ?? "video"} channel.\n` +
        `Title: ${ctx.title}\n` +
        `Description: ${(ctx.description ?? "").slice(0, 800)}\n` +
        `Tags: ${(ctx.tags ?? []).join(", ")}\n` +
        "Consider title length (~60-70 chars), curiosity/power words, keyword relevance, " +
        "tag coverage, and a useful description. " +
        'Return STRICT JSON {"score":0-10,"issues":string[]}.',
      maxTokens: 500,
      temperature: 0.2,
    });
    return coerce(raw);
  } catch {
    return SKIP;
  }
}

/** Channel-identity alignment: does the title/topic fit persona + style + niche? */
export async function evaluateIdentity(ctx: {
  title: string;
  topic?: string;
  persona?: string;
  niche?: string;
  styleGrammar?: string;
}): Promise<Verdict> {
  if (!hasGeminiKey() || !ctx.persona) return SKIP;
  try {
    const raw = await geminiJson({
      prompt:
        `Does this video match the channel's identity?\n` +
        `Persona: ${ctx.persona}\n` +
        (ctx.niche ? `Niche: ${ctx.niche}\n` : "") +
        (ctx.styleGrammar ? `Visual style: ${ctx.styleGrammar}\n` : "") +
        `Video title: ${ctx.title}\n` +
        (ctx.topic ? `Topic: ${ctx.topic}\n` : "") +
        "Grade how well the video fits the channel's persona/niche/style (on-brand). " +
        'Return STRICT JSON {"score":0-10,"issues":string[]}.',
      maxTokens: 400,
      temperature: 0.2,
    });
    return coerce(raw);
  } catch {
    return SKIP;
  }
}
