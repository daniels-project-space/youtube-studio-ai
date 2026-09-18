import assert from "node:assert/strict";
import { generateI2V } from "@/lib/i2v";

async function main(): Promise<void> {
  await assert.rejects(
    generateI2V({
      prompt: "A restrained cinematic motion study.",
      imageKey: "owners/o/channels/c/start.png",
      endImageKey: "owners/o/channels/c/end.png",
      endImageUrl: "https://example.test/end.png",
      maxCostUsd: 1,
    }),
    /only one of endImageKey or endImageUrl/,
    "the generic I2V contract must reject an ambiguous terminal reference before any worker admission",
  );

  await assert.rejects(
    generateI2V({
      prompt: "A restrained cinematic motion study.",
      imageUrl: "https://example.test/start.png",
      maxCostUsd: 1,
    }),
    /requires an immutable R2 imageKey/i,
    "the H3 route must reject an unbound remote image before any worker admission",
  );

  await assert.rejects(
    generateI2V({
      prompt: "A restrained cinematic motion study.",
      imageKey: "owners/o/channels/c/start.png",
      provider: "novita-ltx",
      maxCostUsd: 1,
    }),
    /Novita MiniMax H3 is mandatory/i,
    "the retired provider alias must fail before any R2 or GPU work",
  );

  console.log("I2V endpoint contract tests passed");
}

void main();
