/**
 * The ONE module menu the orchestrator reads — pipeline BLOCKS (exposed as Mastra
 * tools by blockTool.ts) and the standalone FORMAT engines (formatTools.ts) in a
 * single uniform list. The orchestrator reasons across all of them at once when it
 * decides which modules a video needs (docs/MODULES_TO_MASTRA.md).
 */
import { configurableModules } from "@/engine/moduleRegistry";
import { MODULE_SPECS } from "./formatTools";

export interface CatalogEntry {
  id: string;
  kind: "block" | "format-engine";
  title: string;
  capabilities: readonly string[];
  bestFor?: string;
}

/** The unified catalog: every registered block surface + every standalone engine. */
export function allModules(): CatalogEntry[] {
  const blocks: CatalogEntry[] = configurableModules().map(({ blockId, card, surface }) => ({
    id: blockId,
    kind: "block",
    title: card.title,
    capabilities: surface.capabilities,
  }));
  const engines: CatalogEntry[] = MODULE_SPECS.map((m) => ({
    id: m.id,
    kind: "format-engine",
    title: m.title,
    capabilities: m.capabilities,
    bestFor: m.bestFor,
  }));
  return [...blocks, ...engines];
}

export function findModule(id: string): CatalogEntry | undefined {
  return allModules().find((m) => m.id === id);
}
