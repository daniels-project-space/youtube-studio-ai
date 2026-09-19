import type { ResolvedPipeline } from "./validate";

/** Reject a changed selection before compilation, resume reads or execution. */
export function assertExecutableSelection(resolved: ResolvedPipeline): void {
  if (resolved.entries.length !== resolved.manifests.length ||
      resolved.entries.length !== resolved.blocks.length) {
    throw new Error("resolved pipeline lost its executable manifest alignment");
  }
  for (let index = 0; index < resolved.entries.length; index += 1) {
    const entry = resolved.entries[index];
    const manifest = resolved.manifests[index];
    const block = resolved.blocks[index];
    if (entry.block !== manifest.id || block !== manifest.block || block.id !== manifest.id ||
        block.run !== manifest.execute) {
      throw new Error(`resolved executable mismatch at step ${index}`);
    }
    if (entry.version !== undefined && entry.version !== manifest.version) {
      throw new Error(`resolved executable version mismatch for ${entry.block}: requested ${entry.version}, resolved ${manifest.version}`);
    }
  }
}
