/**
 * Human-readable provenance label shared by the QuizYear renderer and its
 * final-master OCR evidence. The complete URL remains in the round artifact;
 * the render shows only a legible, non-invented host label.
 */
export function quizCitationLabel(sourceUrl: string): string {
  const raw = sourceUrl.trim();
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "");
    if (host) return host;
  } catch {
    // Preserve a useful label for a legacy/non-URL source without inventing one.
  }
  const fallback = raw.replace(/^https?:\/\//i, "").split(/[/?#]/)[0]?.trim();
  return fallback || "verified source";
}
