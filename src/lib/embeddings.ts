/**
 * Text embeddings + cosine similarity for the self-dedup compliance gate.
 *
 * YouTube's "inauthentic content" rule demonetizes templated/repetitive output
 * channel-wide. Only our OWN history can judge cross-upload similarity, so we
 * embed each script and compare against prior uploads. Uses Gemini's embedding
 * model (GEMINI_API_KEY — no new vendor). The per-channel index lives in R2
 * (see complianceBlocks.ts) so no Convex schema change is needed.
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";

export function hasEmbedKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Embed a single text → vector. Throws if no key (callers guard). */
export async function embedText(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("embedText: GEMINI_API_KEY is not configured");
  const res = await fetch(`${BASE}/models/${MODEL}:embedContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
    }),
  });
  const json = (await res.json()) as {
    embedding?: { values?: number[] };
    error?: { message?: string };
  };
  if (!res.ok || !json.embedding?.values) {
    throw new Error(`embedText: HTTP ${res.status} ${json.error?.message ?? ""}`);
  }
  return json.embedding.values;
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
