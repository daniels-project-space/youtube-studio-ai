/**
 * resolveCrew — the Crew "brain" (pure). Reads the channel's ShowBible (authored
 * doctrines) + the crew CustomizationSurface (preset + overrides on the ChannelProfile)
 * → a typed ResolvedCrew: which roles are active, each one's doctrine, the critic's
 * strictness, and style hints. NO I/O, NO LLM — that's the Showrunner's job; this
 * resolver consumes its output. Replaces the 5 hardcoded brief-block branches with
 * one data-driven function.
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue } from "@/engine/customization";
import type { ShowBible } from "@/engine/creative/types";
import { CREW_ROLE_DEFS, CREW_ROLE_ORDER, type CrewRoleId } from "./roles";
import { CREW_SURFACE } from "./module";

export type CriticStrictness = "lenient" | "standard" | "strict";

export interface ResolvedCrewMember {
  role: CrewRoleId;
  title: string;
  /** The authored doctrine for this role (from the ShowBible); "" if not yet authored. */
  doctrine: string;
  hasDoctrine: boolean;
  /** Downstream stages this role feeds. */
  informs: string[];
}

export interface ResolvedCrew {
  members: ResolvedCrewMember[];
  criticStrictness: CriticStrictness;
  marketAwareCritic: boolean;
  directorStyle: string;
  editorCadence: string;
  /** Roles active without an authored doctrine, or an empty crew — typed + gateable, never silent. */
  warnings: string[];
}

/** Channel-level config namespace for the crew module (moduleConfig['show-bible']). */
export const CREW_BLOCK = "show-bible";

/**
 * Resolve the per-channel crew. `bible` is the channel's authored ShowBible
 * (channel.identity.creativeBrief) — pass null when none exists yet (every active
 * role then surfaces a "no doctrine" warning the brief stage can fail loud on).
 */
export function resolveCrew(profile: ChannelProfile, bible?: ShowBible | null, block = CREW_BLOCK): ResolvedCrew {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;

  const overrides: Record<string, KnobValue> = {};
  for (const k of CREW_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const resolved = resolveKnobs(CREW_SURFACE, preset, overrides);
  if (!resolved.ok) throw new Error(`resolveCrew: ${resolved.errors.join("; ")}`);
  const k = resolved.values;

  const warnings: string[] = [];
  const members: ResolvedCrewMember[] = [];
  for (const id of CREW_ROLE_ORDER) {
    if (k[id] !== true) continue; // role toggled off for this channel
    const def = CREW_ROLE_DEFS[id];
    const doctrine = (bible?.[def.doctrineField] ?? "").trim();
    if (!doctrine) warnings.push(`${id} active but no ${def.doctrineField} authored (run refresh-show-bible)`);
    members.push({ role: id, title: def.title, doctrine, hasDoctrine: doctrine.length > 0, informs: def.informs });
  }
  if (members.length === 0) warnings.push("no crew roles active — channel has no creative direction");

  return {
    members,
    criticStrictness: String(k.criticStrictness) as CriticStrictness,
    marketAwareCritic: Boolean(k.marketAwareCritic),
    directorStyle: String(k.directorStyle),
    editorCadence: String(k.editorCadence),
    warnings,
  };
}

/** Is a role active for this channel? (what the Director/Architect ask before calling it). */
export function crewHasRole(rc: ResolvedCrew, role: CrewRoleId): boolean {
  return rc.members.some((m) => m.role === role);
}
