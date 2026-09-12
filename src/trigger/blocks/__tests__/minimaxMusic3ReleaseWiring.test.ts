import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const lofi = readFileSync(join(root, "src/trigger/blocks/lofiBlocks.ts"), "utf8");
const panel = readFileSync(join(root, "src/components/ModuleConfigPanel.tsx"), "utf8");

assert.match(
  lofi,
  /description\s*=\s*await appendMusicGenerationDisclosure\(ctx, description\)/u,
  "the full YouTube package must append disclosure at the last upload boundary",
);
assert.match(
  lofi,
  /const desc = await appendMusicGenerationDisclosure\(/u,
  "the derived Short must retain the same generated-audio disclosure",
);
assert.match(
  lofi,
  /getObjectBytes\(programKey\)[\s\S]*getObjectBytes\(receiptKey\)[\s\S]*assertPinnedMiniMaxMusic3Receipt\(receipt, program\)/u,
  "disclosure authority must come from durable program and runtime receipts",
);
assert.match(
  lofi,
  /Music generated with MiniMax-Music3\. This video contains AI-generated audio\./u,
);
assert.match(
  lofi,
  /musicNativeWavKey\s*=\s*`\$\{ctx\.keyPrefix\}runs\/\$\{ctx\.runId\}\/audio\/minimax-music3-native-\$\{result\.receipt\.output\.contentSha256\}\.wav`/u,
  "the retained owner-audition source must be content-addressed by the already verified native WAV digest",
);
assert.match(
  lofi,
  /await putObject\(musicNativeWavKey, result\.audio, \{ contentType: "audio\/wav" \}\)/u,
  "the exact verified worker WAV must be durably retained before mastering changes it",
);
assert.match(
  lofi,
  /recordAsset\(ctx, "minimax_music3_native_wav", musicNativeWavKey,[\s\S]*?reviewBinding: "native-worker-wav"/u,
  "the immutable native audit asset must be explicitly distinguished from the mastered MP3",
);
assert.match(
  lofi,
  /musicRuntimeReceiptKey,[\s\S]*?musicNativeWavKey,[\s\S]*?musicQualityReviewStatus/u,
  "the durable stage handoff must expose the native WAV locator to the later owner-review checkpoint",
);
assert.match(
  panel,
  /aria-label="MiniMax-Music3 attribution and generation disclosure"[\s\S]*Music generated with MiniMax-Music3/u,
  "the selected provider must display prominent in-product attribution and disclosure",
);

console.log("MINIMAX MUSIC3 RELEASE WIRING PASS: disclosure is receipt-gated and the exact native WAV is retained for owner audition");
