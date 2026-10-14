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
  assert.equal("captionsKey" in chaptersOnly, false);
  assert.equal(writes, 0, "missing timings keeps the explicit chapters-only path");

  await assert.rejects(block.run({ ...base, store: {
    ...base.store,
    sentenceTimings: [{ text: "A tested caption.", start: 0, end: 1.2 }],
  } }), /synthetic object-store outage/);
  assert.equal(writes, 1, "a timed caption artifact cannot report success when persistence fails");

  let writtenSrt = "";
  const aligned = createCaptionsBlock(async (_key, body) => {
    writtenSrt = Buffer.from(body as Uint8Array).toString("utf8");
    return "captions-test-etag";
  });
  const result = await aligned.run({ ...base, store: {
    ...base.store,
    narrationDurationSec: 80,
    videoDurationSec: 100,
    introApplied: true,
    introSec: 1.25,
    narrationStartSec: 12,
    script: { sections: [
      { heading: "First beat", text: "One two." },
      { heading: "Second beat", text: "Three four." },
    ] },
    sentenceTimings: [{ text: "A tested caption.", start: 0, end: 1.2 }],
  } });
  assert.match(writtenSrt, /00:00:12,000 --> 00:00:13,200/u,
    "captions must prefer the renderer-declared narration start over the intro-card duration");
  assert.match(String(result.chaptersText ?? ""), /0:12 First beat/u,
    "chapter times must use the same renderer-declared narration clock as SRT cues");

  console.log("CAPTIONS ARTIFACT AND CLOCK PASS: persistence failures propagate and SRT/chapters share the declared narration offset");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
