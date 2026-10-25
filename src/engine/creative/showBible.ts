/**
 * Showrunner — writes a channel's Show Bible once at creation. Reuses competitor
 * signals already gathered by auto-SEO to ground the works/avoid doctrine. Runs
 * through the pinned OpenRouter creative-text route via the `showrunner` agent,
 * with strict output admission. Incomplete output is repaired once, then fails
 * rather than being persisted as a complete channel identity.
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
const MIN_SPACE_PATTERNS = 5;
const MAX_SPACE_PATTERNS = 8;
const DOCTRINE_FIELD: Record<VideoCrewRole, keyof Pick<ShowBible,
  "directorDoctrine" | "dpDoctrine" | "editorDoctrine" | "composerDoctrine" | "criticDoctrine"
>> = {
  director: "directorDoctrine",
  cinematographer: "dpDoctrine",
  editor: "editorDoctrine",
  composer: "composerDoctrine",
  critic: "criticDoctrine",
};

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
type BibleDraft = z.input<typeof bibleSchema>;

function distinctPatterns(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === MAX_SPACE_PATTERNS) break;
  }
  return result;
}

function inspectBible(raw: BibleDraft, input: ShowBibleInput): { bible: ShowBible; issues: string[] } {
  const worksInSpace = distinctPatterns(raw.worksInSpace ?? []);
  const avoidInSpace = distinctPatterns(raw.avoidInSpace ?? []);
  const positioning = raw.positioning.trim();
  const vibe = raw.vibe.trim();
  const iconicMotif = (input.motifHint || raw.iconicMotif).trim();
  const activeCrew = reconcileCrew(input.family, raw.activeCrew ?? []);
  const issues: string[] = [];
  if (worksInSpace.length < MIN_SPACE_PATTERNS) {
    issues.push(`worksInSpace requires at least ${MIN_SPACE_PATTERNS} distinct niche-specific patterns (got ${worksInSpace.length})`);
  }
  if (avoidInSpace.length < MIN_SPACE_PATTERNS) {
    issues.push(`avoidInSpace requires at least ${MIN_SPACE_PATTERNS} distinct niche-specific anti-patterns (got ${avoidInSpace.length})`);
  }
  const worksKeys = new Set(worksInSpace.map((value) => value.toLowerCase()));
  if (avoidInSpace.some((value) => worksKeys.has(value.toLowerCase()))) {
    issues.push("worksInSpace and avoidInSpace must not contradict by repeating the same pattern");
  }
  if (!positioning) issues.push("positioning must be non-empty");
  if (!vibe) issues.push("vibe must be non-empty");
  if (!iconicMotif) issues.push("iconicMotif must be non-empty");
  for (const role of activeCrew) {
    const field = DOCTRINE_FIELD[role];
    if (!raw[field]?.trim()) issues.push(`${field} is required for active crew role ${role}`);
  }

  return {
    bible: {
      positioning,
      vibe,
      iconicMotif,
      worksInSpace,
      avoidInSpace,
      activeCrew,
      directorDoctrine: raw.directorDoctrine?.trim() || undefined,
      dpDoctrine: raw.dpDoctrine?.trim() || undefined,
      editorDoctrine: raw.editorDoctrine?.trim() || undefined,
      composerDoctrine: raw.composerDoctrine?.trim() || undefined,
      criticDoctrine: raw.criticDoctrine?.trim() || undefined,
      refreshedAt: input.now,
    },
    issues,
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
  if (!hasCreativeTextKey()) {
    throw new Error("showBible: creative-model key required for a qualified Bible");
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

  const requestBible = (requestPrompt: string) => agentJson({
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
      // These are channel-level contracts, not optional video polish: patterns
      // and role doctrines persist into every crew brief. A malformed Bible is
      // repaired once, then rejected rather than being silently persisted.
      maxTokens: 4000,
      temperature: 0.8,
      prompt: requestPrompt,
    });

  let raw: BibleDraft;
  try {
    raw = await requestBible(prompt);
  } catch (e) {
    log(`showBible: structured generation failed; refusing incomplete fallback (${e instanceof Error ? e.message : e})`);
    throw new Error("showBible: structured generation failed; refusing an unqualified fallback");
  }

  let inspected = inspectBible(raw, input);
  if (inspected.issues.length) {
    log(`showBible: incomplete quality contract (${inspected.issues.length} issue(s)) — requesting one repair`);
    raw = await requestBible(
      `${prompt}\n\nREPAIR these quality failures in the full JSON response: ${inspected.issues.join("; ")}. ` +
      `Both worksInSpace and avoidInSpace must each contain 5-8 distinct, specific patterns grounded in this channel's niche.`,
    );
    inspected = inspectBible(raw, input);
    if (inspected.issues.length) {
      throw new Error(`Show Bible quality contract failed after repair: ${inspected.issues.join("; ")}`);
    }
  }

  const bible = inspected.bible;
  log("showBible: ready", { motif: bible.iconicMotif.slice(0, 50), crew: bible.activeCrew });
  return bible;
}

export { FAMILY_CREW };
