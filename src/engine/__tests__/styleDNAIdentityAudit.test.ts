import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { styleDNAIdentityAuditContext } from "@/engine/creative/styleDNA";

const programBrief = createChannelProgramBrief({
  family: "whiteboard",
  nicheKey: "educational",
  subcategory: "how-to-tutorials",
  locale: "en",
  concept: "Explain difficult science through patient causal diagrams.",
  audience: "Curious adults who want rigor without jargon.",
  sampleTopics: ["Why satellites stay in orbit"],
});

const context = styleDNAIdentityAuditContext({
  family: "whiteboard",
  name: "The Chalk Observatory",
  programBrief,
  persona: "A calm, exacting science mentor drawing at a midnight observatory.",
  styleGrammar: "Graphite lines, deep indigo field, warm instrument-light accents.",
});

assert.match(context, /The Chalk Observatory/);
assert.match(context, /Explain difficult science through patient causal diagrams/);
assert.match(context, /Curious adults who want rigor without jargon/);
assert.match(context, /calm, exacting science mentor drawing at a midnight observatory/);
assert.match(context, /Graphite lines, deep indigo field, warm instrument-light accents/);
assert.match(context, /Family: whiteboard/);

console.log("style DNA identity audit context passed");
