/**
 * Script-quality admission is deliberately provider-agnostic. Callers obtain
 * the critique however their family is configured, then use this small gate to
 * prevent an unreviewed or rejected narration from reaching paid audio/video.
 */
const SCRIPT_CRITIQUE_HEAD_CHARS = 3_500;
const SCRIPT_CRITIQUE_MIDDLE_CHARS = 3_000;
const SCRIPT_CRITIQUE_TAIL_CHARS = 2_500;
const SCRIPT_CRITIQUE_MAX_SOURCE_CHARS =
  SCRIPT_CRITIQUE_HEAD_CHARS + SCRIPT_CRITIQUE_MIDDLE_CHARS + SCRIPT_CRITIQUE_TAIL_CHARS;

/** Keep long-script review bounded without leaving the central narrative unseen. */
export function scriptCritiqueExcerpt(narration: string): string {
  if (narration.length <= SCRIPT_CRITIQUE_MAX_SOURCE_CHARS) return narration;

  const latestMiddleStart = narration.length - SCRIPT_CRITIQUE_TAIL_CHARS - SCRIPT_CRITIQUE_MIDDLE_CHARS;
  const centeredMiddleStart = Math.floor(narration.length / 2 - SCRIPT_CRITIQUE_MIDDLE_CHARS / 2);
  const middleStart = Math.max(SCRIPT_CRITIQUE_HEAD_CHARS, Math.min(centeredMiddleStart, latestMiddleStart));
  const middleEnd = middleStart + SCRIPT_CRITIQUE_MIDDLE_CHARS;
  return [
    narration.slice(0, SCRIPT_CRITIQUE_HEAD_CHARS),
    narration.slice(middleStart, middleEnd),
    narration.slice(-SCRIPT_CRITIQUE_TAIL_CHARS),
  ].join("\n\n[... OMITTED ...]\n\n");
}

export function parseScriptCritique(value: unknown): { pass: boolean; issues: string[]; repairTarget?: "body" | "cold_open" | "both" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("malformed script critique: expected an object with pass and issues");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["pass", "issues", "repairTarget"].includes(key)) ||
      ("repairTarget" in row && !["body", "cold_open", "both"].includes(row.repairTarget as string)) ||
      typeof row.pass !== "boolean" || !Array.isArray(row.issues) ||
      row.issues.length > 5 || row.issues.some((issue) => typeof issue !== "string" || !issue.trim() || issue.length > 140)) {
    throw new Error("malformed script critique: expected an explicit boolean verdict and at most five bounded text issues");
  }
  const issues = row.issues.map((issue: string) => issue.trim());
  return { pass: row.pass && issues.length === 0, issues,
    ...(row.repairTarget !== undefined ? { repairTarget: row.repairTarget as "body" | "cold_open" | "both" } : {}) };
}

export function assertScriptCritiqueAccepted(input: {
  accepted: boolean;
  issues?: readonly string[];
  stage?: string;
}): void {
  if (input.accepted) return;
  const stage = input.stage ?? "script_gen";
  const issues = (input.issues ?? []).map((issue) => issue.trim()).filter(Boolean).slice(0, 4);
  throw new Error(
    `${stage} FAILED: independent narrative critique did not clear the quality bar` +
      (issues.length ? ` (${issues.join(" | ")})` : ""),
  );
}

/** A paid narration stage may consume only a positively admitted script. */
export function assertScriptApprovedForNarration(value: unknown): asserts value is true {
  if (value === true) return;
  throw new Error(
    "narration_tts FAILED: script quality is not approved; refusing paid voice synthesis until an independent narrative critique passes",
  );
}
