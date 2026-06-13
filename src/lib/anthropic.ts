/**
 * Claude API — PERMANENTLY REMOVED from youtube-studio-ai.
 *
 * Operator doctrine (Daniel, 2026-06-13): this app must NEVER call the
 * Anthropic API. The legacy REST path that previously lived here is deleted —
 * this module physically cannot reach api.anthropic.com, even if an
 * ANTHROPIC_API_KEY appears in the environment or vault.
 *
 * The historical names survive as the single choke point so the ~20 call
 * sites keep working unchanged:
 *   - hasAnthropicKey() — reports whether a JSON-capable judge LLM exists
 *     (Gemini). It must stay TRUE on Gemini-only deployments: returning false
 *     would silently disable every director/critic feature gate (the exact
 *     bug class topicraft killed in topic_select).
 *   - claudeJson()      — always Gemini (gemini-2.5-pro), throws without it.
 */

/** True when the judge LLM (Gemini) is configured — see header. */
export function hasAnthropicKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Single-turn JSON completion on Gemini Pro. PRO GOTCHA: thinking eats the
 * output budget first — small budgets return "no text" — so it is floored.
 */
export async function claudeJson<T = unknown>(args: {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "claudeJson: the Claude API is permanently removed from youtube-studio-ai (operator doctrine 2026-06-13) " +
        "and GEMINI_API_KEY is not configured — no judge LLM available",
    );
  }
  const { geminiJson } = await import("@/lib/gemini");
  return geminiJson<T>({
    prompt: `${args.system ? `${args.system}\n\n` : ""}${args.prompt}`,
    model: "gemini-2.5-pro",
    maxTokens: Math.max((args.maxTokens ?? 600) * 2, 6000),
    temperature: args.temperature,
  });
}
