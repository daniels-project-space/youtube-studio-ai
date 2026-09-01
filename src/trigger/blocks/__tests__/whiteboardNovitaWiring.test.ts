import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const block = source("src/trigger/blocks/whiteboardScribeBlocks.ts");
const sync = source("src/lib/whiteboardSync.ts");
const contract = source("src/engine/moduleContracts.ts");
const banana = source("src/lib/banana.ts");

assert.match(
  block,
  /renderAttestedNovitaImageBytes\s*\(\{/,
  "Whiteboard must invoke the byte-returning attested Novita adapter",
);
assert.match(
  block,
  /hasNovitaRenderFarmConfig\s*\(\)/,
  "Whiteboard must fail before planning/rendering when its Novita capability is unavailable",
);
assert.match(
  block,
  /lifecycle:\s*\{[\s\S]{0,300}ownerId:\s*ctx\.ownerId[\s\S]{0,300}blockId:\s*"whiteboard_scribe"/,
  "every Whiteboard image worker must be bound to the durable run lifecycle",
);
assert.match(
  block,
  /maxCostUsd:\s*PRICE\.novitaImageMaxUsd/,
  "each Whiteboard image worker must retain its explicit one-worker ceiling",
);
assert.doesNotMatch(
  block,
  /generateNanoBanana|FAL_KEY|fal\.run/,
  "Whiteboard renderer art must not retain Nano Banana or FAL routes",
);
assert.doesNotMatch(
  banana,
  /WhiteboardArt|whiteboard art|generateNanoBananaProWhiteboard/,
  "the thumbnail-only Nano adapter must not own Whiteboard renderer art",
);
assert.match(
  block,
  /ttsProvider:\s*usesElevenLabsVoice\s*\?\s*"elevenlabs"\s*:\s*"fish"/,
  "Whiteboard capability admission must check the exact selected narration provider",
);
assert.match(
  sync,
  /ELEVENLABS_API_KEY missing for the selected ElevenLabs voice/,
  "a selected ElevenLabs voice must fail closed on its own missing credential",
);
assert.match(
  block,
  /providerModel:\s*art\.receipt\.model/,
  "persisted Whiteboard art must retain its exact provider model receipt",
);
assert.match(
  block,
  /providerReceiptKey:\s*receiptKey/,
  "persisted Whiteboard art must retain a durable receipt sidecar",
);
assert.match(
  sync,
  /cached \$\{fn\} has no attested provider receipt/,
  "a legacy or incomplete art cache must fail closed instead of being reused",
);
assert.match(
  sync,
  /assertAttestedWhiteboardArtReceipt\(/,
  "Whiteboard must byte-bind local art to its provider receipt before render",
);
assert.match(
  contract,
  /whiteboardImageCallCeiling\(panels\) \* PRICE\.novitaImageMaxUsd/,
  "compiler admission must reserve every possible direct image worker",
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
  "final loudness normalization must remain enforced",
);

console.log("WHITEBOARD ATTESTED NOVITA WIRING PASS");
