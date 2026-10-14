import assert from "node:assert/strict";
import type { StageContext } from "@/engine/types";
import { createCaptionsBlock } from "../narratedBlocks";

const base: StageContext = {
  ownerId: "captions-owner",
  channelId: "captions-channel",
  runId: "captions-run",
  keyPrefix: "owner/captions-owner/channel/captions-channel/",
  budgetUsd: 1,
  params: {},
  log: () => {},
  store: { narrationDurationSec: 4, videoDurationSec: 6 },
};

async function main() {
  let writes = 0;
  const block = createCaptionsBlock(async () => {
    writes++;
    throw new Error("synthetic object-store outage");
  });

  const chaptersOnly = await block.run(base);
  assert.equal(chaptersOnly.captionsKey, "");
  assert.equal(writes, 0, "missing timings keeps the explicit chapters-only path");

  await assert.rejects(block.run({ ...base, store: {
    ...base.store,
    sentenceTimings: [{ text: "A tested caption.", start: 0, end: 1.2 }],
  } }), /synthetic object-store outage/);
  assert.equal(writes, 1, "a timed caption artifact cannot report success when persistence fails");

  console.log("CAPTIONS ARTIFACT FAILURE PASS: missing timings remain chapters-only; timed SRT persistence failures propagate");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
