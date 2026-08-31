import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";

registerAllBlocks();

const qa = getManifest("qa_visual");
const release = getManifest("quiz_short_release");
const upload = getManifest("upload_draft");
assert(qa && release && upload, "QuizShort requires registered final QA, private-release, and upload blocks");
assert("quizShortOpeningHook" in qa.optionalConsumes, "shared QA must declare the renderer-owned opening hook");
for (const key of [
  "quizPlan", "quizSafety", "quizRounds", "onScreenTextCues", "quizShortOpeningHook",
  "videoKey", "videoDurationSec", "qaReport", "contentLane", "channelProgramRoute",
  "finalMasterReleaseCertificateKey",
]) {
  assert(key in release.consumes, `QuizShort release must require ${key}`);
}
assert("quizShortRelease" in release.produces, "the release block must emit its durable private-review receipt");
assert(release.capabilities.includes("publish.private_only"), "the release block must activate the compiler private-only rail");
assert("quizShortRelease" in upload.optionalConsumes, "upload must declare its route-specific private receipt");
assert.equal(artifactContract("quizShortOpeningHook").opaque, false);
assert.equal(artifactContract("quizShortRelease").opaque, false);

const narrated = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const lofi = readFileSync(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8");
const quizShortRelease = readFileSync(join(process.cwd(), "src/trigger/blocks/quizShortReleaseBlocks.ts"), "utf8");
const designer = readFileSync(join(process.cwd(), "src/engine/designer.ts"), "utf8");
const executionCatalog = readFileSync(join(process.cwd(), "src/engine/goldenExecution.ts"), "utf8");

const routeGate = narrated.indexOf("const isSupervisedQuizShort");
const overlayGate = narrated.indexOf("id: quizShortOpeningHook.cueId");
const ocrProof = narrated.indexOf("let onScreenTextProof: OnScreenTextProof");
const openingEvidence = narrated.indexOf("const shortsOpeningEvidence = (() =>");
const certificate = narrated.indexOf("const persistedFinalMasterReleaseCertificate = createFinalMasterReleaseCertificate(");
assert(
  routeGate >= 0 && overlayGate > routeGate && ocrProof > overlayGate && openingEvidence > ocrProof && certificate > openingEvidence,
  "QuizShort must route-gate its hook, retain an overlay review frame, prove OCR, then seal opening evidence before the final certificate",
);
assert.match(
  narrated,
  /isSupervisedQuizShort && audioAestheticScore === undefined/,
  "portrait QuizShort must reject a loudness-only audio fallback",
);
assert.match(
  narrated.slice(openingEvidence, certificate + 4_000),
  /audioAxis\.score === undefined[\s\S]*?createShortsOpeningEvidence\([\s\S]*?source: "on_screen_hook"/,
  "portrait QuizShort must require measured scored audio QA and an on-screen—not narration-caption—opening proof",
);
assert.match(
  narrated.slice(certificate, certificate + 6_000),
  /\{ onScreenText: onScreenTextProof \}[\s\S]*?\{ shortsOpeningEvidence \}/,
  "the final certificate must persist both OCR and opening evidence rather than leave them as transient QA logs",
);
const uploadGate = lofi.indexOf("assertQuizShortReleaseReceiptForUpload(");
const connector = lofi.indexOf("requireYouTubeConnector(client");
assert(uploadGate >= 0 && connector > uploadGate, "QuizShort receipt must be rechecked before connector lookup or publication work");
assert.match(
  quizShortRelease,
  /publishMode[\s\S]*?QuizShort may only create a private draft/,
  "the upload boundary must independently reject public/scheduled QuizShort params",
);
assert.match(
  designer,
  /QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE[\s\S]*?minSeconds:\s*35[\s\S]*?maxSeconds:\s*60[\s\S]*?isSupervisedQuizShort && e\.block === "length_check"[\s\S]*?QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE\.minSeconds[\s\S]*?QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE\.maxSeconds/,
  "the supervised 35–60s portrait route must not inherit QuizYear's long-form check",
);
assert.match(
  executionCatalog,
  /"quiz-short-private-release"[\s\S]*?kind: "registered-private-release"[\s\S]*?"quiz_short_release"/,
  "the dormant local release check must stay catalog-owned as registered private-release infrastructure without making ordinary QuizYear active as a Short route",
);

console.log("QuizShort QA/certificate/private-release wiring tests passed");
