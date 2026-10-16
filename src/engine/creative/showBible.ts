/**
 * Showrunner — writes a channel's Show Bible once at creation. Reuses competitor
 * signals already gathered by auto-SEO to ground the works/avoid doctrine. Runs
 * through the pinned OpenRouter creative-text route via the `showrunner` agent,
 * with a
 * fail-closed quality gate so incomplete identity is never persisted.
 */
import { z } from "zod";
import { agentJson } from "@/agents/mastra";
import { hasCreativeTextKey } from "@/lib/creativeText";
import { FAMILY_CREW as FAMILY_CREW_RAW, type FamilyKey } from "@/engine/families";
import {
  channelProgramBriefPositioningText,
  type ChannelProgramBrief,
} from "@/engine/channelProgramBrief";
import { VIDEO_CREW_ROLES, type ShowBible, type VideoCrewRole } from "./types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/** Family → the crew roles that format needs (typed view of the families map). */
const FAMILY_CREW = FAMILY_CREW_RAW as Record<FamilyKey, VideoCrewRole[]>;

export interface ShowBibleInput {
  family: FamilyKey;
  name: string;
  /** Immutable creator program, carried forward on the channel identity. */
  programBrief?: ChannelProgramBrief;
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

/** Keep family roles while retaining the family creator and critic when required. */
export function reconcileShowBibleCrew(family: FamilyKey, proposed: string[]): VideoCrewRole[] {
  const familyCrew = FAMILY_CREW[family] ?? FAMILY_CREW.narrated_stock;
  const allowed = new Set<VideoCrewRole>(familyCrew);
  const valid = proposed.filter((r): r is VideoCrewRole =>
    (VIDEO_CREW_ROLES as readonly string[]).includes(r) && allowed.has(r as VideoCrewRole),
  );
  const out = new Set<VideoCrewRole>(valid);
  if (familyCrew.includes("critic")) out.add("critic");
  const primaryCreator = familyCrew.find((role) => role !== "critic");
  if (primaryCreator) out.add(primaryCreator);
  if (valid.length === 0) return familyCrew;
  return [...out];
}

const DOCTRINE_BY_ROLE: Record<VideoCrewRole, keyof ShowBible> = {
  director: "directorDoctrine",
  cinematographer: "dpDoctrine",
  editor: "editorDoctrine",
  composer: "composerDoctrine",
  critic: "criticDoctrine",
};

const LOW_INFORMATION_WORDS = new Set([
  "a", "about", "after", "all", "an", "and", "are", "as", "at", "audience", "avoid",
  "be", "because", "before", "best", "but", "by", "channel", "clear", "compelling",
  "content", "create", "each", "engaging", "ensure", "every", "for", "from", "good",
  "great", "high", "in", "interesting", "into", "is", "it", "keep", "make", "never",
  "of", "on", "or", "our", "over", "provide", "quality", "strong", "that", "the",
  "their", "them", "there", "these", "this", "through", "to", "use", "valuable", "video",
  "videos", "viewer", "viewers", "with", "without",
]);

const GENERIC_IDENTITY_PHRASES = [
  "calm consistent on brand",
  "single bold recurring central subject",
  "high quality engaging content",
  "visually appealing",
];

function informativeWords(value: string): Set<string> {
  return new Set(
    (value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{3,}/gu) ?? [])
      .filter((word) => !LOW_INFORMATION_WORDS.has(word)),
  );
}

function inspectGuidanceList(values: string[], label: string): string[] {
  const issues: string[] = [];
  const words = values.map(informativeWords);
  values.forEach((value, index) => {
    if (words[index]!.size < 3) issues.push(`${label} entry ${index + 1} lacks niche-specific substance`);
    for (let prior = 0; prior < index; prior += 1) {
      const left = words[index]!;
      const right = words[prior]!;
      if (left.size < 4 || right.size < 4) continue;
      const overlap = [...left].filter((word) => right.has(word)).length;
      const union = new Set([...left, ...right]).size;
      if (union > 0 && overlap / union >= 0.85) {
        issues.push(`${label} entries ${prior + 1} and ${index + 1} repeat the same guidance`);
      }
    }
  });
  return issues;
}

