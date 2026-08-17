import assert from "node:assert/strict";
import {
  mergeSeriesStoryState,
  renderStoryStateForPrompt,
  MAX_PLOT_BEATS,
  type SeriesStoryStateData,
} from "@/lib/seriesStoryState";

function main() {
  // ---- Backward compatibility: no story state yet (first episode / non-series channel) ----
  assert.equal(
    renderStoryStateForPrompt(null),
    "",
    "no story state must render an empty prompt block (today's exact title-only behavior)",
  );
  assert.equal(renderStoryStateForPrompt(undefined), "", "undefined state also renders empty");

  const emptyState: SeriesStoryStateData = {
    arcSummary: "",
    plotBeats: [],
    unresolvedThreads: [],
    entities: [],
    updatedAt: 0,
  };
  assert.equal(
    renderStoryStateForPrompt(emptyState),
    "",
    "a freshly-created empty row (no content yet) must also render as empty, not a header with nothing under it",
  );

  // ---- Episode 1: first write creates a fresh row from null ----
  const afterEp1 = mergeSeriesStoryState(null, {
    episode: 1,
    arcSummary: "A stoic teacher and a restless student begin a week of quiet lessons.",
    newPlotBeat: "The student arrives late and dismissive of the teacher's calm.",
    unresolvedThreads: ["Why is the student so restless?"],
    newEntities: [
      { name: "Marcus", role: "the stoic teacher" },
      { name: "Livia", role: "the restless student" },
    ],
    now: 1000,
  });
  assert.equal(afterEp1.arcSummary, "A stoic teacher and a restless student begin a week of quiet lessons.");
  assert.equal(afterEp1.plotBeats.length, 1);
  assert.deepEqual(afterEp1.plotBeats[0], {
    episode: 1,
    beat: "The student arrives late and dismissive of the teacher's calm.",
    at: 1000,
  });
  assert.deepEqual(afterEp1.unresolvedThreads, ["Why is the student so restless?"]);
  assert.equal(afterEp1.entities.length, 2);
  assert.deepEqual(
    afterEp1.entities.find((e) => e.name === "Marcus"),
    { name: "Marcus", role: "the stoic teacher" },
  );

  // ---- Round trip: read episode 1's state, render it, feed episode 2 ----
  const promptForEp2 = renderStoryStateForPrompt(afterEp1);
  assert.match(promptForEp2, /ARC SO FAR: A stoic teacher/);
  assert.match(promptForEp2, /UNRESOLVED THREADS: Why is the student so restless\?/);
  assert.match(promptForEp2, /KNOWN ENTITIES: Marcus \(the stoic teacher\); Livia \(the restless student\)/);
  assert.match(promptForEp2, /RECENT PLOT BEATS: Ep\.1: The student arrives late/);

  // ---- Episode 2: arc summary replaced, thread resolved + new one opened, one new entity, one repeated entity with an updated role ----
  const afterEp2 = mergeSeriesStoryState(afterEp1, {
    episode: 2,
    arcSummary:
      "A stoic teacher and a restless student begin a week of quiet lessons; by day two the student starts listening.",
    newPlotBeat: "Livia asks her first real question about why calm matters.",
    unresolvedThreads: ["Will Livia's family accept her new calm?"], // old thread resolved, new one opened
    newEntities: [{ name: "Livia", role: "the student, now genuinely curious" }, { name: "Quintus", role: "Livia's skeptical father" }],
    now: 2000,
  });
  assert.equal(afterEp2.plotBeats.length, 2, "episode 2 appends a beat, does not replace episode 1's");
  assert.deepEqual(afterEp2.unresolvedThreads, ["Will Livia's family accept her new calm?"]);
  assert.equal(afterEp2.entities.length, 3, "Marcus kept, Livia updated in place, Quintus added");
  assert.deepEqual(
    afterEp2.entities.find((e) => e.name === "Livia"),
    { name: "Livia", role: "the student, now genuinely curious" },
    "existing entity's role is updated, not duplicated",
  );
  assert.ok(afterEp2.entities.find((e) => e.name === "Marcus"), "prior entity Marcus is retained across episodes");

  // ---- Omitted fields keep prior values (partial update) ----
  const afterEp3Partial = mergeSeriesStoryState(afterEp2, { episode: 3, now: 3000 });
  assert.equal(afterEp3Partial.arcSummary, afterEp2.arcSummary, "omitted arcSummary keeps the prior summary");
  assert.deepEqual(afterEp3Partial.unresolvedThreads, afterEp2.unresolvedThreads, "omitted threads keep the prior list");
  assert.equal(afterEp3Partial.entities.length, afterEp2.entities.length, "omitted entities keep the prior roster");
  assert.equal(afterEp3Partial.plotBeats.length, afterEp2.plotBeats.length, "no newPlotBeat means no beat appended");

  // ---- Dedup: case-insensitive thread/entity dedup ----
  const dedupState = mergeSeriesStoryState(null, {
    episode: 1,
    unresolvedThreads: ["Open question", "open question", "Open Question ", "Another one"],
    newEntities: [
      { name: "Marcus", role: "first mention" },
      { name: "marcus", role: "second mention, same person" },
    ],
    now: 1,
  });
  assert.deepEqual(dedupState.unresolvedThreads, ["Open question", "Another one"], "threads dedup case-insensitively");
  assert.equal(dedupState.entities.length, 1, "entities dedup case-insensitively by name");
  assert.equal(dedupState.entities[0].role, "second mention, same person", "later role wins for the same entity");

  // ---- Bounded plot-beat history ----
  let bounded: SeriesStoryStateData | null = null;
  for (let ep = 1; ep <= MAX_PLOT_BEATS + 10; ep++) {
    bounded = mergeSeriesStoryState(bounded, { episode: ep, newPlotBeat: `beat ${ep}`, now: ep });
  }
  assert.equal(bounded!.plotBeats.length, MAX_PLOT_BEATS, "plot-beat history is capped");
  assert.equal(bounded!.plotBeats[0].episode, 11, "oldest beats are dropped, most recent kept");
  assert.equal(bounded!.plotBeats[bounded!.plotBeats.length - 1].episode, MAX_PLOT_BEATS + 10);

  console.log("seriesStoryState pure-logic tests passed");
}

main();
