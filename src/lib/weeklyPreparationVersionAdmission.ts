import type { PlanWeekPreparationManifest } from "./planWeekPreparationContract";
import { DELIVERY_METADATA_VERSION, MetadataDeliverySchema } from "./metadataDelivery";

/** Prepared producers remain unversioned; downstream metadata executes in the runner. */
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
