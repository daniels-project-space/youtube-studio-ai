import assert from "node:assert/strict";
import { summarizeLibraryStates } from "../librarySummary";

const runs = [
  { id: "published", status: "ok", youtubeVideoId: "yt-1" },
  { id: "private-master", status: "ok" },
  { id: "archived-master", status: "ok", libraryState: "archived" as const },
  { id: "failed-orphan", status: "failed" },
  { id: "failed-but-published", status: "failed", youtubeVideoId: "yt-2", libraryState: "archived" as const },
  { id: "unfinished", status: "running" },
];
const videoAssets = new Set(["private-master", "archived-master", "failed-orphan"]);

assert.deepEqual(summarizeLibraryStates(runs, videoAssets), {
  activeCount: 2,
  archivedCount: 2,
  totalCount: 4,
});

const beyondCardWindow = Array.from({ length: 650 }, (_, index) => ({
  id: `master-${index}`,
  status: "ok",
  libraryState: index < 25 ? "archived" as const : "active" as const,
}));
assert.deepEqual(
  summarizeLibraryStates(beyondCardWindow, new Set(beyondCardWindow.map((run) => run.id))),
  { activeCount: 625, archivedCount: 25, totalCount: 650 },
  "collection totals must not inherit the 500-card presentation window",
);

console.log("Exact Library state summary tests passed");