/** Deterministic admission checks for the channel-level creative contract. */
export function inspectShowBibleQuality(bible: ShowBible, family: FamilyKey): string[] {
  const issues: string[] = [];
  for (const field of ["positioning", "vibe", "iconicMotif"] as const) {
    if (!bible[field].trim()) issues.push(`${field} is empty`);
  }
  const identityMinimums = { positioning: 6, vibe: 4, iconicMotif: 4 } as const;
  for (const [field, minimum] of Object.entries(identityMinimums) as Array<
    [keyof typeof identityMinimums, number]
  >) {
    const words = informativeWords(bible[field]);
    if (words.size < minimum) {
      issues.push(`${field} lacks channel-specific substance (${words.size} informative terms; needs ${minimum})`);
    }
    const normalized = bible[field].normalize("NFKC").toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    for (const phrase of GENERIC_IDENTITY_PHRASES) {
      if (normalized.includes(phrase)) {
        issues.push(`${field} contains generic identity boilerplate "${phrase}"`);
      }
    }
  }
  for (const field of ["worksInSpace", "avoidInSpace"] as const) {
    const distinct = new Set(bible[field].map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (distinct.size < 5) issues.push(`${field} has fewer than five distinct entries`);
    issues.push(...inspectGuidanceList(bible[field], field));
  }

  const familyCrew = FAMILY_CREW[family] ?? FAMILY_CREW.narrated_stock;
  const requiredRoles: VideoCrewRole[] = [];
  if (familyCrew.includes("critic")) requiredRoles.push("critic");
  const primaryCreator = familyCrew.find((role) => role !== "critic");
  if (primaryCreator) requiredRoles.push(primaryCreator);
  for (const role of requiredRoles) {
    if (!bible.activeCrew.includes(role)) issues.push(`activeCrew is missing required ${role}`);
  }
  for (const role of bible.activeCrew) {
    const doctrine = bible[DOCTRINE_BY_ROLE[role]];
    if (typeof doctrine !== "string" || !doctrine.trim()) {
      issues.push(`${role} doctrine is empty`);
    }
  }
  return issues;
}

export async function synthShowBible(input: ShowBibleInput): Promise<ShowBible> {
  const log = input.log ?? (() => {});
  if (!hasCreativeTextKey()) {
    throw new Error("showBible: no configured creative-text provider; refusing incomplete channel identity");
  }

  const familyCrew = FAMILY_CREW[input.family] ?? FAMILY_CREW.narrated_stock;
  const programBriefText = input.programBrief
    ? channelProgramBriefPositioningText(input.programBrief)
    : "";
  const prompt = [
    `Write the SHOW BIBLE for a YouTube channel.`,
    `Name: ${input.name}`,
    `Format (family): ${input.family}`,
    programBriefText
      ? `DECLARED CHANNEL PROGRAM — CANON, not a suggestion. Preserve its concept, audience and named sample-topic priorities; competitor signals may improve execution but may not replace the program:\n${programBriefText}`
      : "",
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
      // MEASURED, not chosen: scripts/measure-showbible-ceiling.ts runs the real
      // synth over four channel identities. At 2000, 2 of 8 attempts fell back;
      // at 4000, 0 of 8. Small sample, but the direction matches every other
      // ceiling measured this session, and the cost of headroom is nothing — a
      // ceiling is only billed for tokens actually used.
      //
      // This contract is much heavier than the list floor was measured on: TWO
      // arrays of 5-8 specific items, an activeCrew array, three prose fields and
      // up to five doctrine strings — about 12 list items in practice, plus eight
      // prose fields, on a route where reasoning is billed from the same budget.
      //
      maxTokens: 4000,
      temperature: 0.8,
      prompt,
    });
    const bible: ShowBible = {
      positioning: raw.positioning.trim(),
      vibe: raw.vibe.trim(),
      iconicMotif: (input.motifHint || raw.iconicMotif).trim(),
      worksInSpace: (raw.worksInSpace ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
      avoidInSpace: (raw.avoidInSpace ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
      activeCrew: reconcileShowBibleCrew(input.family, raw.activeCrew ?? []),
      directorDoctrine: raw.directorDoctrine?.trim() || undefined,
      dpDoctrine: raw.dpDoctrine?.trim() || undefined,
      editorDoctrine: raw.editorDoctrine?.trim() || undefined,
      composerDoctrine: raw.composerDoctrine?.trim() || undefined,
      criticDoctrine: raw.criticDoctrine?.trim() || undefined,
      refreshedAt: input.now,
    };
    const qualityIssues = inspectShowBibleQuality(bible, input.family);
    if (qualityIssues.length > 0) {
      throw new Error(`Show Bible failed quality admission: ${qualityIssues.join("; ")}`);
    }
    log("showBible: ready", { motif: bible.iconicMotif.slice(0, 50), crew: bible.activeCrew });
    return bible;
  } catch (e) {
    log(`showBible: synth failed (${e instanceof Error ? e.message : e}) — refusing persistence`);
    throw e;
  }
}

export { FAMILY_CREW };
