import type { PipelineEntry } from "./types";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

/** Convex-safe structural comparison for effective channel pipelines. */
export function comparablePipeline(entries: readonly PipelineEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      block: entry.block,
      params: canonicalValue(entry.params ?? null),
    })),
  );
}
