import assert from "node:assert/strict";
import { generateI2V } from "@/lib/i2v";
import { renderNovitaI2V } from "@/lib/novitaMedia";

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
    renderNovitaI2V({
      prefix: "owners/o/channels/c",
      id: "endpoint-contract",
      prompt: "A restrained cinematic motion study.",
      imageKey: "owners/o/channels/c/start.png",
      endImageKey: "owners/o/channels/c/end.png",
      endImageUrl: "https://example.test/end.png",
      maxCostUsd: 1,
    }),
    /at most one of endImageKey or endImageUrl/,
    "the Novita boundary must fail before a direct GPU job when endpoint identity is ambiguous",
  );

  console.log("I2V endpoint contract tests passed");
}

void main();
