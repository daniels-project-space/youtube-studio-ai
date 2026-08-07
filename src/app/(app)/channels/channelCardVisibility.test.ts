import assert from "node:assert/strict";
import { channelsVisibleForFolder } from "./channelCardVisibility";

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

console.log("channel folder visibility tests passed");
