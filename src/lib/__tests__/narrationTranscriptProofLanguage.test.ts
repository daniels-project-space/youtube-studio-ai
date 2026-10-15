import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { narrationTranscriptProofLanguagePreflightIssue } from "@/lib/narrationTranscriptProof";

const issue = (
  entries: Array<{ block: string; params?: unknown }>,
  inheritedLanguage?: unknown,
  channelLanguage?: unknown,
) => narrationTranscriptProofLanguagePreflightIssue({ entries, inheritedLanguage, channelLanguage });

assert.equal(issue([{ block: "script_gen", params: { language: "fr" } }]), undefined,
  "pipelines without final-master narration proof are outside this restriction");
assert.equal(issue([
  { block: "script_gen", params: { language: "English" } },
  { block: "narration_tts", params: { locale: "en-US" } },
  { block: "qa_visual" },
]), undefined);
assert.equal(issue([{ block: "qa_visual" }]), undefined,
  "the existing English default remains admitted");
assert.equal(issue([{ block: "qa_visual" }], undefined, "en"), undefined,
  "an English channel language agrees with the existing default");

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
  issue([{ block: "qa_visual" }], undefined, "fr") ?? "",
  /English only.*requested fr.*held before provider work/,
  "a non-English channel must not bypass the gate when module language params are omitted",
);
assert.match(
  issue([
    { block: "script_gen", params: { language: "en" } },
    { block: "narration_tts", params: { language: "en" } },
    { block: "qa_visual" },
  ], undefined, "fr") ?? "",
  /languages disagree/,
  "the frozen channel language must agree with explicit module languages",
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
assert.match(triggerSource, /channelLanguage: channel\.language/,
  "fresh invocation snapshots must freeze channel language instead of rereading it on retries");
assert.match(triggerSource, /channelLanguage: invocationCandidate\.seedStore\["channelLanguage"\]/,
  "the production guard must inspect the frozen channel language");

console.log("narration transcript proof language admission: ok");
