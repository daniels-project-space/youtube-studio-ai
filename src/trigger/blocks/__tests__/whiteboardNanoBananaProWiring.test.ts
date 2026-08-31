import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const block = source("src/trigger/blocks/whiteboardScribeBlocks.ts");
const sync = source("src/lib/whiteboardSync.ts");
const contract = source("src/engine/moduleContracts.ts");
const banana = source("src/lib/banana.ts");
const whiteboardAdapter = banana.slice(
  banana.indexOf("export async function generateNanoBananaProWhiteboardArtWithReceipt"),
  banana.indexOf("export async function generateBananaImage"),
);

assert.match(
  block,
  /generateNanoBananaProWhiteboardArtWithReceipt\s*\(/,
  "Whiteboard must invoke its sealed Nano Banana Pro art adapter",
);
assert.match(
  whiteboardAdapter,
  /https:\/\/fal\.run\/\$\{profile\.model\}/,
  "Nano Banana Pro must submit through Fal rather than a direct Google endpoint",
);
assert.match(
  whiteboardAdapter,
  /Authorization:\s*`Key \$\{process\.env\.FAL_KEY\}`/,
  "Nano Banana Pro must use the sealed FAL_KEY boundary",
);
assert.doesNotMatch(
  whiteboardAdapter,
  /generateGeminiImage|generativelanguage\.googleapis\.com|GEMINI_API_KEY/,
  "Whiteboard Nano Banana Pro may never fall through to a direct Google-key path",
);
assert.match(
  block,
  /hasNanoBananaProWhiteboardArt\s*\(\)/,
  "Whiteboard must fail before planning/rendering when the Pro-art capability is unavailable",
);
assert.match(
  block,
  /ttsProvider:\s*usesElevenLabsVoice\s*\?\s*"elevenlabs"\s*:\s*"fish"/,
  "Whiteboard capability admission must check the exact selected narration provider",
);
assert.match(
  sync,
  /ELEVENLABS_API_KEY missing for the selected ElevenLabs voice/,
  "a selected ElevenLabs voice must fail closed on its own missing credential rather than an unrelated Fish key",
);
assert.doesNotMatch(
  block,
  /createAttestedNovitaImageGenerator/,
  "Whiteboard must not retain a direct-Novita illustration fallback",
);
assert.match(
  block,
  /providerModel:\s*art\.receipt\.model/,
  "every persisted Whiteboard art asset must retain its exact provider model receipt",
);
assert.match(
  block,
  /providerReceiptKey:\s*receiptKey/,
  "every persisted Whiteboard art asset must retain a durable receipt sidecar",
);
assert.match(
  sync,
  /cached .*Nano Banana Pro receipt|cached \$\{fn\} has no Nano Banana Pro receipt/,
  "a legacy or incomplete art cache must fail closed instead of being reused",
);
assert.match(
  sync,
  /assertNanoBananaProWhiteboardArtReceipt\(/,
  "Whiteboard must byte-bind local art to its Nano Banana Pro receipt before render",
);
assert.match(
  contract,
  /NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE\.admissionCeilingUsd/,
  "compiler admission must reserve the Pro-art envelope rather than a generic image price",
);
assert.doesNotMatch(
  contract.slice(contract.indexOf("function whiteboardCostCeiling"), contract.indexOf("function loreShortCostCeiling")),
  /novitaImageMaxUsd/,
  "Whiteboard cost admission must not price Nano Banana Pro art as Novita workers",
);
assert.match(
  block,
  /required approved music bed could not be muxed into the final master/,
  "a Whiteboard episode with an approved upstream music bed must fail rather than ship narration-only",
);
assert.doesNotMatch(
  block,
  /keeping narration-only video|loudnorm skipped \(non-fatal\)/,
  "Whiteboard cannot silently omit its approved bed or final loudness normalization",
);
assert.match(
  block,
  /await normalizeAudioOnly\(finalPath, norm, -14\)/,
  "final loudness normalization must remain an enforced final-master step",
);

console.log("WHITEBOARD NANO BANANA PRO WIRING PASS");
