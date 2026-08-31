import assert from "node:assert/strict";
import {
  CHANNEL_PAGE_SIZE,
  channelsVisibleForFolder,
  pageChannels,
} from "./channelCardVisibility";

const channels = [
  { id: "unfiled", folder: undefined },
  { id: "stoic-en", folder: "Stoic Truths Multi" },
  { id: "stoic-de", folder: "Stoic Truths Multi" },
  { id: "stale", folder: "Removed folder" },
];

assert.deepEqual(
  channelsVisibleForFolder(channels, null).map((channel) => channel.id),
  ["unfiled", "stoic-en", "stoic-de", "stale"],
  "the default fleet view must show every channel, including foldered and stale-folder rows",
);
assert.deepEqual(
  channelsVisibleForFolder(channels, "Stoic Truths Multi").map((channel) => channel.id),
  ["stoic-en", "stoic-de"],
  "an open folder is an explicit filter",
);
assert.deepEqual(channelsVisibleForFolder(channels, "Empty"), []);

const fleet = Array.from({ length: 13 }, (_, index) => ({ id: `channel-${index + 1}` }));
const firstPage = pageChannels(fleet);
assert.deepEqual(firstPage.visible, fleet.slice(0, CHANNEL_PAGE_SIZE));
assert.equal(firstPage.total, 13);
assert.equal(firstPage.remaining, 5);
assert.equal(firstPage.nextBatchSize, 5);

const completeFleet = pageChannels(fleet, 16);
assert.deepEqual(completeFleet.visible, fleet);
assert.equal(completeFleet.remaining, 0);
assert.equal(completeFleet.nextBatchSize, 0);

console.log("channel folder visibility and paging tests passed");
