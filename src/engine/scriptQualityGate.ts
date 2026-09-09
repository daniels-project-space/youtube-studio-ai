/**
 * Script-quality admission is deliberately provider-agnostic. Callers obtain
 * the critique however their family is configured, then use this small gate to
 * prevent an unreviewed or rejected narration from reaching paid audio/video.
 */
export function parseScriptCritique(value: unknown): { pass: boolean; issues: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("malformed script critique: expected an object with pass and issues");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || typeof row.pass !== "boolean" || !Array.isArray(row.issues) ||
      row.issues.length > 5 || row.issues.some((issue) => typeof issue !== "string" || !issue.trim() || issue.length > 140)) {
    throw new Error("malformed script critique: expected an explicit boolean verdict and at most five bounded text issues");
  }
  return { pass: row.pass, issues: row.issues.map((issue: string) => issue.trim()) };
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
