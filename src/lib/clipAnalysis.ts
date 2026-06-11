/**
 * Analyze an example YouTube clip with Gemini and map it to a channel FAMILY +
 * NICHE + style hints, so the wizard can pre-fill the design (operator confirms).
 */
import { geminiAnalyzeYouTube, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { FAMILIES, FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import { NICHES } from "@/lib/nicheCatalog";

export interface ClipAnalysis {
  couldAnalyze: boolean; // false → Gemini couldn't actually see frames (live/private); don't trust the rest
  confidence?: number; // 0-1
  hasNarration: boolean;
  narrationTone?: string;
  musicRole: "primary" | "bed" | "none";
  visualStyle: string;
  pacing: "slow" | "medium" | "fast";
  captionStyle?: string;
  thumbnailStyle?: string;
  approxLengthSec?: number;
  recommendedFamily: FamilyKey;
  recommendedNicheKey?: string;
  recommendedFootageTheme?: string;
  notes: string;
}

export async function analyzeClip(url: string): Promise<ClipAnalysis> {
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY missing");
  const families = FAMILY_KEYS.map((k) => `"${k}" = ${FAMILIES[k].label}: ${FAMILIES[k].description}`).join("\n");
  const niches = NICHES.map((n) => `"${n.key}" (${n.label})`).join(", ");

  const prompt =
    `You are a YouTube format analyst. Watch this clip and classify it for an automated channel builder.\n\n` +
    `IMPORTANT: If you CANNOT actually see the video frames (e.g. it's a live stream, private, age-restricted, or unavailable), set "couldAnalyze":false and DO NOT guess the other fields. Otherwise set "couldAnalyze":true.\n\n` +
    `Choose recommendedFamily from EXACTLY these keys:\n${families}\n\n` +
    `Choose recommendedNicheKey from: ${niches}.\n\n` +
    `Return STRICT JSON with: {` +
    `"couldAnalyze":boolean, "confidence":number(0-1), ` +
    `"hasNarration":boolean, "narrationTone":string (e.g. calm/energetic/old-radio; "" if none), ` +
    `"musicRole":"primary"|"bed"|"none", "visualStyle":string (e.g. "stock nature b-roll","anime/lofi loop","AI cinematic scenes","whiteboard hand-drawing","talking head"), ` +
    `"pacing":"slow"|"medium"|"fast", "captionStyle":string, "thumbnailStyle":string, "approxLengthSec":number, ` +
    `"recommendedFamily":one of the keys above, "recommendedNicheKey":one of the niche keys, ` +
    `"recommendedFootageTheme":string (only if stock; e.g. "nature"), "notes":string (1-2 sentences on what defines this channel's style)}.`;

  const raw = await geminiAnalyzeYouTube(url, prompt, { json: true, maxTokens: 900, windowSec: 90 });
  const a = parseJsonLoose<Partial<ClipAnalysis>>(raw);

  // Coerce + validate against our keys (fall back to narrated_stock).
  const fam = (FAMILY_KEYS as string[]).includes(a.recommendedFamily as string)
    ? (a.recommendedFamily as FamilyKey)
    : "narrated_stock";
  const niche = NICHES.find((n) => n.key === a.recommendedNicheKey)?.key;

  return {
    couldAnalyze: a.couldAnalyze !== false, // default true unless the model said false
    confidence: typeof a.confidence === "number" ? a.confidence : undefined,
    hasNarration: Boolean(a.hasNarration),
    narrationTone: a.narrationTone || undefined,
    musicRole: (a.musicRole as ClipAnalysis["musicRole"]) ?? "bed",
    visualStyle: a.visualStyle ?? "",
    pacing: (a.pacing as ClipAnalysis["pacing"]) ?? "medium",
    captionStyle: a.captionStyle || undefined,
    thumbnailStyle: a.thumbnailStyle || undefined,
    approxLengthSec: typeof a.approxLengthSec === "number" ? a.approxLengthSec : undefined,
    recommendedFamily: fam,
    recommendedNicheKey: niche,
    recommendedFootageTheme: a.recommendedFootageTheme || undefined,
    notes: a.notes ?? "",
  };
}
