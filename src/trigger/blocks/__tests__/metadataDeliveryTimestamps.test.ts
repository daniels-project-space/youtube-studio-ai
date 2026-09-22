import assert from "node:assert/strict";
import { finishMetadata } from "../intelligenceBlocks";
import type { StageContext } from "@/engine/types";
import type { MetadataDelivery } from "@/lib/metadataDelivery";

function finish(description: string, delivery?: MetadataDelivery, store: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const ctx: StageContext = { ownerId: "fixture", runId: "fixture", channelId: "fixture", keyPrefix: "fixture/",
    budgetUsd: 0, params: {}, store, log: message => { logs.push(message); } };
  const result = finishMetadata(ctx, {
    title: "Quiet coastal music", description, tags: ["music"], channelName: "Fixture channel",
    nicheIntel: null, delivery,
  });
  return { ...result, logs };
}

const measured = { basis: "measured", durationSec: 600 } as const;
assert.equal(finish("0:00 Opening\n01:30:00 Impossible chapter", measured, { videoDurationSec: 600 }).description, "0:00 Opening");
assert.equal(finish("The clock read 12:30 when the letter arrived.", measured, { videoDurationSec: 600 }).description,
  "The clock read 12:30 when the letter arrived.");
const planned = { basis: "planned", durationSec: 7200 } as const;
assert.equal(finish("0:00 Opening\n1:30:00 Quiet coast\n2:00:01 Too late", planned,
  { musicDurationSec: 30, loopSourceDurationSec: 142 }).description, "0:00 Opening\n1:30:00 Quiet coast");
for (const line of ["10:00 End boundary", "[10:01] Past end", "- 11:00 Past end", "* [01:00:00] Past end",
  "0:99 Invalid seconds", "1:60:00 Invalid minutes", "9000:00 Past end"]) {
  const output = finish(`0:00 Start\n${line}`, measured);
  assert.equal(output.description, "0:00 Start", line);
  assert.equal(output.logs.length, 1, "dropped timestamp must be observable");
}
assert.equal(finish("[9:59] Final interval", measured).description, "[9:59] Final interval");
assert.equal(finish("Calm sound", measured, { chaptersText: "0:00 Start\n01:00:00 Out of range" }).description,
  "Calm sound\n\nChapters:\n0:00 Start");
assert.equal(finish("0:00 Start\r\n11:00 Too late\r\nAn ordinary line.", measured).description,
  "0:00 Start\nAn ordinary line.");
assert.equal(finish("01:30:00 Legacy", undefined, { videoDurationSec: 600 }).description, "01:30:00 Legacy",
  "legacy finishing is unchanged");
console.log("DELIVERY TIMESTAMPS PASS: real finishing path, hours, minute labels, exact bounds, invalid units, prose, chapter handoff, natural source isolation, legacy parity.");
