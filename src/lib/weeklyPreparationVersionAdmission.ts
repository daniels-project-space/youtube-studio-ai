import type { PlanWeekPreparationManifest } from "./planWeekPreparationContract";
import { DELIVERY_METADATA_VERSION, MetadataDeliverySchema } from "./metadataDelivery";
import { COMPOSER_MIX_ASSEMBLY_VERSION } from "@/engine/composerMixPipelineSelection";
import { CHANNEL_AWARE_SCRIPT_QA_VERSION } from "@/engine/channelAwareScriptQaSelection";

/** Prepared producers remain unversioned; only exact, preserved downstream pins are admitted. */
export function assertWeeklyPreparationVersionsSupported(
  pipeline: PlanWeekPreparationManifest["execution"]["pipeline"],
  context: string,
): void {
  const unsupported = pipeline.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as { block?: unknown; version?: unknown; params?: { targetDurationSec?: unknown } };
    if (candidate.version === undefined) return [];
    // No weekly producer substitutes for this downstream block. Its exact pin
    // and params remain in the frozen pipeline and its manifest fingerprint.
    if (candidate.block === "metadata" && candidate.version === DELIVERY_METADATA_VERSION &&
        MetadataDeliverySchema.safeParse({ basis: "planned", durationSec: candidate.params?.targetDurationSec }).success) return [];
    // Week-ahead preparation does not execute assembly, but the final run must
    // retain the exact mix ABI that will consume the prepared media. The pin is
    // preserved in the frozen manifest and covered by its content fingerprint.
    if (candidate.block === "timeline_assemble" && candidate.version === COMPOSER_MIX_ASSEMBLY_VERSION) return [];
    // Weekly narration preparation runs the exact frozen script reviewer before
    // TTS, so this pin is admitted only when it names that executable contract.
    if (candidate.block === "qa_script" && candidate.version === CHANNEL_AWARE_SCRIPT_QA_VERSION) return [];
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
