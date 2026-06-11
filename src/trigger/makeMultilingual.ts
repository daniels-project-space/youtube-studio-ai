/**
 * `make-multilingual` — clone a base channel into language siblings (DE, ES …)
 * that form a GROUP. Each sibling has the identical pipeline (locale-patched so it
 * renders in that language), shares the base AVATAR (profile image), and gets a new
 * banner with the country's flag in the background. Siblings start as drafts until
 * their YouTube channel is connected.
 *
 * Phase 1: siblings are fully-functional standalone localized channels. Phase 2
 * (render-group reuse) will let them reuse the base render instead of re-rendering.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { generateFlagBanner } from "@/lib/channelArt";
import { VOICE_BY_LANG } from "@/lib/voices";
import type { PipelineEntry } from "@/engine/types";

export interface MakeMultilingualArgs {
  ownerId?: string;
  channelId: string;
  /** Target language codes for the siblings (base stays as-is). */
  languages: string[];
}

const LANG_COUNTRY: Record<string, string> = {
  de: "Germany", es: "Spain", fr: "France", pt: "Portugal", it: "Italy", nl: "Netherlands",
};
const LANG_NAME: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese", it: "Italian", nl: "Dutch",
};

/** Patch the locale onto the language-bearing blocks (identical pipeline otherwise). */
function localizePipeline(pipeline: PipelineEntry[], lang: string): PipelineEntry[] {
  const LOCALE_BLOCKS = new Set(["script_gen", "narration_tts", "metadata"]);
  return pipeline.map((e) =>
    LOCALE_BLOCKS.has(e.block)
      ? { block: e.block, params: { ...(e.params ?? {}), language: lang } }
      : e,
  );
}

/** Ensure emit_bundle is in the base pipeline (before cleanup) so base runs fan out. */
function withEmitBundle(pipeline: PipelineEntry[]): PipelineEntry[] {
  if (pipeline.some((e) => e.block === "emit_bundle")) return pipeline;
  const at = pipeline.findIndex((e) => e.block === "cleanup");
  const entry: PipelineEntry = { block: "emit_bundle" };
  if (at >= 0) return [...pipeline.slice(0, at), entry, ...pipeline.slice(at)];
  return [...pipeline, entry];
}

export const makeMultilingualTask = task({
  id: "make-multilingual",
  maxDuration: 600,
  run: async (payload: MakeMultilingualArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[make-multilingual] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    const ownerId = payload.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const base = await convex.query(api.channels.getChannel, {
      channelId: payload.channelId as Id<"channels">,
    });
    if (!base) throw new Error("make-multilingual: base channel not found");

    const groupId = base.groupId ?? base._id;
    // Mark the base as the group's base + ensure emit_bundle is in its pipeline so
    // its runs persist the asset bundle and fan out to siblings (idempotent).
    const basePipeline = withEmitBundle((base.pipeline ?? []) as PipelineEntry[]);
    await convex.mutation(api.channels.updateChannel, {
      channelId: base._id,
      groupId,
      language: base.language ?? "en",
      groupRole: "base",
      pipeline: basePipeline,
    });

    // Which languages already exist in the group → skip them.
    const existing = await convex.query(api.channels.listGroup, { groupId });
    const haveLangs = new Set(existing.map((c) => c.language).filter(Boolean));

    const created: { language: string; slug: string; channelId: string }[] = [];
    for (const lang of payload.languages) {
      if (lang === (base.language ?? "en") || haveLangs.has(lang)) {
        log(`skip ${lang} (already in group)`);
        continue;
      }
      const country = LANG_COUNTRY[lang] ?? lang;
      const slug = `${base.slug}-${lang}`;
      const name = `${base.name} (${lang.toUpperCase()})`;

      // Banner with the country flag; reuse the base avatar (shared profile image).
      let bannerKey = base.identity?.bannerKey;
      try {
        bannerKey = await generateFlagBanner(
          ownerId, slug,
          { name: base.name, niche: base.identity?.niche, palette: base.identity?.palette,
            styleGrammar: base.identity?.styleGrammar, iconicMotif: base.identity?.creativeBrief?.iconicMotif },
          country, log,
        );
      } catch (e) { log(`flag banner failed for ${lang} (using base banner): ${e instanceof Error ? e.message : e}`); }

      const identity = {
        ...base.identity,
        imageKey: base.identity?.imageKey, // SHARE the base avatar
        bannerKey,
        voiceId: VOICE_BY_LANG[lang] ?? base.identity?.voiceId, // native per-language voice
      };
      const pipeline = localizePipeline(basePipeline, lang);

      const channelId = (await convex.mutation(api.channels.createChannel, {
        ownerId, slug, name,
        identity,
        thumbnailer: base.thumbnailer,
        template: base.template,
        pipeline,
        budget: base.budget,
        status: "draft", // until its YouTube channel is connected
        groupId,
        language: lang,
        groupRole: "sibling",
      })) as Id<"channels">;

      log(`created ${LANG_NAME[lang] ?? lang} sibling`, { slug, channelId });
      created.push({ language: lang, slug, channelId });
    }

    return { ok: true, groupId, base: base.slug, created };
  },
});
