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
 * Single-turn JSON completion on Gemini. DEFAULT IS FLASH (thinking disabled,
 * ~40x cheaper): the vast majority of the ~20 call sites are mechanical
 * structured output (headlines, one-line comments, pass/fail critiques) that
 * was silently billing gemini-2.5-pro with UNBOUNDED THINKING at a 6000-token
 * floor — a top driver of the Google bill. Pass tier:"pro" only where genuine
 * multi-step reasoning matters (retention analysis, forge synthesis,
 * channel-inception creative work).
 */
export async function claudeJson<T = unknown>(args: {
  prompt: string;
  system?: string;
  model?: string;
  /** "flash" (default) = gemini-2.5-flash, no thinking. "pro" = gemini-2.5-pro (thinking capped in gemini.ts). */
  tier?: "flash" | "pro";
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
  const pro = args.tier === "pro";
  return geminiJson<T>({
    prompt: `${args.system ? `${args.system}\n\n` : ""}${args.prompt}`,
    model: pro ? "gemini-2.5-pro" : "gemini-2.5-flash",
    // Pro keeps a floor (thinking eats budget before output); flash needs none.
    maxTokens: pro ? Math.max((args.maxTokens ?? 600) * 2, 6000) : (args.maxTokens ?? 1200),
    temperature: args.temperature,
  });
}
