import type { PipelineEntry } from "@/engine/types";

/**
 * A frozen invocation cannot be rewritten safely: changing it would sever the
 * persisted invocation fingerprint. This is therefore a pre-spend admission
 * guard rather than a compiler completion helper. It prevents historical
 * upload pipelines from rendering a master that final editorial acceptance
 * will later reject because its audio-aesthetics evaluator was omitted.
 */
export function assertFrozenUploadQaEvidence(entries: readonly PipelineEntry[]): void {
  const uploadIndex = entries.findIndex((entry) => entry.block === "upload_draft");
  if (uploadIndex < 0) return;

  const qaIndexes = entries
    .map((entry, index) => entry.block === "qa_visual" ? index : -1)
    .filter((index) => index >= 0);
  if (qaIndexes.length !== 1) {
    throw new Error(
      "frozen upload invocation requires exactly one production qa_visual stage; requeue a fresh run so current quality policy can be applied",
    );
  }

  const qaIndex = qaIndexes[0];
  const qa = entries[qaIndex];
  if (qaIndex > uploadIndex || qa.params?.["qaProfile"] !== "production") {
    throw new Error(
      "frozen upload invocation lacks a production qa_visual gate; requeue a fresh run so current quality policy can be applied",
    );
  }
  if (qa.params?.["audioQa"] !== true) {
    throw new Error(
      "frozen upload invocation lacks mandatory final-master audio-aesthetics QA; requeue a fresh run before any provider work",
    );
  }
}
