/**
 * Text embeddings + cosine similarity for the self-dedup compliance gate.
 *
 * YouTube's "inauthentic content" rule demonetizes templated/repetitive output
 * channel-wide. The old hosted-Gemini embedding route is intentionally
 * retired: Gemini is sealed to thumbnail generation and cannot be used for
 * content or similarity analysis. Callers already treat an unavailable
 * embedding backend as a fail-safe skip with an explicit log.
 */
import { assertGeminiRuntimeAllowed } from "@/lib/gemini";

export function hasEmbedKey(): boolean {
  return false;
}

/**
 * This compatibility surface remains so optional dedupe callers fail closed
 * rather than silently falling back to a weaker, unreviewed vector model.
 */
export async function embedText(text: string): Promise<number[]> {
  void text;
  assertGeminiRuntimeAllowed("Gemini embeddings");
  throw new Error("embedText: unreachable after the Gemini-only policy gate");
}

/** Cosine similarity of two equal-length vectors (0..1 for embeddings). */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
