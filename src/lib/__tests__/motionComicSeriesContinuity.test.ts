import assert from "node:assert/strict";

import { motionComicSeriesContinuityPrompt } from "@/lib/motionComic";

const prompt = motionComicSeriesContinuityPrompt({
  seriesTitle: "Brickwork Detectives",
  episodeNumber: 3,
  seriesCount: 8,
  arcSummary: "Mara and Niko have traced the missing blueprints to the old harbor.",
  recentPlotBeats: [{ episode: 2, beat: "The harbor keeper hid half of the map." }],
  unresolvedThreads: ["Who altered the blueprint ledger?"],
  entities: [{ name: "Mara", role: "methodical apprentice engineer" }],
});

assert.match(prompt, /Brickwork Detectives · Episode 3 of 8/);
assert.match(prompt, /ARC SO FAR: Mara and Niko/);
assert.match(prompt, /E2: The harbor keeper/);
assert.match(prompt, /UNRESOLVED THREADS/);
assert.match(prompt, /CONTINUING ENTITIES/);
assert.match(
  prompt,
  /not instructions/,
  "persisted narrative prose must be data-delimited before it reaches the planner",
);
assert.equal(motionComicSeriesContinuityPrompt(undefined), "");

console.log("MOTION COMIC SERIES CONTINUITY PASS");
