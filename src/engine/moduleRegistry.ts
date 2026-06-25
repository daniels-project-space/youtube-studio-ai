/**
 * MODULE_REGISTRY — the single catalog of base-module cards (pipeline block id →
 * self-describing card incl. its CustomizationSurface). ONE source of truth read by:
 *   - the onboarding + channel-settings UI  → render per-module toggles generically
 *   - resolveX (e.g. resolveAssembleParams)  → validate knob values
 *   - the future Pipeline Architect          → compose pipelines from capabilities
 * Register each base module here as it gets leveled up; the UI/Architect generalize for free.
 */
import type { CustomizationSurface } from "./customization";
import { ASSEMBLY_MODULE } from "@/lib/assembly/module";
import { CREW_MODULE } from "@/lib/crew/module";
import { EDITOR_MODULE } from "@/lib/crew/editor";
import { COMPOSER_MODULE } from "@/lib/crew/composer";

export interface ModuleCard {
  /** Module key (e.g. "assemble"). */
  key: string;
  title: string;
  stage: string;
  does?: string;
  /** Per-account knobs / presets / capabilities the UI + Architect configure from. */
  customization?: CustomizationSurface;
}

/** Pipeline BLOCK ID (as it appears in a channel's pipeline[]) → its card. */
export const MODULE_REGISTRY: Record<string, ModuleCard> = {
  timeline_assemble: ASSEMBLY_MODULE,
  "show-bible": CREW_MODULE,
  editor_brief: EDITOR_MODULE, // crew sub-module
  composer_brief: COMPOSER_MODULE, // crew sub-module (director/dp/critic to follow)
  // ← register Guard, Thumbnail, Visuals, … here as each is leveled up.
};

export function moduleCard(blockId: string): ModuleCard | undefined {
  return MODULE_REGISTRY[blockId];
}

export function moduleSurface(blockId: string): CustomizationSurface | undefined {
  return MODULE_REGISTRY[blockId]?.customization;
}

/** Every registered module that exposes a customization surface (what the UI renders toggles for). */
export function configurableModules(): { blockId: string; card: ModuleCard; surface: CustomizationSurface }[] {
  return Object.entries(MODULE_REGISTRY)
    .filter(([, c]) => c.customization)
    .map(([blockId, card]) => ({ blockId, card, surface: card.customization as CustomizationSurface }));
}
