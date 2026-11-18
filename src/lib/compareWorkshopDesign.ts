import { canonicalJson } from "@/lib/canonicalJson";

type Entry = { block: string; version?: string; params?: unknown };
type Difference = { block: string; changes: string[] };

/** Imported drafts have no stable module-instance identity or compiled defaults. */
export function compareWorkshopDesign(saved: readonly Entry[], imported: readonly Entry[]) {
  const counts = (entries: readonly Entry[]) => {
    const result = new Map<string, number>();
    for (const entry of entries) result.set(entry.block, (result.get(entry.block) ?? 0) + 1);
    return result;
  };
  const beforeCounts = counts(saved), afterCounts = counts(imported);
  const repeatedBlocks = [...new Set([...beforeCounts.keys(), ...afterCounts.keys()])]
    .filter(block => (beforeCounts.get(block) ?? 0) > 1 || (afterCounts.get(block) ?? 0) > 1);
  const repeated = new Set(repeatedBlocks);
  const before = saved.filter(entry => !repeated.has(entry.block));
  const after = imported.filter(entry => !repeated.has(entry.block));
  const beforeByBlock = new Map(before.map(entry => [entry.block, entry]));
  const afterByBlock = new Map(after.map(entry => [entry.block, entry]));
  const commonBefore = before.filter(entry => afterByBlock.has(entry.block)).map(entry => entry.block);
  const commonAfter = after.filter(entry => beforeByBlock.has(entry.block)).map(entry => entry.block);
  const differences: Difference[] = [];
  for (const entry of after) {
    const previous = beforeByBlock.get(entry.block);
    const changes = !previous ? ["Added"] : [
      ...(commonBefore.indexOf(entry.block) !== commonAfter.indexOf(entry.block) ? ["Relative order changed"] : []),
      ...(previous.version === entry.version ? [] : [previous.version === undefined ? "Version specified" : entry.version === undefined ? "Version omitted" : "Version changed"]),
      ...(canonicalJson(previous.params ?? {}) === canonicalJson(entry.params ?? {}) ? [] : ["Settings changed"]),
    ];
    if (changes.length) differences.push({ block: entry.block, changes });
  }
  for (const entry of before) if (!afterByBlock.has(entry.block)) differences.push({ block: entry.block, changes: ["Removed"] });
  return { differences, repeatedBlocks, unpinnedSaved: saved.filter(entry => !entry.version).length, unpinnedImported: imported.filter(entry => !entry.version).length };
}
