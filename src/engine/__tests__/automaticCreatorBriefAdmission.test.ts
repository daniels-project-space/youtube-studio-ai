import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { automaticCreatorBriefAdmission } from "@/engine/automaticCreatorBriefAdmission";

function identity(input: Parameters<typeof createChannelProgramBrief>[0]) {
  const programBrief = createChannelProgramBrief(input);
  return {
    family: programBrief.family,
    identity: {
      nicheKey: programBrief.nicheKey,
      programBrief,
    },
  };
}

const originalWhiteboard = automaticCreatorBriefAdmission(identity({
  family: "whiteboard",
  nicheKey: "educational",
  locale: "en",
  concept: "Original visual logic puzzles with a recurring chalkboard detective.",
}));
assert.equal(originalWhiteboard.applies, true);
assert.equal(originalWhiteboard.automatic, true, "original self-contained whiteboard stories remain automatic");

const factualWhiteboard = automaticCreatorBriefAdmission(identity({
  family: "whiteboard",
  nicheKey: "educational",
  locale: "en",
  concept: "Explain a hard science mechanism with a causal whiteboard story.",
}));
assert.equal(factualWhiteboard.automatic, false);
assert.deepEqual(factualWhiteboard.sourceRequirements, [
  "reviewed factual evidence pack",
  "source-bound claim ledger",
]);

const factualComic = automaticCreatorBriefAdmission(identity({
  family: "comic",
  nicheKey: "history",
  locale: "en",
  concept: "Illustrated graphic-novel history stories about real empires and wars.",
}));
assert.equal(factualComic.automatic, false, "historical comics cannot use an original-story automatic route");
assert.match(factualComic.reason, /source\/module evidence/i);

const missingBrief = automaticCreatorBriefAdmission({ family: "whiteboard", identity: {} });
assert.equal(missingBrief.automatic, false, "a legacy automatic row without a sealed Brief must fail closed");
assert.match(missingBrief.reason, /must be repaired/i);

const blockedFamily = automaticCreatorBriefAdmission({ family: "cinematic", identity: {} });
assert.equal(blockedFamily.applies, false);
assert.equal(blockedFamily.automatic, true, "other route-specific admission systems retain their own authority");

console.log("automatic creator Brief admission tests passed");
