import { z } from "zod";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { DELIVERY_METADATA_VERSION, MetadataDeliverySchema } from "@/lib/metadataDelivery";
import { createMetadataBlock } from "./intelligenceBlocks";

export function createDeliveryAwareMetadataManifest(source: ModuleManifest): ModuleManifest {
  if (source.id !== "metadata") throw new Error("Delivery-aware metadata requires the metadata owner");
  const block = createMetadataBlock(ctx => {
    const measured = ctx.store["videoDurationSec"];
    return MetadataDeliverySchema.parse(measured === undefined || measured === null
      ? { basis: "planned", durationSec: ctx.params.targetDurationSec }
      : { basis: "measured", durationSec: measured });
  });
  return { ...source, version: DELIVERY_METADATA_VERSION, block, execute: block.run,
    configSchema: source.configSchema.and(z.object({ targetDurationSec: z.number().finite().positive().max(86400).optional() }).passthrough()),
    certification: { status: "contract", evidence: "Separates final delivery timing from source media and validates music runtime labels; not production qualification." } };
}
