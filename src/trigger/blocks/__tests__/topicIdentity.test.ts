import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { loadTopicSelectionIdentity } from "../topicIdentity";

async function main(): Promise<void> {
  registerAllBlocks();
  const manifest = getManifest("topic_select");
  assert.ok(manifest, "topic_select has a registered runtime contract");
  const declaredKeys = new Set([
    ...Object.keys(manifest.consumes),
    ...Object.keys(manifest.optionalConsumes),
  ]);
  const observedReads = new Set<string>();
  const guardedStore = new Proxy({
    channelName: "Rainroom Radio",
    persona: "quiet nocturnal field recorder",
    niche: "sleeping rain ambience",
    styleGrammar: "patient, tactile, low contrast",
    topicPool: ["rain on cedar roofs"],
    bannedWords: ["storm warning"],
  }, {
    get(target, key, receiver) {
      if (typeof key === "string") {
        assert.ok(declaredKeys.has(key), `topic_select runtime contract declares helper read ${key}`);
        observedReads.add(key);
      }
      return Reflect.get(target, key, receiver);
    },
  });
  let channelReads = 0;
  const frozen = await loadTopicSelectionIdentity(guardedStore, async () => {
    channelReads += 1;
    return { name: "Changed live name", identity: { bannedWords: ["different policy"] } };
  });
  assert.equal(channelReads, 0, "complete frozen run identity avoids a live Convex channel read");
  assert.deepEqual([...observedReads].sort(), [
    "bannedWords", "channelName", "niche", "persona", "styleGrammar", "topicPool",
  ]);
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
