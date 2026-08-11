/**
 * Film-crew brief blocks — the per-video creative-direction layer. Each block
 * loads the channel's Show Bible + frozen Style DNA, calls its crew agent for
 * one slice of the VideoBrief, and writes that slice to the store for
 * downstream mechanical blocks to execute. Each is individually addable to a
 * pipeline (one per crew role).
 *
 * NO SILENT FALLBACK (2026-06-10): these blocks run pre-spend (right after
 * topic_select), so an agent failure THROWS instead of returning an empty
 * shaped brief — an empty brief used to silently strip the channel's entire
 * creative direction from the video. A channel with no Show Bible still runs:
 * the brief grounds itself in the Style DNA + identity (a pseudo-bible), and
 * only a channel with NEITHER fails loudly (it's mis-provisioned).
 */
import type { Block, StageContext } from "@/engine/types";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ShowBible, StyleDNA } from "@/engine/creative/types";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { resolveCrew } from "@/lib/crew/crewProfile";
import type { CrewRoleId } from "@/lib/crew/roles";
import { resolveDirectorConfig } from "@/lib/crew/director";
import {
  cinematographerDirectives,
  resolveCinematographerConfig,
} from "@/lib/crew/cinematographer";
import { editorDirectives, resolveEditorConfig } from "@/lib/crew/editor";
import { composerDirectives, resolveComposerConfig } from "@/lib/crew/composer";
import { applyCriticPolicy, resolveCriticConfig } from "@/lib/crew/critic";
import {
  briefDirector,
  briefCinematographer,
  briefEditor,
  briefComposer,
  briefCritic,
  type CrewContext,
} from "@/engine/creative/crew";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function topicOf(ctx: StageContext): string {
  const t = ctx.store["topic"];
  return typeof t === "string" && t.length ? t : "";
}

interface ChannelGrounding {
  bible: ShowBible | null;
  dna: StyleDNA | null;
  channelName?: string;
  niche?: string;
  persona?: string;
  styleGrammar?: string;
  /** Raw channel fields needed only to build the scoped ChannelProfile that
   *  feeds resolveCrew (see crewProfileFor below) — not used for anything else. */
  slug?: string;
  status?: string;
  template?: string;
  budget?: number;
  moduleConfig?: Record<string, Record<string, unknown>>;
}

