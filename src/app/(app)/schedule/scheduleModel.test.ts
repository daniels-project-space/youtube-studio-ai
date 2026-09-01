import assert from "node:assert/strict";
import { civilDayKey, scheduledTimestampForDay } from "@/lib/scheduleCalendar";
import {
  buildCalendarModel,
  buildChannelColors,
  channelHref,
  eventStatusLabel,
  publishedTimestampRange,
  type ChannelRow,
  type PlanItem,
  type PublishedVideo,
} from "./scheduleModel";

const channels: ChannelRow[] = [
  {
    _id: "channel-a",
    name: "Tokyo Essays",
    slug: "tokyo/essays",
    status: "active",
    schedule: {
      frequency: "weekly",
      days: [1],
      timezone: "Asia/Tokyo",
      localTime: "09:00",
    },
  },
  {
    _id: "channel-b",
    name: "New York Daily",
    slug: "new-york-daily",
    status: "active",
    schedule: {
      frequency: "daily",
      timezone: "America/New_York",
      localTime: "09:30",
    },
  },
];

const pinned = scheduledTimestampForDay(
  "2026-08-08",
  "09:30",
  "America/New_York",
);
assert.ok(pinned, "fixture must produce a valid channel-local timestamp");

const plan: PlanItem[] = [
  {
    _id: "plan-a-1",
    channelId: "channel-a",
    channelName: "Tokyo Essays",
    channelSlug: "tokyo/essays",
    cadence: "weekly",
    order: 0,
    topic: "A first essay",
    status: "ready",
  },
  {
    _id: "plan-a-2",
    channelId: "channel-a",
    channelName: "Tokyo Essays",
    channelSlug: "tokyo/essays",
    cadence: "weekly",
    order: 1,
    topic: "A second essay",
    thumbnailKey: "thumbs/second.jpg",
    status: "ready",
  },
  {
    _id: "plan-b-1",
    channelId: "channel-b",
    channelName: "New York Daily",
    channelSlug: "new-york-daily",
    cadence: "daily",
    order: 0,
    topic: "A pinned daily",
    thumbnailKey: "thumbs/daily.jpg",
    status: "ready",
    scheduledAt: pinned!,
  },
];

const publishedVideos: PublishedVideo[] = [
  {
    _id: "video-a",
    title: "Already published",
    channelId: "channel-a",
    youtubeVideoId: "youtube-a",
    publishedAt: Date.parse("2026-08-07T01:00:00.000Z"),
    publicationKind: "public",
  },
];

const colors = buildChannelColors(channels);
const reverseColors = buildChannelColors([...channels].reverse());
assert.deepEqual(
  [...colors.entries()],
  [...reverseColors.entries()],
  "channel colors must not change when the query order changes",
);

const visibleCells = Array.from({ length: 42 }, (_, index) => new Date(2026, 6, 26 + index));
assert.deepEqual(publishedTimestampRange(visibleCells), {
  startAt: Date.UTC(2026, 6, 25),
  endAt: Date.UTC(2026, 8, 7),
});

const channelById = new Map(channels.map((channel) => [channel._id, channel]));
const all = buildCalendarModel({
  plan,
  publishedVideos,
  channelById,
  channelColors: colors,
  scope: "all",
  todayMs: Date.parse("2026-08-06T12:00:00.000Z"),
});

assert.equal(all.flat.length, 4, "all-channel overlay includes planned and published work only");
const missingThumbnail = all.flat.find((event) => event.key === "plan:plan-a-1");
assert.equal(civilDayKey(missingThumbnail!.date), "2026-08-10");
assert.equal(
  missingThumbnail?.timestamp,
  scheduledTimestampForDay("2026-08-10", "09:00", "Asia/Tokyo"),
  "projected items retain their exact channel-local timestamp",
);
assert.equal(missingThumbnail?.readiness, "attention");
assert.equal(eventStatusLabel(missingThumbnail!), "Missing thumbnail");
assert.equal(
  civilDayKey(all.flat.find((event) => event.key === "plan:plan-a-2")!.date),
  "2026-08-17",
  "weekly projection follows the channel's configured weekday",
);
const pinnedEvent = all.flat.find((event) => event.key === "plan:plan-b-1");
assert.equal(civilDayKey(pinnedEvent!.date), "2026-08-08");
assert.equal(pinnedEvent?.pinned, true, "explicit dates win over cadence projection");
assert.equal(pinnedEvent?.timestamp, pinned, "pinned items retain the immutable stored timestamp");
assert.equal(pinnedEvent?.timeZone, "America/New_York");
assert.equal(
  civilDayKey(all.flat.find((event) => event.key === "video:video-a")!.date),
  "2026-08-07",
  "published history uses the channel's local civil date",
);
const publishedEvent = all.flat.find((event) => event.key === "video:video-a");
assert.equal(publishedEvent?.timestamp, Date.parse("2026-08-07T01:00:00.000Z"));
assert.equal(publishedEvent?.timeZone, "Asia/Tokyo");

