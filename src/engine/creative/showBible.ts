/**
 * Showrunner — writes a channel's Show Bible once at creation. Reuses competitor
 * signals already gathered by auto-SEO to ground the works/avoid doctrine. Runs
 * on Claude (high-value, one-time) via the `showrunner` agent, with a
 * deterministic fallback so channel creation never hard-fails.
 */
import { z } from "zod";
import { agentJson } from "@/agents/mastra";
import { hasGeminiKey } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { FAMILY_CREW as FAMILY_CREW_RAW, type FamilyKey } from "@/engine/families";
import { VIDEO_CREW_ROLES, type ShowBible, type VideoCrewRole } from "./types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/** Family → the crew roles that format needs (typed view of the families map). */
const FAMILY_CREW = FAMILY_CREW_RAW as Record<FamilyKey, VideoCrewRole[]>;

export interface ShowBibleInput {
  family: FamilyKey;
  name: string;
  niche?: string;
  persona?: string;
  styleGrammar?: string;
  /** Competitor / niche-intel context string (top titles, power words). */
  competitorContext?: string;
  /** Operator-preferred iconic motif (e.g. "hooded stoic marble statue"). */
  motifHint?: string;
  now: number;
  log?: Logger;
}

const bibleSchema = z.object({
  positioning: z.string(),
  vibe: z.string(),
  iconicMotif: z.string(),
  worksInSpace: z.array(z.string()).default([]),
  avoidInSpace: z.array(z.string()).default([]),
  activeCrew: z.array(z.string()).default([]),
  directorDoctrine: z.string().optional(),
  dpDoctrine: z.string().optional(),
  editorDoctrine: z.string().optional(),
  composerDoctrine: z.string().optional(),
  criticDoctrine: z.string().optional(),
});

function fallbackBible(input: ShowBibleInput): ShowBible {
  const crew = FAMILY_CREW[input.family] ?? FAMILY_CREW.narrated_stock;
  return {
    positioning: `${input.name} — a ${input.niche ?? "focused"} channel in the ${input.family} format.`,
    vibe: input.persona ?? "calm, consistent, on-brand",
    iconicMotif: input.motifHint ?? input.styleGrammar ?? "a single bold, recurring central subject",
    worksInSpace: [],
    avoidInSpace: [],
    activeCrew: crew,
    refreshedAt: input.now,
  };
}

/** Keep only valid, family-appropriate crew roles; fall back to the family set. */
function reconcileCrew(family: FamilyKey, proposed: string[]): VideoCrewRole[] {
  const allowed = new Set<VideoCrewRole>(FAMILY_CREW[family] ?? FAMILY_CREW.narrated_stock);
  const valid = proposed.filter((r): r is VideoCrewRole =>
    (VIDEO_CREW_ROLES as readonly string[]).includes(r) && allowed.has(r as VideoCrewRole),
  );
  // The critic is mandatory (validation) and the family's primary creator is too.
  const out = new Set<VideoCrewRole>(valid);
  out.add("critic");
  if (valid.length === 0) return FAMILY_CREW[family] ?? FAMILY_CREW.narrated_stock;
  return [...out];
}

export async function synthShowBible(input: ShowBibleInput): Promise<ShowBible> {
  const log = input.log ?? (() => {});
  if (!hasAnthropicKey() && !hasGeminiKey()) {
    log("showBible: no LLM key — deterministic fallback");
    return fallbackBible(input);
  }

  const familyCrew = FAMILY_CREW[input.family] ?? FAMILY_CREW.narrated_stock;
  const prompt = [
    `Write the SHOW BIBLE for a YouTube channel.`,
    `Name: ${input.name}`,
    `Format (family): ${input.family}`,
    input.niche ? `Niche: ${input.niche}` : "",
    input.persona ? `Persona seed: ${input.persona}` : "",
    input.styleGrammar ? `Visual style seed: ${input.styleGrammar}` : "",
    input.motifHint ? `Operator wants the iconic motif to be: ${input.motifHint}` : "",
    input.competitorContext ? `COMPETITOR SIGNALS (top performers in this space):\n${input.competitorContext}` : "",
    "",
    `Produce:`,
    `- positioning: one paragraph — what this channel IS and who it's for.`,
    `- vibe: the emotional/tonal signature in 1-2 sentences.`,
    `- iconicMotif: the ONE recurring visual signature (avatar + thumbnails + intro share it). Be concrete.`,
    `- worksInSpace: 5-8 SPECIFIC patterns proven to work in this niche (from the signals + your knowledge).`,
    `- avoidInSpace: 5-8 SPECIFIC anti-patterns that FAIL in this niche — the mistakes to never make. This is critical.`,
    `- activeCrew: which of [${familyCrew.join(", ")}] this channel needs (a subset; the critic is always required).`,
    `- directorDoctrine / dpDoctrine / editorDoctrine / composerDoctrine / criticDoctrine: a 1-2 sentence default stance for each ACTIVE role (omit roles not active). These are the per-channel goals each crew agent works from every video.`,
    `Be specific and opinionated — generic answers are failures. Return STRICT JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await agentJson({
      role: "showrunner",
      schema: bibleSchema,
      log: (m) => log(m),
      maxTokens: 2000,
      temperature: 0.8,
      prompt,
    });
    const bible: ShowBible = {
      positioning: raw.positioning.trim(),
      vibe: raw.vibe.trim(),
      iconicMotif: (input.motifHint || raw.iconicMotif).trim(),
      worksInSpace: (raw.worksInSpace ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
      avoidInSpace: (raw.avoidInSpace ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
      activeCrew: reconcileCrew(input.family, raw.activeCrew ?? []),
      directorDoctrine: raw.directorDoctrine?.trim() || undefined,
      dpDoctrine: raw.dpDoctrine?.trim() || undefined,
      editorDoctrine: raw.editorDoctrine?.trim() || undefined,
      composerDoctrine: raw.composerDoctrine?.trim() || undefined,
      criticDoctrine: raw.criticDoctrine?.trim() || undefined,
      refreshedAt: input.now,
    };
    log("showBible: ready", { motif: bible.iconicMotif.slice(0, 50), crew: bible.activeCrew });
    return bible;
  } catch (e) {
    log(`showBible: synth failed (${e instanceof Error ? e.message : e}) — fallback`);
    return fallbackBible(input);
  }
}

export { FAMILY_CREW };
