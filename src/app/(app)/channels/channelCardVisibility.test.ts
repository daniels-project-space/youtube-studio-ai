import assert from "node:assert/strict";
import {
  CHANNEL_PAGE_SIZE,
  channelsVisibleForFolder,
  isMainFleetChannel,
  pageChannels,
} from "./channelCardVisibility";

const channels = [
  { id: "unfiled", folder: undefined },
  { id: "stoic-en", folder: "Stoic Truths Multi", groupId: "stoic-group" },
  { id: "stoic-de", folder: "Stoic Truths Multi", groupId: "stoic-group" },
  { id: "legacy-group", folder: undefined, groupId: "recoverable-group" },
  { id: "stale", folder: "Removed folder" },
];

assert.deepEqual(
  channelsVisibleForFolder(channels, null).map((channel) => channel.id),
  ["unfiled", "legacy-group", "stale"],
  "the default fleet view must omit multi-language members already in a room while retaining reachable standalone, legacy, and stale-folder rows",
);
assert.deepEqual(
  channelsVisibleForFolder(channels, "Stoic Truths Multi").map((channel) => channel.id),
  ["stoic-en", "stoic-de"],
  "an open folder is an explicit filter",
);
assert.deepEqual(channelsVisibleForFolder(channels, "Empty"), []);
assert.equal(isMainFleetChannel(channels[3]), true,
  "an incomplete legacy grouping must remain reachable from the main fleet");

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
