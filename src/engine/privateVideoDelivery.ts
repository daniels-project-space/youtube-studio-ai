import type { PipelineEntry } from "./types";

const DELIVERY_BLOCKS = new Set([
  "upload_draft", "notify", "cleanup", "shorts_spinoff", "crosspost", "emit_bundle",
]);

export function isPrivateVideoDeliveryBlock(block: string): boolean {
  return DELIVERY_BLOCKS.has(block);
}

export function assertPrivateVideoHasNoDelivery(entries: readonly PipelineEntry[]): void {
  const forbidden = entries.find(entry => isPrivateVideoDeliveryBlock(entry.block));
  if (forbidden) throw new Error(`Private video pipeline cannot contain delivery block "${forbidden.block}"`);
}