const selected = buildCalendarModel({
  plan,
  publishedVideos,
  channelById,
  channelColors: colors,
  scope: "channel-b",
  todayMs: Date.parse("2026-08-06T12:00:00.000Z"),
});
assert.deepEqual(
  selected.flat.map((event) => event.channelId),
  ["channel-b"],
  "selected-channel mode excludes every other channel",
);
assert.equal(channelHref("tokyo/essays", "week-ahead"), "/channels/tokyo%2Fessays?tab=week-ahead");
assert.equal(
  channelHref("tokyo/essays", "week-ahead", "plan:item/1"),
  "/channels/tokyo%2Fessays?tab=week-ahead&plan=plan%3Aitem%2F1#plan-plan%3Aitem%2F1",
);

const operationalChannels: ChannelRow[] = [
  {
    _id: "eligible",
    name: "Eligible",
    slug: "eligible",
    status: "active",
    schedule: { frequency: "weekly", days: [1], timezone: "UTC", localTime: "09:00" },
  },
  {
    _id: "inactive",
    name: "Inactive",
    slug: "inactive",
    status: "paused",
    schedule: { frequency: "weekly", days: [1], timezone: "UTC", localTime: "09:00" },
  },
  {
    _id: "disabled",
    name: "Disabled",
    slug: "disabled",
    status: "active",
    schedule: { frequency: "weekly", days: [1], timezone: "UTC", localTime: "09:00", enabled: false },
  },
];
const operationalPlan: PlanItem[] = [
  ...operationalChannels.map((channel, order) => ({
    _id: `plan-${channel._id}`,
    channelId: channel._id,
    channelName: channel.name,
    channelSlug: channel.slug,
    cadence: "weekly",
    order,
    topic: channel.name,
    thumbnailKey: `${channel.slug}.jpg`,
    status: "ready",
  })),
  {
    _id: "plan-disabled-pinned",
    channelId: "disabled",
    channelName: "Disabled",
    channelSlug: "disabled",
    cadence: "weekly",
    order: 3,
    topic: "Pinned while cadence is paused",
    thumbnailKey: "disabled-pinned.jpg",
    status: "ready",
    scheduledAt: Date.parse("2026-08-09T09:00:00.000Z"),
  },
  {
    _id: "plan-orphan",
    channelId: "deleted-channel",
    channelName: "(unknown)",
    channelSlug: "",
    cadence: "weekly",
    order: 4,
    topic: "Orphan",
    thumbnailKey: "orphan.jpg",
    status: "ready",
  },
];
const operational = buildCalendarModel({
  plan: operationalPlan,
  publishedVideos: [],
  channelById: new Map(operationalChannels.map((channel) => [channel._id, channel])),
  channelColors: buildChannelColors(operationalChannels),
  scope: "all",
  todayMs: Date.parse("2026-08-06T12:00:00.000Z"),
});
assert.deepEqual(
  operational.flat.map((event) => event.channelId),
  ["eligible", "disabled"],
  "the calendar hides disabled cadence projections but retains exact pinned work the scheduler will execute",
);
assert.equal(
  operational.flat.find((event) => event.key === "plan:plan-disabled-pinned")?.pinned,
  true,
);
assert.deepEqual(operational.excluded, {
  orphan: 1,
  inactive: 1,
  disabled: 1,
  total: 3,
  labels: ["1 deleted-channel item", "1 paused/draft item", "1 scheduler-disabled item"],
});

console.log("schedule model tests passed");
