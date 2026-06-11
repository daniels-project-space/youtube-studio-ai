/**
 * Maps a raw run error string to a human-readable failure reason + the pipeline
 * stage it most likely came from, so the Studio UI can say "Fish Audio key /
 * credits missing (narration_tts)" instead of dumping a stack trace. Pure, no I/O.
 */
export interface FailureInfo {
  /** Best-guess failing block id (parsed from the "block_id: …" error prefix). */
  block?: string;
  /** Short, human reason. */
  reason: string;
  /** Optional actionable hint (what to fix). */
  hint?: string;
}

const RULES: { test: RegExp; reason: string; hint?: string }[] = [
  { test: /fish[_\s-]?audio|FISH_AUDIO_API_KEY/i, reason: "Fish Audio key / credits missing", hint: "Add or top up fish-audio in the vault." },
  { test: /PEXELS_API_KEY|pexels/i, reason: "Pexels API key missing", hint: "Add pexels/PEXELS_API_KEY to the vault." },
  { test: /mureka|MUREKA_API_KEY/i, reason: "Mureka music key / credits missing", hint: "Check mureka credits in the vault." },
  { test: /FAL_KEY|fal[ .-]?flux|fal\.ai/i, reason: "Flux (fal.ai) key / credits missing", hint: "Check fal/FAL_KEY + balance." },
  { test: /GEMINI_API_KEY|GOOGLE_API_KEY|\bgemini\b/i, reason: "Gemini API key missing/invalid", hint: "Check gemini key in the vault." },
  { test: /ANTHROPIC_API_KEY|anthropic|claude/i, reason: "Anthropic (Claude) key missing/invalid" },
  { test: /R2_|cloudflare|S3|bucket/i, reason: "Storage (R2) credentials issue" },
  { test: /YOUTUBE|invalidTags|youtube\.upload|refresh token/i, reason: "YouTube upload rejected", hint: "Re-check tags or the YouTube OAuth token." },
  { test: /OOM|KILLED|out of memory|TASK_PROCESS_OOM/i, reason: "Render ran out of memory", hint: "Heavy encode — shorten the video or bump the machine." },
  { test: /length_check|minSeconds|maxSeconds|outside|too short|too long/i, reason: "Video length outside the allowed range" },
  { test: /qa[_\s]?visual|qa did not pass|qaPassed|quality gate/i, reason: "QA quality gate failed", hint: "Footage/thumbnail/SEO scored too low." },
  { test: /originality|too similar|duplicate/i, reason: "Originality gate failed (too similar to a past video)" },
  { test: /compliance|sensitive|policy/i, reason: "Compliance gate flagged the content" },
  { test: /quota|rate.?limit|\b429\b|too many requests/i, reason: "Hit an API rate limit / quota", hint: "Retry later or raise the quota." },
  { test: /\b403\b|insufficient|permission|forbidden|unauthor/i, reason: "API permission / credits problem" },
  { test: /timeout|timed out|ETIMEDOUT|deadline/i, reason: "A step timed out" },
  { test: /no clips|no footage|footage/i, reason: "Couldn't gather enough stock footage" },
  { test: /cancell?ed/i, reason: "Cancelled" },
];

export function failureReason(error?: string | null): FailureInfo {
  const raw = (error ?? "").trim();
  if (!raw) return { reason: "Failed (no error recorded)" };
  // Block id is usually the "<block_id>: message" prefix the blocks throw with.
  const block = raw.match(/(?:^|[(\s])([a-z][a-z0-9_]+_[a-z0-9_]+):/)?.[1];
  for (const r of RULES) {
    if (r.test.test(raw)) return { block, reason: r.reason, hint: r.hint };
  }
  // Fallback: first sentence/line of the raw error, trimmed.
  const first = raw.split(/[\n.]/)[0].replace(/^[a-z_]+:\s*/i, "").slice(0, 140);
  return { block, reason: first || "Failed" };
}
