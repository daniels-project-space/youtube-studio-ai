import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QualityLearningPanel } from "./QualityLearningPanel";

const html = renderToStaticMarkup(createElement(QualityLearningPanel, {
  state: "ready",
  channelNames: new Map([["channel-1", "History Lab"]]),
  insights: [{
    id: "retention-1",
    channelId: "channel-1",
    status: "proposed",
    createdAt: 1,
    sourceVideoCount: 1,
    sampleSize: 300,
    evidencePassed: true,
    diagnosis: "The first causal beat retained attention.",
    opening: {
      status: "measured",
      scope: "youtube_intro_30_sec",
      targetSec: 30,
      retentionRatio: 0.71,
    },
  }],
}));

assert.match(html, /What real viewers did at the opening/);
assert.match(html, /HUMAN APPROVAL REQUIRED/);
assert.match(html, /History Lab/);
assert.match(html, /30-second intro 71% at 30.0s/);
assert.match(html, /evidence threshold met/);
assert.doesNotMatch(html, /nextValue|provider transcript/i);

console.log("quality learning panel tests passed");
