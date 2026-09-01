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
  panel,
  /aria-label="MiniMax-Music3 attribution and generation disclosure"[\s\S]*Music generated with MiniMax-Music3/u,
  "the selected provider must display prominent in-product attribution and disclosure",
);

console.log("MINIMAX MUSIC3 RELEASE WIRING PASS: UI attribution and full/Short package disclosure are receipt-gated");
