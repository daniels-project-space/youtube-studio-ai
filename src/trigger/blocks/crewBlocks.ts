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
import { resolveCrew, type ResolvedCrew } from "@/lib/crew/crewProfile";
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

/**
 * Load the channel + its Show Bible and Style DNA.
 *
 * `runPipeline.ts` already fetches the channel once and freezes every field
 * this needs into `seedStore` (showBible/channelSlug/channelStatus/
 * channelTemplate/channelBudget/channelModuleConfig, alongside the
 * pre-existing styleDNA/channelName/niche/persona/styleGrammar). Reading that
 * instead of re-querying Convex removes 5 redundant `getChannel` calls per
 * run (this function is called from director/cinematographer/editor/composer/
 * critic briefs). `channelStatus` is frozen deliberately, same as every other
 * field here — see runPipeline.ts's seedStore comment: this is channel
 * config, not a credential or live publish-policy value that needs
 * re-checking mid-run.
 *
 * Falls back to a live Convex fetch only when `channelSlug`/`showBible` are
 * BOTH absent from the store — i.e. a run resumed from a durable snapshot or
 * probe-invocation context captured before this seeding existed. New runs
 * never take this path.
 */
async function loadGrounding(ctx: StageContext): Promise<ChannelGrounding> {
  const storeShowBible = ctx.store["showBible"] as ShowBible | null | undefined;
  const storeSlug = ctx.store["channelSlug"] as string | undefined;
  if (storeShowBible !== undefined || storeSlug !== undefined) {
    return {
      bible: storeShowBible ?? null,
      dna: (ctx.store["styleDNA"] as StyleDNA | null | undefined) ?? null,
      channelName: ctx.store["channelName"] as string | undefined,
      niche: ctx.store["niche"] as string | undefined,
      persona: ctx.store["persona"] as string | undefined,
      styleGrammar: ctx.store["styleGrammar"] as string | undefined,
      slug: storeSlug,
      status: ctx.store["channelStatus"] as string | undefined,
      template: ctx.store["channelTemplate"] as string | undefined,
      budget: ctx.store["channelBudget"] as number | undefined,
      moduleConfig: ctx.store["channelModuleConfig"] as
        | Record<string, Record<string, unknown>>
        | undefined,
    };
  }

  ctx.log("crew: loadGrounding — seedStore predates channel freeze, falling back to a live fetch");
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
 * Calls resolveCrew — the catalog's documented "no silent gaps" resolver
 * (golden.ts's show-bible engine) — against this channel's REAL crew config
 * (moduleConfig['show-bible'], read straight off the channel row via
 * crewProfileFor, bypassing runPipeline's per-block merge entirely: "show-bible"
 * is never itself a literal pipeline block id, so that merge never touches it)
 * and the bible this block is about to brief from. Non-fatal: any resolution
 * failure (malformed moduleConfig, etc.) is logged and returns null so callers
 * degrade to today's per-role-only defaults — never blocks a brief.
 *
 * Called ONCE per block run and threaded to two consumers:
 *  1. logCrewDoctrineGap (below) — the typed per-role "active but no authored
 *     doctrine" warning (P1-8, docs/GOLDEN_MODULE_AUDIT_2026-08.md).
 *  2. the editor_brief / critic_spec blocks — as a fallback for the ONE knob
 *     each of those roles' OWN surface also exposes (editor cadence; critic
 *     strictness + marketAware) — see roleProfile's crewFallback param. The
 *     director/DP/composer surfaces have no knob with an equivalent meaning
 *     (hookStyle/narrativeArc/coverageDensity/musicMood etc. are unrelated to
 *     directorStyle), so directorStyle has no landing spot below the show-bible
 *     resolver and is deliberately left unmapped.
 */
function resolveChannelCrew(
  ctx: StageContext,
  g: ChannelGrounding,
  bible: ShowBible,
): ResolvedCrew | null {
  try {
    return resolveCrew(crewProfileFor(ctx, g), bible);
  } catch (e) {
    ctx.log(
      `resolveCrew check failed (non-fatal, brief still proceeds): ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

/**
 * Surfaces resolveCrew's typed per-role "active but no authored doctrine"
 * warning into the pipeline log. Deliberately does NOT throw or change what
 * gets briefed: `resolveBible` above already made the "no doctrine" call for
 * generation (pseudo-bible fallback, dated 2026-06-10, "channel with no Show
 * Bible still runs") and that behavior is preserved as-is. This only makes the
 * gap visible instead of silent. Pure — takes the already-resolved crew (see
 * resolveChannelCrew) so it never throws itself.
 */
function logCrewDoctrineGap(
  ctx: StageContext,
  rc: ResolvedCrew | null,
  blockId: string,
  role: CrewRoleId,
): void {
  if (!rc) return;
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

function roleProfile(
  ctx: StageContext,
  block: string,
  /**
   * Crew-level (moduleConfig['show-bible']) style-hint fallback for a knob
   * this role's OWN surface also exposes (editor cadence, critic strictness /
   * marketAware) — see resolveChannelCrew below. Spread FIRST so the role's
   * own explicit moduleConfig[block] (already frozen into ctx.params by
   * runPipeline's per-block merge, whether via explicit override or preset)
   * always wins; the show-bible value only fills a gap the role's own config
   * never touched. A channel with no saved moduleConfig['show-bible'] gets
   * `rc === null` upstream, so no fallback object is passed here at all —
   * behavior is byte-identical to before this function grew this parameter.
   */
  crewFallback?: Record<string, unknown>,
): ChannelProfile {
  return {
    pipeline: [{ block, params: { ...crewFallback, ...ctx.params } }],
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
    const rc = resolveChannelCrew(ctx, g, bible);
    logCrewDoctrineGap(ctx, rc, "director_brief", "director");
    // No equivalent knob on DIRECTOR_SURFACE for show-bible's directorStyle —
    // see resolveChannelCrew's doc comment. Nothing to thread here.
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
    const rc = resolveChannelCrew(ctx, g, bible);
    logCrewDoctrineGap(ctx, rc, "dp_brief", "cinematographer");
    // No equivalent knob on CINEMATOGRAPHER_SURFACE for a show-bible hint —
    // see resolveChannelCrew's doc comment. Nothing to thread here.
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
    const rc = resolveChannelCrew(ctx, g, bible);
    logCrewDoctrineGap(ctx, rc, "editor_brief", "editor");
    // show-bible's editorCadence (CREW_SURFACE) is an equivalent knob to
    // EDITOR_SURFACE's own `cadence` (both slow/measured/snappy/frenetic,
    // EDITOR_SURFACE additionally allows "still") — fill it in as a fallback
    // ONLY when this channel has never configured editor_brief's own cadence
    // (roleProfile spreads ctx.params last, so an explicit/preset editor_brief
    // config always wins). rc === null (no saved show-bible config, or a
    // resolution failure) means no fallback object at all — zero regression.
    const config = resolveEditorConfig(
      roleProfile(ctx, "editor_brief", rc ? { cadence: rc.editorCadence } : undefined),
    );
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
    const rc = resolveChannelCrew(ctx, g, bible);
    logCrewDoctrineGap(ctx, rc, "composer_brief", "composer");
    // No equivalent knob on COMPOSER_SURFACE (musicMood/duckDepth/loudness/
    // voiceFx) for any show-bible knob — see resolveChannelCrew's doc comment.
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
    const rc = resolveChannelCrew(ctx, g, bible);
    logCrewDoctrineGap(ctx, rc, "critic_spec", "critic");
    // show-bible's criticStrictness/marketAwareCritic (CREW_SURFACE) are
    // equivalent knobs to CRITIC_SURFACE's own strictness/marketAware (same
    // value domains) — fill them in as a fallback ONLY when this channel has
    // never configured critic_spec's own strictness/marketAware (roleProfile
    // spreads ctx.params last, so an explicit/preset critic_spec config always
    // wins). rc === null means no fallback object at all — zero regression.
    const config = resolveCriticConfig(
      roleProfile(
        ctx,
        "critic_spec",
        rc ? { strictness: rc.criticStrictness, marketAware: rc.marketAwareCritic } : undefined,
      ),
    );
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
