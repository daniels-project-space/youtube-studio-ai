import assert from "node:assert/strict";
import { assertAutomationModelAllowed } from "../automationModelPolicy";
import { generateFalNanoBananaProThumbnailWithReceipt } from "../falNanoBananaProThumbnail";
import { createHyperThumbnailClient } from "../hyperThumbnailClient";

async function main() {
  const env = { YOUTUBE_AUTOMATION_PRIVATE: "1" };
  assert.throws(() => assertAutomationModelAllowed("gemini-3-pro-image-preview", env), /disabled/);
  assert.throws(() => assertAutomationModelAllowed("fal-ai/nano-banana-pro", env), /disabled/);
  assert.doesNotThrow(() => assertAutomationModelAllowed("gemini-2.5-flash-image", env));
  assert.doesNotThrow(() => assertAutomationModelAllowed("gemini-3-pro-image", {}));
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  let calls = 0;
  const client = createHyperThumbnailClient({ baseUrl: "https://hrs.example", projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectToken: "fixture", outputBucket: "youtube-automation", outputPrefix: "projects/automation/",
    fetch: async () => { calls++; throw new Error("unexpected network"); } });
  await assert.rejects(client.submit({ candidateId: "c", videoId: "v", revision: 1, title: "t", hook: "h", heroSubject: "s", visualDirection: "d", referenceAssets: [] }), /disabled/);
  await assert.rejects(generateFalNanoBananaProThumbnailWithReceipt({ prompt: "fixture", idempotencyContext: "fixture" }), /disabled/);
  assert.equal(calls, 0);
  console.log("Private Automation blocks Nano Banana Pro before provider calls");
}
void main();
