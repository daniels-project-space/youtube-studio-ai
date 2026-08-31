import assert from "node:assert/strict";
import { assertFrozenUploadQaEvidence } from "@/engine/frozenPipelineQaAdmission";
import type { PipelineEntry } from "@/engine/types";

const production: PipelineEntry[] = [
  { block: "whiteboard_scribe" },
  { block: "thumbnail_gen" },
  { block: "qa_visual", params: { qaProfile: "production", audioQa: true } },
  { block: "upload_draft" },
];

assert.doesNotThrow(() => assertFrozenUploadQaEvidence(production));
assert.throws(
  () => assertFrozenUploadQaEvidence(production.map((entry) =>
    entry.block === "qa_visual" ? { ...entry, params: { qaProfile: "production" } } : entry,
  )),
  /mandatory final-master audio-aesthetics QA/,
  "a frozen loudness-only snapshot must be rejected before render",
);
assert.throws(
  () => assertFrozenUploadQaEvidence(production.map((entry) =>
    entry.block === "qa_visual" ? { ...entry, params: { qaProfile: "draft", audioQa: true } } : entry,
  )),
  /lacks a production qa_visual gate/,
);
assert.throws(
  () => assertFrozenUploadQaEvidence(production.filter((entry) => entry.block !== "qa_visual")),
  /requires exactly one production qa_visual stage/,
);
assert.doesNotThrow(
  () => assertFrozenUploadQaEvidence([{ block: "whiteboard_scribe" }]),
  "private/probe invocations without upload_draft have no publication QA obligation",
);

console.log("FROZEN PIPELINE QA ADMISSION PASS");
