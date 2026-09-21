import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../musicBlocks.ts", import.meta.url), "utf8");
const start = source.indexOf("export const music: Block =");
assert.ok(start >= 0, "shared music must own the executable block");
const music = source.slice(start);

const prepared = music.indexOf('const preparedMusic = ctx.store["preparedMusic"]');
const providerPrompt = music.indexOf("const providerPrompt = provider === \"minimax_music3\"");

assert.ok(prepared >= 0, "music must recognize the runner-admitted prepared weekly receipt");
assert.ok(
  providerPrompt > prepared,
  "a verified prepared music master must be consumed before provider generation is considered",
);
for (const required of [
  "preparedMusic.provider !== preparedProgram.generation.providerPreference",
  "getObjectBytes(preparedMusic.musicKey, undefined,",
  "sha256BytesHex(masterBytes)",
  "preparedMusic.musicDurationSec",
  "assertPinnedMiniMaxMusic3Receipt(runtimeReceipt, channelMusicProgram)",
  "assertMusicProgramQualityReceipt({ program: channelMusicProgram, receipt: qualityReceipt })",
  "assertMusicAuditionNativeBytes({ expected: runtime.output, bytes: nativeWavBytes })",
  "musicQualityReceiptKey",
  "no music-generation spend",
] as const) {
  assert.ok(music.includes(required), `prepared music must retain ${required}`);
}

console.log("prepared weekly music reuse wiring passed");
