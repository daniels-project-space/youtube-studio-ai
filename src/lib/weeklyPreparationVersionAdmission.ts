import type { PlanWeekPreparationManifest } from "./planWeekPreparationContract";

/** Weekly producers do not yet dispatch qualified versioned implementations. */
export function assertWeeklyPreparationVersionsSupported(
  pipeline: PlanWeekPreparationManifest["execution"]["pipeline"],
  context: string,
): void {
  const unsupported = pipeline.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as { block?: unknown; version?: unknown };
    if (candidate.version === undefined) return [];
    const block = typeof candidate.block === "string" ? candidate.block : "<unknown block>";
    return [`${block}@${JSON.stringify(candidate.version)} (entry ${index})`];
  });
  if (unsupported.length) {
    throw new Error(
      `${context}: unsupported explicit weekly preparation implementation versions: ${unsupported.join(", ")}. ` +
      "Versioned weekly runtimes are not qualified; refusing prepared reuse and generation without fallback.",
    );
  }
}