/** Load the channel + its Show Bible and Style DNA. */
async function loadGrounding(ctx: StageContext): Promise<ChannelGrounding> {
  try {
    const channel = await convex().query(api.channels.getChannel, {
      channelId: ctx.channelId as Id<"channels">,
    });
    const identity = channel?.identity as
      | { creativeBrief?: ShowBible; persona?: string; styleGrammar?: string; niche?: string }
      | undefined;
    const storeDna = ctx.store["styleDNA"] as StyleDNA | null | undefined;
    const row = channel as
      | {
          styleDNA?: StyleDNA;
          slug?: string;
          status?: string;
          template?: string;
          budget?: number;
          moduleConfig?: Record<string, Record<string, unknown>>;
        }
      | null;
    return {
      bible: identity?.creativeBrief ?? null,
      dna: storeDna ?? (row?.styleDNA ?? null),
      channelName: channel?.name,
      niche: identity?.niche,
      persona: identity?.persona,
      styleGrammar: identity?.styleGrammar,
      slug: row?.slug,
      status: row?.status,
      template: row?.template,
      budget: row?.budget,
      moduleConfig: row?.moduleConfig,
    };
  } catch (e) {
    ctx.log(`crew: loadGrounding failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    return { bible: null, dna: null };
  }
}

/**
 * The bible every brief works from. A channel without a Show Bible grounds in
 * its Style DNA + identity instead of silently dropping creative direction.
 * A channel with NEITHER is mis-provisioned → throw (pre-spend, safe).
 */
function resolveBible(g: ChannelGrounding, blockId: string, log: (m: string) => void): ShowBible {
  if (g.bible) return g.bible;
  if (g.dna?.recurringSubject || g.persona) {
    log(`${blockId}: no Show Bible — grounding the brief in Style DNA + identity (pseudo-bible)`);
    return {
      positioning:
        g.persona ?? `${g.channelName ?? "This channel"} — a ${g.niche ?? "niche"} channel.`,
      vibe: g.styleGrammar ?? g.dna?.colorGrade ?? "",
      iconicMotif: g.dna?.recurringSubject ?? "",
      worksInSpace: g.dna?.motifs ?? [],
      avoidInSpace: g.dna?.visualAvoid ?? [],
      activeCrew: ["director", "cinematographer", "editor", "composer", "critic"],
      refreshedAt: 0,
    };
  }
  throw new Error(
    `${blockId}: channel has NO Show Bible and NO Style DNA — refusing a generic brief. ` +
      `Run refresh-show-bible (or re-run design-channel grounding) for this channel.`,
  );
}

/**
 * Build the minimal ChannelProfile resolveCrew needs (pipeline + moduleOverrides
 * only — resolveCrew never touches identity/styleDNA/archetype). This is a
 * local, read-only construction scoped to this check: the pipeline-wide
 * ChannelProfile cutover (`src/engine/channelProfile.ts`'s documented TODO) is
 * a separate, much larger change and is NOT what this does. moduleOverrides
 * comes straight from the channel's real `moduleConfig['show-bible']` (preset +
 * role toggles, written by Settings' "Pipeline modules" section); an empty
 * `pipeline` is fine because `moduleParams()` merges moduleOverrides on top of
 * (or in place of) any pipeline-entry params for the same block id.
 */
function crewProfileFor(ctx: StageContext, g: ChannelGrounding): ChannelProfile {
  return buildChannelProfile({
    row: {
      _id: ctx.channelId,
      name: g.channelName ?? "",
      slug: g.slug ?? "",
      status: g.status ?? "active",
      template: g.template ?? "",
      budget: g.budget ?? 0,
      identity: undefined,
    },
    archetype: g.template ?? "unknown",
    pipeline: [],
    moduleOverrides: g.moduleConfig,
  });
}

/**
 * Actually calls resolveCrew — the catalog's documented "no silent gaps"
 * resolver (golden.ts's show-bible engine) — against this channel's real crew
 * config + the bible this block is about to brief from, and surfaces its typed
 * per-role warning into the pipeline log if this role is active without an
 * authored doctrine. Previously resolveCrew had zero non-test callers, so this
 * guarantee was unreachable outside the test suite (P1-8 in
 * docs/GOLDEN_MODULE_AUDIT_2026-08.md).
 *
 * Deliberately does NOT throw or change what gets briefed: `resolveBible`
 * above already made the "no doctrine" call for generation (pseudo-bible
 * fallback, dated 2026-06-10, "channel with no Show Bible still runs") and
 * that behavior is preserved as-is. This only makes the gap visible instead of
 * silent.
 */
function logCrewDoctrineGap(
  ctx: StageContext,
  g: ChannelGrounding,
  bible: ShowBible,
  blockId: string,
  role: CrewRoleId,
): void {
  try {
    const rc = resolveCrew(crewProfileFor(ctx, g), bible);
    const member = rc.members.find((m) => m.role === role);
    if (member && !member.hasDoctrine) {
      const warning = rc.warnings.find((w) => w.startsWith(`${role} `));
      ctx.log(`${blockId}: resolveCrew — ${warning ?? `${role} active but no authored doctrine`}`);
    } else if (!member) {
      ctx.log(
        `${blockId}: resolveCrew — ${role} is toggled off in moduleConfig['show-bible'] but this ` +
          `block still ran (pipeline/crew-config mismatch); briefing anyway.`,
      );
    }
  } catch (e) {
    ctx.log(`${blockId}: resolveCrew check failed (non-fatal, brief still proceeds): ${e instanceof Error ? e.message : e}`);
  }
}

/** Compact Style-DNA digest injected into every crew prompt. */
function dnaDigest(dna: StyleDNA | null): string {
  if (!dna) return "";
  const parts = [
    dna.recurringSubject ? `Recurring subject (the brand): ${dna.recurringSubject}` : "",
    dna.setting ? `Setting/world: ${dna.setting}` : "",
    dna.palette?.length ? `Palette: ${dna.palette.join(", ")}` : "",
    dna.colorGrade ? `Color grade: ${dna.colorGrade}` : "",
    dna.composition ? `Composition: ${dna.composition}` : "",
    dna.motionVocabulary?.length ? `Allowed motion: ${dna.motionVocabulary.join(", ")}` : "",
    dna.motionDiscipline ? `Motion discipline: ${dna.motionDiscipline}` : "",
    dna.visualAvoid?.length ? `NEVER render: ${dna.visualAvoid.join("; ")}` : "",
    dna.narrative?.pacing ? `Narration pacing: ${dna.narrative.pacing}` : "",
    dna.narrative?.delivery ? `Delivery: ${dna.narrative.delivery}` : "",
  ].filter(Boolean);
  return parts.length ? `STYLE DNA (frozen channel identity — conform to it):\n${parts.join("\n")}` : "";
}

/** Audio slice of the DNA, for the composer. */
function dnaAudioDigest(dna: StyleDNA | null): string {
  const a = dna?.audio;
  if (!a?.genre) return "";
  return (
    `AUDIO DNA (the channel's locked sound — your prompt must realise it): ` +
    `${a.genre}; instrumentation ${a.instrumentation?.join(", ") ?? "n/a"}; textures ${a.textures?.join(", ") ?? "n/a"}; ` +
    `${a.bpmRange?.[0] ?? "?"}-${a.bpmRange?.[1] ?? "?"} BPM; mood arc: ${a.moodArc ?? "n/a"}; ` +
    `master target ${a.loudnessLufs ?? -14} LUFS; ${a.loopable ? "loopable" : "natural ending"}.`
  );
}

function roleProfile(ctx: StageContext, block: string): ChannelProfile {
  return {
    pipeline: [{ block, params: ctx.params }],
    moduleOverrides: {},
  } as unknown as ChannelProfile;
}

function crewCtx(
  ctx: StageContext,
  g: ChannelGrounding,
  roleDirectives?: unknown,
): CrewContext {
  return {
    topic: topicOf(ctx),
    family: (ctx.params["family"] as string | undefined) ?? "narrated_stock",
    niche: (ctx.store["niche"] as string | undefined) ?? g.niche,
    channelName: (ctx.store["channelName"] as string | undefined) ?? g.channelName,
    targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined,
    dnaDigest: dnaDigest(g.dna),
    dnaAudio: dnaAudioDigest(g.dna),
    roleDirectives: roleDirectives ? JSON.stringify(roleDirectives) : undefined,
    log: ctx.log,
  };
}

function failLoud(blockId: string): never {
  throw new Error(
    `${blockId}: crew agent failed — refusing a silent empty brief (the run would lose its ` +
      `creative direction). Transient model errors retry via the runner; persistent failures ` +
      `need the Doctor/operator.`,
  );
}

/* ---------------------------- director_brief --------------------------- */

export const directorBriefBlock: Block = {
  id: "director_brief",
  consumes: ["topic"],
  produces: ["structure"],
  run: async (ctx) => {
    const g = await loadGrounding(ctx);
    const bible = resolveBible(g, "director_brief", ctx.log);
    logCrewDoctrineGap(ctx, g, bible, "director_brief", "director");
    const config = resolveDirectorConfig(roleProfile(ctx, "director_brief"));
    const out = await briefDirector(bible, crewCtx(ctx, g, config));
    if (!out) failLoud("director_brief");
    ctx.log(`director_brief: ${out.beats.length} beats`);
    return { structure: { ...out, config, configVersion: "director@1.0.0" } };
  },
};

/* ------------------------------ dp_brief ------------------------------- */

export const dpBriefBlock: Block = {
  id: "dp_brief",
  consumes: ["topic"],
  produces: ["visualBrief"],
  run: async (ctx) => {
    const g = await loadGrounding(ctx);
    const bible = resolveBible(g, "dp_brief", ctx.log);
    logCrewDoctrineGap(ctx, g, bible, "dp_brief", "cinematographer");
    const config = resolveCinematographerConfig(roleProfile(ctx, "dp_brief"));
    const directives = cinematographerDirectives(config);
    const out = await briefCinematographer(bible, crewCtx(ctx, g, directives));
    if (!out) failLoud("dp_brief");
    ctx.log(`dp_brief: ${out.footageQueries.length} queries`);
    return {
      visualBrief: {
        ...out,
        config,
        directives,
        configVersion: "cinematographer@1.0.0",
      },
    };
  },
};

/* ---------------------------- editor_brief ----------------------------- */

export const editorBriefBlock: Block = {
  id: "editor_brief",
  consumes: ["topic"],
  produces: ["cutSheet"],
  run: async (ctx) => {
    const g = await loadGrounding(ctx);
    const bible = resolveBible(g, "editor_brief", ctx.log);
    logCrewDoctrineGap(ctx, g, bible, "editor_brief", "editor");
    const config = resolveEditorConfig(roleProfile(ctx, "editor_brief"));
    const directives = editorDirectives(config);
    const out = await briefEditor(bible, crewCtx(ctx, g, directives));
    if (!out) failLoud("editor_brief");
    ctx.log(`editor_brief: ${out.sections.length} sections`);
    return { cutSheet: { ...out, config, directives, configVersion: "editor@1.0.0" } };
  },
};

/* --------------------------- composer_brief ---------------------------- */

export const composerBriefBlock: Block = {
  id: "composer_brief",
  consumes: ["topic"],
  produces: ["musicBrief"],
  run: async (ctx) => {
    const g = await loadGrounding(ctx);
    const bible = resolveBible(g, "composer_brief", ctx.log);
    logCrewDoctrineGap(ctx, g, bible, "composer_brief", "composer");
    const config = resolveComposerConfig(roleProfile(ctx, "composer_brief"));
    const directives = composerDirectives(config);
    const out = await briefComposer(bible, crewCtx(ctx, g, { config, directives }));
    if (!out) failLoud("composer_brief");
    ctx.log(`composer_brief: music prompt set`);
    return { musicBrief: { ...out, config, directives, configVersion: "composer@1.0.0" } };
  },
};

/* ----------------------------- critic_spec ----------------------------- */

export const criticSpecBlock: Block = {
  id: "critic_spec",
  consumes: ["topic"],
  produces: ["validationSpec"],
  run: async (ctx) => {
    const g = await loadGrounding(ctx);
    const bible = resolveBible(g, "critic_spec", ctx.log);
    logCrewDoctrineGap(ctx, g, bible, "critic_spec", "critic");
    const config = resolveCriticConfig(roleProfile(ctx, "critic_spec"));
    const out = await briefCritic(bible, crewCtx(ctx, g, config));
    if (!out) failLoud("critic_spec");
    const validationSpec = applyCriticPolicy(out, config);
    ctx.log(`critic_spec: ${validationSpec.assertions.length} assertions`);
    return {
      validationSpec: {
        ...validationSpec,
        config,
        configVersion: "critic@1.0.0",
      },
    };
  },
};

export const CREW_BLOCKS: Block[] = [
  directorBriefBlock,
  dpBriefBlock,
  editorBriefBlock,
  composerBriefBlock,
  criticSpecBlock,
];
