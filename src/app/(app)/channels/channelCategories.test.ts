import assert from "node:assert/strict";
import { channelCategoryFor, groupChannelsByCategory } from "./channelCategories";

const channels = [
  { id: "seaside", name: "Seaside Ghibli Lofi", identity: { niche: "Lo-Fi Music" } },
  { id: "stoic", name: "The Quiet Stoic", identity: { niche: "stoic philosophy" } },
  { id: "inked", name: "Inked Histories", identity: { niche: "History" } },
  { id: "chalk", name: "Chalk & Compound", identity: { niche: "Finance" } },
  { id: "quiz", name: "QuizYear", identity: { niche: "Educational" } },
  { id: "odd", name: "Small Wonders", identity: { niche: "Curiosities" } },
];

assert.equal(channelCategoryFor(channels[0]), "sound");
assert.equal(channelCategoryFor(channels[1]), "mindset");
assert.equal(channelCategoryFor(channels[2]), "stories");
assert.equal(channelCategoryFor(channels[3]), "money");
assert.equal(channelCategoryFor(channels[4]), "learning");
assert.equal(channelCategoryFor(channels[5]), "other");
assert.deepEqual(
  groupChannelsByCategory(channels).map((group) => [group.key, group.channels.map((channel) => channel.id)]),
  [["sound", ["seaside"]], ["mindset", ["stoic"]], ["stories", ["inked"]], ["learning", ["quiz"]], ["money", ["chalk"]], ["other", ["odd"]]],
);

console.log("channel category grouping tests passed");
