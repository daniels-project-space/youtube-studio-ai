import type { PlanWeekPreparationManifest } from "./planWeekPreparationContract";
import { DELIVERY_METADATA_VERSION, MetadataDeliverySchema } from "./metadataDelivery";

/** New weekly still plans explicitly select HRS; existing explicit pins remain unchanged. */
export function projectWeeklyHrsImagePipeline(pipeline: PlanWeekPreparationManifest["execution"]["pipeline"]) {
  return pipeline.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record=entry as {block?:unknown;version?:unknown};
    return record.block === "novita_render_images" && record.version === undefined
      ? {...record,version:"2.0.0-hrs-ernie"} : entry;
  });
}

/** Prepared producers remain unversioned; downstream metadata executes in the runner. */
export function assertWeeklyPreparationVersionsSupported(
  pipeline: PlanWeekPreparationManifest["execution"]["pipeline"],
  context: string,
): void {
  // These versions execute in the scheduled runner, not in any of the
  // unversioned weekly producers. Preserve their frozen pins and audition gate.
  const yueVersions: Record<string, readonly string[]> = {
    composer_brief: ["3.0.0-yue2-score"],
    music: ["4.0.0-yue2-hrs"],
    timeline_assemble: ["3.0.0-yue2-reviewed-loop", "3.1.0-yue2-reviewed-once"],
    assemble: ["3.0.0-yue2-reviewed-loop"],
    music_program_plan: ["2.1.0-yue2-frozen-identity"],
    scene_planner: ["3.0.0-bound-visual-plan"],
    keyframes: ["3.1.0-yue2-reviewed-motion"],
    loop_clips: ["2.1.0-yue2-reviewed-motion"],
  };
  const entries = pipeline.filter((entry): entry is {block?: unknown; version?: unknown} =>
    !!entry && typeof entry === "object" && !Array.isArray(entry));
  const yuePipeline = entries.some(entry => entry.block === "music" && entry.version === "4.0.0-yue2-hrs") &&
    entries.some(entry => entry.block === "music_arrangement_plan");
  const unsupported = pipeline.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as { block?: unknown; version?: unknown; params?: { targetDurationSec?: unknown } };
    if (candidate.version === undefined) return [];
    if (candidate.block === "novita_render_images" && candidate.version === "2.0.0-hrs-ernie") return [];
    if (yuePipeline && typeof candidate.block === "string" && typeof candidate.version === "string" &&
        yueVersions[candidate.block]?.includes(candidate.version)) return [];
    // No weekly producer substitutes for this downstream block. Its exact pin
    // and params remain in the frozen pipeline and its manifest fingerprint.
    if (candidate.block === "metadata" && candidate.version === DELIVERY_METADATA_VERSION &&
        MetadataDeliverySchema.safeParse({ basis: "planned", durationSec: candidate.params?.targetDurationSec }).success) return [];
    const block = typeof candidate.block === "string" ? candidate.block : "<unknown block>";
    return [`${block}@${JSON.stringify(candidate.version)} (entry ${index})`];
  });
  if (unsupported.length) {
    throw new Error(
      `${context}: unsupported explicit weekly preparation implementation versions: ${unsupported.join(", ")}. ` +
      "Versioned weekly runtimes are not qualified; refusing prepared reuse and generation without fallback.",
    );
  }
}
