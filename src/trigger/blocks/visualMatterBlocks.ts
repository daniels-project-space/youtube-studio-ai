import { VisualMatterManifestSchema, planVisualMatter } from "@/engine/visualMatter";
import { studioAssetRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { planVisualTreatment, visualTreatmentKeyFromUnknown } from "@/engine/visualTreatmentCatalog";
import { COST_PATCH_KEY, type Block } from "@/engine/types";

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, safe));
}

/**
 * Builds a reusable, provider-free Visual Matter package for a cinematic story.
 * The typed lock is consumed downstream; rendering non-thumbnail reference
 * pixels remains deliberately unavailable until an approved adapter exists.
 */
export const VISUAL_MATTER_REFERENCE_ADAPTER_REQUIRED =
  "visual_matter cannot render non-thumbnail reference assets: FAL/Nano Banana is thumbnail-only. " +
  "Use planning-only Visual Matter, or configure an approved direct-Novita/licensed-source reference adapter.";

const visualMatter: Block = {
  id: "visual_matter",
  consumes: ["topic", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs", "studioAssetRecipeProjection"],
  produces: ["visualMatterManifest"],
  paid: false,
  run: async (ctx) => {
    const rawTreatment = ctx.params["visualTreatment"];
    const treatmentKey = rawTreatment === undefined ? undefined : visualTreatmentKeyFromUnknown(rawTreatment);
    if (rawTreatment !== undefined && !treatmentKey) {
      throw new Error("visual_matter received an unknown visual treatment; treatment selection must be explicit and catalog-backed");
    }
    const visualTreatment = treatmentKey ? planVisualTreatment(treatmentKey) : undefined;
    const manifest = planVisualMatter({
      topic: String(ctx.store["topic"]),
      channelName: typeof ctx.store["channelName"] === "string" ? ctx.store["channelName"] : undefined,
      styleDNA: (ctx.store["styleDNA"] as Record<string, unknown> | null | undefined) ?? null,
      visualBrief: (ctx.store["visualBrief"] as Record<string, unknown> | null | undefined) ?? null,
      continuityLedger: ctx.store["continuityLedger"],
      narrativeBeats: ctx.store["narrativeBeats"],
      shotList: ctx.store["shotList"],
      dpVisualSpecs: ctx.store["dpVisualSpecs"],
      studioAssetRecipeProjection: studioAssetRecipeProjectionFromUnknown(ctx.store["studioAssetRecipeProjection"]),
      ...(visualTreatment ? { visualTreatment } : {}),
      maxCharacters: boundedInteger(ctx.params["maxCharacters"], 3, 0, 6),
      maxSettings: boundedInteger(ctx.params["maxSettings"], 3, 0, 6),
    });
    if (ctx.params["enabled"] === false) {
      const disabled = VisualMatterManifestSchema.parse({ ...manifest, status: "disabled" });
      ctx.log("visual_matter: disabled — emitted a typed no-op handoff; renderers will use their normal story spine");
      return { visualMatterManifest: disabled, [COST_PATCH_KEY]: 0 };
    }

    // Historical snapshots can still carry the old paid parameter. Reject it
    // before any provider or storage boundary rather than silently downgrading
    // quality or routing non-thumbnail imagery through the thumbnail provider.
    if (ctx.params["renderReferenceAssets"] === true) {
      throw new Error(VISUAL_MATTER_REFERENCE_ADAPTER_REQUIRED);
    }

    ctx.log(
      `visual_matter: planned ${manifest.characters.length} character, ${manifest.settings.length} setting, ` +
      `${manifest.storyboard.length} storyboard locks${visualTreatment ? ` with ${visualTreatment.label}` : ""} ` +
      `(planning-only; reference rendering disabled pending an approved adapter)`,
    );
    return { visualMatterManifest: manifest, [COST_PATCH_KEY]: 0 };
  },
};

export const VISUAL_MATTER_BLOCKS: Block[] = [visualMatter];
