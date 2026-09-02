import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /requireStudioActor\(request\)/,
    "paid artwork refresh must require the existing owner session");
  assert.match(source, /channelArtIdentityFromSource/,
    "refreshes must derive their world from the channel's frozen identity and Style DNA");
  assert.match(source, /generateChannelArtAsset/,
    "refreshes must use the receipt-bound Fal Nano Banana and visual-judge route");
  assert.match(source, /maxProviderSpendUsd: MAX_PROVIDER_SPEND_USD/,
    "the UI action must expose a bounded provider envelope");
  assert.match(source, /expectedBannerKey: requested\.expectedBannerKey/,
    "the final banner write must compare-and-swap the artwork revision");
  assert.match(source, /channel\.locked/,
    "locked channels must not spend on a banner refresh");
  console.log("channel-art refresh route contracts passed");
}

void main();
