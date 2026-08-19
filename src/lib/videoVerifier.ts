/**
 * Per-artifact QA evaluators (ported/extended from autostudio video_verifier).
 * Each artifact is graded SEPARATELY: video frames, thumbnail, stock footage,
 * SEO metadata, and channel-identity alignment. Vision checks use explicitly
 * scoped non-Google reviewers. Metadata checks use a deterministic rubric with
 * literal evidence, rather than pretending an unavailable model approved them.
 * Every evaluator is self-guarding (returns a skipped verdict if a required
 * visual reviewer is unavailable) so QA never crashes — the qa_visual block
 * decides what is a hard failure.
 */
import { hasNonGoogleVisionKey, visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";

export interface Verdict {
  score: number; // 0-10
  issues: string[];
  skipped?: boolean;
}

const SKIP: Verdict = { score: 10, issues: [], skipped: true };

const MAX_ISSUES = 6;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "being", "between", "could", "from", "have",
  "into", "just", "more", "most", "only", "other", "over", "than", "that", "the", "their",
  "there", "these", "this", "those", "through", "under", "very", "what", "when", "where",
  "which", "while", "with", "would", "your", "youtube", "video",
]);

function clampScore(score: number): number {
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function terms(value: string | undefined): string[] {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function uniqueTerms(values: readonly (string | undefined)[]): Set<string> {
  return new Set(values.flatMap((value) => terms(value)));
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter((term) => right.has(term)));
}

function sentenceWordCount(value: string): number {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function parseVerdictJson(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [trimmed, unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next deliberately bounded JSON shape.
    }
  }
  return undefined;
}

function coerce(raw: unknown): Verdict {
  const v = raw && typeof raw === "object"
    ? raw as { score?: unknown; issues?: unknown; pass?: unknown }
    : {};
  const hasScore = typeof v.score === "number" && Number.isFinite(v.score);
  const hasPass = typeof v.pass === "boolean";
  const score = hasScore ? v.score as number : v.pass === false ? 3 : v.pass === true ? 8 : 0;
  const issues = Array.isArray(v.issues)
    ? v.issues.filter((x): x is string => typeof x === "string").slice(0, MAX_ISSUES)
    : [];
  if (!hasScore && !hasPass) {
    issues.unshift("Vision reviewer returned no usable score or pass verdict.");
  }
  return { score: clampScore(score), issues: issues.slice(0, MAX_ISSUES) };
}

/**
 * Shared vision-grade: guard → the provider-routed vision client (Groq/FAL,
 * frames downscaled + verdicts cached) → coerced
 * {score, issues} Verdict, returning SKIP on no-key / no-images / error.
 * The per-artifact evaluators below differ ONLY in their rubric prompt.
 */
async function gradeImage(
  imagePaths: string[],
  prompt: string,
  maxTokens = VISION_GATE_MAX_TOKENS,
): Promise<Verdict> {
  if (!hasNonGoogleVisionKey() || imagePaths.length === 0) return SKIP;
  try {
    return coerce(parseVerdictJson(await visionLocal({
      prompt,
      imagePaths,
      json: true,
      maxTokens,
      providers: ["openrouter"], tier: "final",
    })));
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
  return gradeImage(imagePaths, prompt, VISION_GATE_MAX_TOKENS);
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

/**
 * SEO metadata rubric. It measures only literal, reproducible evidence: title
 * length/clarity, description depth and keyword continuity, and tag coverage.
 * It intentionally does not claim to predict click-through rate or understand
 * a topic semantically; those are handled by the channel critic and visual QA.
 */
export async function evaluateSeo(ctx: {
  title: string;
  description?: string;
  tags?: string[];
  niche?: string;
}): Promise<Verdict> {
  const issues: string[] = [];
  const title = clean(ctx.title);
  if (!title) {
    return { score: 0, issues: ["Title is missing; metadata cannot be evaluated."] };
  }

  let score = 0;
  const titleLength = title.length;
  if (titleLength >= 50 && titleLength <= 70) score += 2.5;
  else if (titleLength >= 40 && titleLength <= 85) score += 2;
  else if (titleLength >= 30 && titleLength <= 100) score += 1.25;
  else {
    score += 0.25;
    issues.push(`Title length is ${titleLength}; target a clear 50–70 character title.`);
  }

  const titleTerms = uniqueTerms([title]);
  if (titleTerms.size >= 3) score += 0.75;
  else issues.push("Title has too few specific terms to establish a clear search subject.");
  if (/^[^a-z]*[A-Z0-9\s!?.,:'"-]+$/.test(title) || (title.match(/!/g) ?? []).length > 1) {
    score -= 0.75;
    issues.push("Title uses excessive all-caps or punctuation; reduce clickbait-style formatting.");
  }

  const description = clean(ctx.description);
  const descriptionTerms = uniqueTerms([description]);
  if (!description) {
    issues.push("Description is missing; include a concise, keyword-bearing summary.");
  } else {
    const descriptionWords = sentenceWordCount(description);
    if (descriptionWords >= 45) score += 2.5;
    else if (descriptionWords >= 25) score += 1.75;
    else if (descriptionWords >= 12) score += 0.75;
    else issues.push(`Description has only ${descriptionWords} words; add a useful viewer-facing summary.`);

    const descriptionOverlap = overlap(titleTerms, descriptionTerms);
    if (descriptionOverlap.size >= Math.min(2, titleTerms.size)) score += 1;
    else issues.push("Description lacks enough literal title-keyword continuity to verify metadata relevance.");
  }

  const tags = uniqueStrings((ctx.tags ?? []).map(clean).filter(Boolean));
  const suppliedTagCount = (ctx.tags ?? []).map(clean).filter(Boolean).length;
  if (tags.length >= 3 && tags.length <= 15) score += 1.5;
  else if (tags.length >= 1 && tags.length <= 15) score += 0.75;
  else if (tags.length > 15) {
    score += 0.5;
    issues.push(`Tag count is ${tags.length}; trim to a focused set of 3–15 tags.`);
  } else {
    issues.push("No tags were supplied; add focused search terms.");
  }
  if (suppliedTagCount !== tags.length) {
    score -= 0.25;
    issues.push("Duplicate tags were removed; keep the tag set distinct.");
  }

  const tagTerms = uniqueTerms(tags);
  if (tagTerms.size > 0) {
    const tagOverlap = overlap(titleTerms, tagTerms);
    if (tagOverlap.size >= Math.min(2, titleTerms.size)) score += 1;
    else issues.push("Tags lack enough literal title-keyword coverage to verify their relevance.");
  }

  const nicheTerms = uniqueTerms([ctx.niche]);
  if (nicheTerms.size > 0) {
    const metadataTerms = new Set([...titleTerms, ...descriptionTerms, ...tagTerms]);
    if (overlap(nicheTerms, metadataTerms).size > 0) score += 0.5;
    else issues.push("No literal niche keyword appears in the title, description, or tags.");
  }

  return { score: clampScore(score), issues: issues.slice(0, MAX_ISSUES) };
}

/**
 * Channel-identity rubric. A text-only evaluator can prove declared identity
 * only through literal continuity between the title/topic and the persona or
 * niche. It therefore caps the verdict below the release threshold whenever
 * that evidence is absent instead of guessing that a video is on-brand.
 */
export async function evaluateIdentity(ctx: {
  title: string;
  topic?: string;
  persona?: string;
  niche?: string;
  styleGrammar?: string;
}): Promise<Verdict> {
  const persona = clean(ctx.persona);
  if (!persona) {
    return {
      score: 0,
      skipped: true,
      issues: ["Channel persona is missing, so identity alignment is unmeasured."],
    };
  }

  const issues: string[] = [];
  const title = clean(ctx.title);
  const topic = clean(ctx.topic);
  if (!title) {
    return { score: 0, issues: ["Title is missing; identity alignment cannot be evaluated."] };
  }
  if (!topic) issues.push("Topic is missing; title-to-topic continuity is unmeasured.");

  let score = 0;
  const titleTerms = uniqueTerms([title]);
  const topicTerms = uniqueTerms([topic]);
  const titleTopicOverlap = overlap(titleTerms, topicTerms);
  const titleTopicEvidence = titleTopicOverlap.size > 0;
  if (titleTopicOverlap.size >= 2) score += 3.5;
  else if (titleTopicOverlap.size === 1) score += 2.5;
  else if (topic) issues.push("No literal title/topic keyword overlap; the episode subject is not verifiable from metadata.");

  const identityTerms = uniqueTerms([persona, ctx.niche]);
  const episodeTerms = new Set([...titleTerms, ...topicTerms]);
  const identityOverlap = overlap(identityTerms, episodeTerms);
  if (identityOverlap.size >= 2) score += 3.5;
  else if (identityOverlap.size === 1) score += 2.5;
  else {
    issues.push("No literal persona or niche term overlaps the title/topic; deterministic on-brand evidence is insufficient.");
  }

  // This measures input completeness, not semantic style fit. Visual style is
  // independently checked by the frame reviewer, so it never compensates for
  // missing title/topic or identity evidence above.
  score += 0.5;
  if (clean(ctx.niche)) score += 0.75;
  if (clean(ctx.styleGrammar)) score += 0.5;

  if (!titleTopicEvidence || identityOverlap.size === 0) {
    score = Math.min(score, 4.5);
  }

  return { score: clampScore(score), issues: issues.slice(0, MAX_ISSUES) };
}
