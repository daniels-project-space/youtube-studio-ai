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

  await assert.rejects(
    generateI2V({
      provider: "openrelay-h3",
      prompt: "A restrained cinematic motion study.",
      imageUrl: "https://example.test/first.png",
      maxCostUsd: 1,
    }),
    /requires one existing R2 first-frame key/i,
    "the opt-in H3 route must reject an unowned remote URL before it can wake the A100",
  );

  await assert.rejects(
    generateI2V({
      provider: "openrelay-h3",
      prompt: "A restrained cinematic motion study.",
      imageKey: "owners/o/channels/c/start.png",
      endImageKey: "owners/o/channels/c/end.png",
      maxCostUsd: 1,
    }),
    /unsupported LTX controls/i,
    "the opt-in H3 route must reject controls its exact Turbo8 receipt cannot attest",
  );

  console.log("I2V endpoint contract tests passed");
}

void main();
