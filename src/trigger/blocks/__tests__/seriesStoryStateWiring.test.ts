import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeSeriesStoryState, renderStoryStateForPrompt, type SeriesStoryStateData } from "@/lib/seriesStoryState";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function main() {
  const topicSelect = source("src/trigger/blocks/lofiBlocks.ts");
  const seriesStoryStateConvex = source("convex/seriesStoryState.ts");
  const schema = source("convex/schema.ts");

  // ---- Schema wiring ----
  assert.match(schema, /seriesStoryState: defineTable\(/, "schema must declare the seriesStoryState table");
  assert.match(schema, /by_channel_series/, "schema must index seriesStoryState by (channelId, seriesTitle) for O(1) lookup");

  // ---- Convex functions exist with the expected read/write shape ----
  assert.match(seriesStoryStateConvex, /export const getForSeries = query\(/, "getForSeries query must exist");
  assert.match(seriesStoryStateConvex, /export const recordEpisodeBeat = mutation\(/, "recordEpisodeBeat mutation must exist");
  assert.match(seriesStoryStateConvex, /mergeSeriesStoryState/, "the mutation must delegate to the shared pure merge function (single source of truth with the tested logic)");

  // ---- topic_select SERIES MODE reads story state and injects it into the continuation prompt ----
  assert.match(
    topicSelect,
    /api\.seriesStoryState\.getForSeries/,
    "topic_select SERIES MODE must read prior story state",
  );
  assert.match(
    topicSelect,
    /renderStoryStateForPrompt\(existingStoryState\)/,
    "topic_select must render the story state into the continuation prompt via the shared, tested renderer",
  );
  assert.match(
    topicSelect,
    /storyContext\s*\?\s*`STORY SO FAR/,
    "the continuation prompt must conditionally include a STORY SO FAR section only when story state exists (backward compat when absent)",
  );

  // ---- topic_select SERIES MODE writes back after the episode's topic is finalized ----
  assert.match(
    topicSelect,
    /api\.seriesStoryState\.recordEpisodeBeat/,
    "topic_select SERIES MODE must write the episode's plot beat back to seriesStoryState",
  );
  assert.match(
    topicSelect,
    /episode:\s*epNum/,
    "the write-back must be keyed to the actual episode number",
  );
  // The write-back must sit behind the same `dryRun` gate as the existing
  // topicMemory commit — a preview run must not mutate story state either.
  const seriesModeBlock = topicSelect.slice(
    topicSelect.indexOf('const seriesTitle = (ctx.params["seriesTitle"]'),
    topicSelect.indexOf("TOPICRAFT — the golden topic-intel engine"),
  );
  assert.match(
    seriesModeBlock,
    /if \(ctx\.params\["dryRun"\] !== true\) \{[\s\S]*recordTopicMemory\(c, ctx, topic\);[\s\S]*recordEpisodeBeat/,
    "story-state write-back must be gated behind the same dryRun !== true block as the topicMemory commit",
  );

  // ---- End-to-end behavioral simulation across 3 episodes using the exact ----
  // ---- pure functions the Convex mutation/query delegate to. This proves ----
  // ---- the read -> prompt -> write round trip and backward compatibility ----
  // ---- without requiring a live Convex backend. ----
  let stored: SeriesStoryStateData | null = null; // no row yet == what getForSeries returns for a fresh series

  // Episode 1: nothing to read yet — prompt must omit the "story so far" section.
  const promptContextEp1 = renderStoryStateForPrompt(stored);
  assert.equal(promptContextEp1, "", "episode 1 (no prior state) renders no story-so-far section — matches pre-Phase-4 behavior exactly");
  stored = mergeSeriesStoryState(stored, {
    episode: 1,
    arcSummary: "Episode 1 establishes the premise.",
    newPlotBeat: "The premise is established.",
    unresolvedThreads: ["What happens next?"],
    newEntities: [{ name: "Nova", role: "the guide" }],
    now: 1,
  });

  // Episode 2: must be able to read what episode 1 wrote, and see it rendered.
  const promptContextEp2 = renderStoryStateForPrompt(stored);
  assert.match(promptContextEp2, /ARC SO FAR: Episode 1 establishes the premise\./);
  assert.match(promptContextEp2, /KNOWN ENTITIES: Nova \(the guide\)/);
  stored = mergeSeriesStoryState(stored, {
    episode: 2,
    arcSummary: "Episode 1 establishes the premise; episode 2 raises the stakes.",
    newPlotBeat: "The stakes are raised.",
    unresolvedThreads: ["Will Nova succeed?"],
    now: 2,
  });

  // Episode 3: arc summary and beats accumulate; nothing from episode 1/2 is lost.
  const promptContextEp3 = renderStoryStateForPrompt(stored);
  assert.match(promptContextEp3, /episode 2 raises the stakes/);
  assert.match(promptContextEp3, /RECENT PLOT BEATS: Ep\.1: The premise is established\. \| Ep\.2: The stakes are raised\./);
  assert.equal(stored!.entities.length, 1, "entity roster persists across episodes without re-declaration");

  console.log("series story-state wiring tests passed");
}

main();
