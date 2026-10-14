export interface ScriptNarrationContract {
  hook: string;
  sections: readonly { narration: string }[];
  narrationText: string;
}

export function assembleScriptNarration(
  hook: string,
  sections: readonly { narration: string }[],
): string {
  return [hook, ...sections.map(section => section.narration)]
    .map(text => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function assertScriptNarrationConsistent(value: unknown, source: string): asserts value is ScriptNarrationContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: script narration fields are invalid`);
  }
  const script = value as Record<string, unknown>;
  if (
    typeof script.hook !== "string" ||
    !Array.isArray(script.sections) ||
    script.sections.some(section => !section || typeof section !== "object" || typeof (section as Record<string, unknown>).narration !== "string") ||
    typeof script.narrationText !== "string"
  ) {
    throw new Error(`${source}: script narration fields are invalid`);
  }
  const expected = assembleScriptNarration(
    script.hook,
    script.sections as { narration: string }[],
  );
  if (script.narrationText !== expected) {
    throw new Error(`${source}: narrationText does not match the hook and ordered sections`);
  }
}
