import { canonicalJson } from "@/lib/canonicalJson";

type Entry = { block: string; version?: string; params?: unknown };
export type PipelineDifference = { block: string; occurrence: number; changes: string[] };

/** Compare repeated blocks by occurrence; never imply that a compiled candidate is active. */
export function comparePipelineCandidates(saved: readonly Entry[], candidate: readonly Entry[]): PipelineDifference[] {
  const annotate = (entries: readonly Entry[]) => {
    const counts = new Map<string, number>();
    return entries.map((entry, index) => {
      const occurrence = (counts.get(entry.block) ?? 0) + 1;
      counts.set(entry.block, occurrence);
      return { entry, index, occurrence, key: `${entry.block}\u0000${occurrence}` };
    });
  };
  const before = annotate(saved), after = annotate(candidate);
  const oldByKey = new Map(before.map(item => [item.key, item]));
  const newByKey = new Map(after.map(item => [item.key, item]));
  const differences: PipelineDifference[] = [];
  for (const item of after) {
    const old = oldByKey.get(item.key);
    const changes = !old ? ["Added"] : [
      ...(old.index !== item.index ? ["Position changed"] : []),
      ...(old.entry.version === item.entry.version ? [] : [old.entry.version === undefined ? "Version resolved" : item.entry.version === undefined ? "Version unavailable" : "Version changed"]),
      ...(canonicalJson(old.entry.params ?? {}) !== canonicalJson(item.entry.params ?? {}) ? ["Settings changed"] : []),
    ];
    if (changes.length) differences.push({ block: item.entry.block, occurrence: item.occurrence, changes });
  }
  for (const item of before) if (!newByKey.has(item.key)) differences.push({ block: item.entry.block, occurrence: item.occurrence, changes: ["Removed"] });
  return differences;
}
