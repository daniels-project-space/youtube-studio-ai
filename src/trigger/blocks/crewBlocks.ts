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
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ShowBible, StyleDNA } from "@/engine/creative/types";
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
    return {
      bible: identity?.creativeBrief ?? null,
      dna: storeDna ?? ((channel as { styleDNA?: StyleDNA } | null)?.styleDNA ?? null),
      channelName: channel?.name,
      niche: identity?.niche,
      persona: identity?.persona,
      styleGrammar: identity?.styleGrammar,
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

function crewCtx(ctx: StageContext, g: ChannelGrounding): CrewContext {
  return {
    topic: topicOf(ctx),
    family: (ctx.params["family"] as string | undefined) ?? "narrated_stock",
    niche: (ctx.store["niche"] as string | undefined) ?? g.niche,
    channelName: (ctx.store["channelName"] as string | undefined) ?? g.channelName,
    targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined,
    dnaDigest: dnaDigest(g.dna),
    dnaAudio: dnaAudioDigest(g.dna),
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
    const out = await briefDirector(bible, crewCtx(ctx, g));
    if (!out) failLoud("director_brief");
    ctx.log(`director_brief: ${out.beats.length} beats`);
    return { structure: out };
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
    const out = await briefCinematographer(bible, crewCtx(ctx, g));
    if (!out) failLoud("dp_brief");
    ctx.log(`dp_brief: ${out.footageQueries.length} queries`);
    return { visualBrief: out };
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
    const out = await briefEditor(bible, crewCtx(ctx, g));
    if (!out) failLoud("editor_brief");
    ctx.log(`editor_brief: ${out.sections.length} sections`);
    return { cutSheet: out };
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
    const out = await briefComposer(bible, crewCtx(ctx, g));
    if (!out) failLoud("composer_brief");
    ctx.log(`composer_brief: music prompt set`);
    return { musicBrief: out };
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
    const out = await briefCritic(bible, crewCtx(ctx, g));
    if (!out) failLoud("critic_spec");
    ctx.log(`critic_spec: ${out.assertions.length} assertions`);
    return { validationSpec: out };
  },
};

export const CREW_BLOCKS: Block[] = [
  directorBriefBlock,
  dpBriefBlock,
  editorBriefBlock,
  composerBriefBlock,
  criticSpecBlock,
];
