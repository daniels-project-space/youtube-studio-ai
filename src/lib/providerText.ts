/**
 * Provider-safe text bounds shared by every fal video route.
 *
 * fal rejects prompts above 2,500 characters with a deterministic HTTP 422.
 * Keep a small envelope for provider-side prompt decoration and cut at a word
 * boundary so an otherwise valid, already-paid render is never retried as if
 * the response were transient.
 */
export const FAL_VIDEO_PROMPT_MAX_CHARS = 2_200;

export function boundFalVideoPrompt(prompt: string): string {
  if (prompt.length <= FAL_VIDEO_PROMPT_MAX_CHARS) return prompt;
  const hardBound = prompt.slice(0, FAL_VIDEO_PROMPT_MAX_CHARS);
  const wordBound = hardBound.replace(/\s+\S*$/, "").trimEnd();
  return wordBound || hardBound;
}
