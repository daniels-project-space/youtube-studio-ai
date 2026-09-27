import assert from "node:assert/strict";

import { sweepR2AssetRetention } from "../../trigger/r2AssetRetentionSweeper";

const previousBinding = process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID;
const previousBucket = process.env.R2_BUCKET;

async function main() {
  try {
    delete process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID;
    // A missing binding must return before even validating or opening R2.
    process.env.R2_BUCKET = "travel-film-editor";
    assert.deepEqual(await sweepR2AssetRetention(), {
      scannedScopes: 0, expiredAssets: 0, expiredFinals: 0,
      expiredFootage: 0, deleted: 0, skippedScopes: 0,
    });
  } finally {
    if (previousBinding === undefined) delete process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID;
    else process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID = previousBinding;
    if (previousBucket === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = previousBucket;
  }
  console.log("R2 retention task skip tests passed");
}

void main();
