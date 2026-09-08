import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const source = await readFile(
    new URL("../../../scripts/refresh-channel-banners.ts", import.meta.url),
    "utf8",
  );
  const generation = source.slice(
    source.indexOf("async function generate"),
    source.indexOf("async function apply"),
  );

  assert.match(source, /channelArtIdentityFromSource/,
    "reviewed refreshes must use the same persisted Style DNA identity as new channels");
  assert.match(source, /generateChannelArtAsset/,
    "reviewed refreshes must retain the receipt-bound Nano Banana and visual-judge contract");
  assert.match(source, /readApproval\(newBannerKey, generated\.provenance\)/,
    "a staged candidate must carry the channel-art approval receipt");
  assert.match(source, /generateChannelArtAssetWithProvenance/,
    "generation must return the exact identity-bound proof rather than only an image key");
  assert.match(source, /provenance: row\.provenance!/,
    "reviewed apply must persist provenance beside the accepted banner key");
  assert.match(source, /--confirm-manifest-sha256=/,
    "the apply phase must bind the exact reviewed manifest");
  assert.match(source, /banner compare-and-swap failed/,
    "the apply phase must refuse to overwrite a banner changed after review");
  assert.match(source, /api\.channels\.applyChannelArtAsset/,
    "reviewed apply must atomically merge into the latest identity instead of replaying stale fields");
  assert.doesNotMatch(generation, /updateChannel/,
    "generation must never mutate the live channel before the separate reviewed apply phase");
  console.log("REVIEWED CHANNEL BANNER REFRESH PASS");
}

void main();
