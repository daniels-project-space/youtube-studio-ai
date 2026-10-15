import assert from "node:assert/strict";

import { loadTopicSelectionIdentity } from "../topicIdentity";

async function main(): Promise<void> {
  let channelReads = 0;
  const frozen = await loadTopicSelectionIdentity({
    channelName: "Rainroom Radio",
    persona: "quiet nocturnal field recorder",
    niche: "sleeping rain ambience",
    styleGrammar: "patient, tactile, low contrast",
    topicPool: ["rain on cedar roofs"],
    bannedWords: ["storm warning"],
  }, async () => {
    channelReads += 1;
    return { name: "Changed live name", identity: { bannedWords: ["different policy"] } };
  });
  assert.equal(channelReads, 0, "complete frozen run identity avoids a live Convex channel read");
  assert.deepEqual(frozen, {
    channelName: "Rainroom Radio",
    persona: "quiet nocturnal field recorder",
    niche: "sleeping rain ambience",
    style: "patient, tactile, low contrast",
    pool: ["rain on cedar roofs"],
    bannedWords: ["storm warning"],
  });

  const legacy = await loadTopicSelectionIdentity({ channelName: "Seeded name", persona: "seeded persona" }, async () => {
    channelReads += 1;
    return {
      name: "Fallback name",
      identity: {
        persona: "live persona",
        niche: "live niche",
        styleGrammar: "live style",
        topicPool: ["live pool"],
        bannedWords: ["live policy"],
      },
    };
  });
  assert.equal(channelReads, 1, "incomplete legacy identity still loads the channel document");
  assert.deepEqual(legacy, {
    channelName: "Seeded name",
    persona: "seeded persona",
    niche: "live niche",
    style: "live style",
    pool: ["live pool"],
    bannedWords: ["live policy"],
  });
  console.log("TOPIC IDENTITY PASS: frozen policy wins; incomplete legacy runs retain channel fallback");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
