import assert from "node:assert/strict";
import { publishedCalendarItem } from "../publishedCalendar";

const base = {
  _id: "intent-a",
  channelId: "channel-a",
  title: "A real upload",
  status: "uploaded",
  youtubeVideoId: "yt-a",
  thumbnailArtifactKey: "thumbs/a.jpg",
} as const;

assert.deepEqual(
  publishedCalendarItem({
    ...base,
    privacyStatus: "private",
    publishAt: 2_000,
    completedAt: 1_000,
  }),
  {
    _id: "intent-a",
    channelId: "channel-a",
    title: "A real upload",
    youtubeVideoId: "yt-a",
    thumbnailKey: "thumbs/a.jpg",
    publishedAt: 2_000,
    publicationKind: "scheduled",
  },
  "native schedules use the exact public timestamp rather than upload completion",
);

assert.equal(
  publishedCalendarItem({
    ...base,
    privacyStatus: "private",
    completedAt: 1_000,
  }),
  null,
  "private drafts never crowd published calendar history",
);

assert.equal(
  publishedCalendarItem({
    ...base,
    privacyStatus: "public",
    completedAt: 1_000,
    status: "dispatching",
  }),
  null,
  "an incomplete ledger row is not published history",
);

assert.equal(
  publishedCalendarItem({
    ...base,
    privacyStatus: "public",
    completedAt: 1_000,
    youtubeVideoId: undefined,
  }),
  null,
  "uploaded state without a durable YouTube id fails closed",
);

const unlisted = publishedCalendarItem({
    ...base,
    privacyStatus: "unlisted",
    completedAt: 3_000,
  });
assert.equal(unlisted?.publicationKind, "unlisted");
assert.equal(unlisted?.publishedAt, 3_000, "immediate uploads use durable completion time");

console.log("published calendar tests passed");
