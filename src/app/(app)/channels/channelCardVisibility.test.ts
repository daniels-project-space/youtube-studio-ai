import assert from "node:assert/strict";
import {
  CHANNEL_PAGE_SIZE,
  channelsVisibleForFolder,
  isMainFleetChannel,
  pageChannels,
} from "./channelCardVisibility";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const channels = [
  { id: "unfiled", folder: undefined },
  { id: "stoic-en", folder: "Stoic Truths Multi", groupId: "stoic-group" },
  { id: "stoic-de", folder: "Stoic Truths Multi", groupId: "stoic-group" },
  { id: "legacy-group", folder: undefined, groupId: "recoverable-group" },
  { id: "stale", folder: "Removed folder" },
];

assert.deepEqual(
  channelsVisibleForFolder(channels, null).map((channel) => channel.id),
  ["unfiled", "legacy-group"],
  "the default fleet view must omit every room member even when legacy group metadata is missing or stale",
);
assert.deepEqual(
  channelsVisibleForFolder(channels, "Stoic Truths Multi").map((channel) => channel.id),
  ["stoic-en", "stoic-de"],
  "an open folder is an explicit filter",
);
assert.deepEqual(channelsVisibleForFolder(channels, "Empty"), []);
assert.equal(isMainFleetChannel(channels[3]), true,
  "an incomplete legacy grouping must remain reachable from the main fleet");
assert.equal(isMainFleetChannel(channels[4]), false,
  "an assigned room, not a legacy group id, is the authoritative main-fleet boundary");

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

const channelsPageSource = readFileSync(resolve(process.cwd(), "src/app/(app)/channels/page.tsx"), "utf8");
const channelsProjectionSource = readFileSync(resolve(process.cwd(), "convex/channels.ts"), "utf8");
if (!channelsPageSource.includes("channelIds: artworkChannelIds")) {
  throw new Error("the Channels page must project only the visible card window");
}
if (!channelsPageSource.includes('channels ? { ownerId, channelIds: artworkChannelIds } : "skip"')) {
  throw new Error("channel card projection must wait for the owned channel list before subscribing");
}
if (!channelsProjectionSource.includes('channelIds: v.optional(v.array(v.id("channels")))')) {
  throw new Error("the channel card projection must expose a bounded channel selector");
}
if (!channelsProjectionSource.includes(".slice(0, 24)")) {
  throw new Error("the channel card projection selector must remain bounded server-side");
}
console.log("channel card projection fan-out tests passed");
