import assert from "node:assert/strict";
import { summarizeLibraryStates } from "../librarySummary";

const runs = [
  { id: "published", status: "ok", youtubeVideoId: "yt-1", releaseEvidenceStatus: "release_evidence_recorded" as const },
  { id: "private-master", status: "ok", releaseEvidenceStatus: "release_evidence_recorded" as const },
  { id: "legacy-master", status: "ok" },
  { id: "archived-master", status: "ok", libraryState: "archived" as const },
  { id: "failed-orphan", status: "failed" },
  { id: "failed-but-published", status: "failed", youtubeVideoId: "yt-2", libraryState: "archived" as const },
  { id: "unfinished", status: "running" },
];
const videoAssets = new Set(["private-master", "legacy-master", "archived-master", "failed-orphan"]);

assert.deepEqual(summarizeLibraryStates(runs, videoAssets), {
  currentCount: 2,
  legacyCount: 1,
  archivedCount: 2,
  totalCount: 5,
});

const beyondCardWindow = Array.from({ length: 650 }, (_, index) => ({
  id: `master-${index}`,
  status: "ok",
  libraryState: index < 25 ? "archived" as const : "active" as const,
  releaseEvidenceStatus: "release_evidence_recorded" as const,
}));
assert.deepEqual(
  summarizeLibraryStates(beyondCardWindow, new Set(beyondCardWindow.map((run) => run.id))),
  { currentCount: 625, legacyCount: 0, archivedCount: 25, totalCount: 650 },
  "collection totals must not inherit the 500-card presentation window",
);

console.log("Exact Library state summary tests passed");
