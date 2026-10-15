import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { narrationTranscriptProofLanguagePreflightIssue } from "@/lib/narrationTranscriptProof";

const issue = (entries: Array<{ block: string; params?: unknown }>, inheritedLanguage?: unknown) =>
  narrationTranscriptProofLanguagePreflightIssue({ entries, inheritedLanguage });

assert.equal(issue([{ block: "script_gen", params: { language: "fr" } }]), undefined,
  "pipelines without final-master narration proof are outside this restriction");
assert.equal(issue([
  { block: "script_gen", params: { language: "English" } },
  { block: "narration_tts", params: { locale: "en-US" } },
  { block: "qa_visual" },
]), undefined);
assert.equal(issue([{ block: "qa_visual" }]), undefined,
  "the existing English default remains admitted");

for (const language of ["fr", "zh-CN", "ja", "Auto"]) {
  assert.match(
    issue([
      { block: "script_gen", params: { language } },
      { block: "narration_tts", params: { language } },
      { block: "qa_visual" },
    ]) ?? "",
    /English only.*no qualified transcript-proof route.*held before provider work/,
    `${language} must be held before any sibling stage spends`,
  );
}

assert.match(
  issue([
    { block: "script_gen", params: { language: "en" } },
    { block: "narration_tts", params: { language: "es" } },
    { block: "qa_visual" },
  ]) ?? "",
  /languages disagree/,
  "script and narration modules must agree on the sealed language",
);
assert.match(
  issue([
    { block: "script_gen", params: { language: "en" } },
    { block: "narration_tts", params: { language: "en" } },
    { block: "qa_visual" },
  ], "ja") ?? "",
  /languages disagree/,
  "a language-sibling target cannot disagree with the frozen module plan",
);
assert.match(
  issue([{ block: "narration_tts", params: { language: 42 } }, { block: "qa_visual" }]) ?? "",
  /must be a string/,
);
assert.match(issue([{ block: "qa_visual" }], 42) ?? "", /render-group narration language must be a string/);

const triggerSource = readFileSync(
  fileURLToPath(new URL("../../trigger/runPipeline.ts", import.meta.url)),
  "utf8",
);
const admission = triggerSource.indexOf("narrationTranscriptProofLanguagePreflightIssue({");
assert.ok(admission >= 0, "the production Trigger caller must invoke the language admission gate");
assert.ok(admission < triggerSource.indexOf("claimInvocationSnapshot"),
  "unsupported language must stop before the durable invocation/provider-admission handoff");

console.log("narration transcript proof language admission: ok");
