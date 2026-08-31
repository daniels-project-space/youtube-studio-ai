import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");

async function main(): Promise<void> {
  const quiz = await readFile(join(ROOT, "src/trigger/blocks/quizYearBlocks.ts"), "utf8");
  const topicMemory = await readFile(join(ROOT, "convex/topicMemory.ts"), "utf8");

  assert.match(
    quiz,
    /channelId: ctx\.channelId,[\s\S]*runId: ctx\.runId,/,
    "a Question checkpoint must be episode-scoped; a future visit to a topic cannot replay an old round set",
  );
  assert.match(
    quiz,
    /excludeQids: args\.excludeSubjectIds/g,
    "both year and category Wikidata readers must receive the durable exclusion set",
  );
  assert.match(
    quiz,
    /quizSubjectIdsUsedByOtherRuns\([\s\S]*ctx\.runId/,
    "fresh runs must exclude prior channel QIDs while retaining their own retry identity",
  );
  assert.match(
    quiz,
    /await persistSubjects\(parsed\.rounds\)/,
    "a retry must restore a missing durable subject record before it can render",
  );
  assert.match(
    quiz,
    /await persistSubjects\(repaired\)/,
    "a new verified round set must reserve its QIDs before rendering",
  );
  assert.match(
    topicMemory,
    /withIndex\("by_channel_key"[\s\S]*if \(existing\) return existing\._id/,
    "retrying the same subject reservation must be idempotent",
  );

  console.log("QUIZYEAR REPETITION WIRING PASS");
}

void main();
