import assert from "node:assert/strict";

import {
  channelCritiqueBrief,
  channelCritiqueContextFromStore,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { declaredArtifactStore } from "@/engine/declaredArtifactStore";
import { getManifest } from "@/engine/registry";
import { registerAllBlocks } from "@/engine/blocks";

const fieldNotes: ChannelCritiqueContext = {
  channelName: "Quiet Field Notes",
  persona: "Curious naturalists who prefer patient observation",
  positioning: "Small, specific discoveries in familiar landscapes",
  vibe: "Calm, tactile, and quietly curious",
  worksInSpace: ["Follow one real detail closely", "Let silence carry weight"],
  avoidInSpace: ["Urgent trailer language", "Grand claims from small evidence"],
  styleGrammar: "Measured sentences; concrete sensory detail",
  narrative: { scriptStyle: "observational", hookStyle: "a precise question", pacing: "unhurried" },
  criticDoctrine: "Prefer truthful restraint over manufactured drama.",
  contentLaneKey: "narrated_documentary",
  laneEmphasis: ["claim-to-source traceability", "no invented scene detail"],
  qualityDimensions: ["groundedness", "voice fidelity"],
  bannedWords: ["miracle", "unbelievable"],
};

const motionLab: ChannelCritiqueContext = {
  channelName: "Motion Lab",
  persona: "Designers studying systems through energetic visual essays",
  positioning: "Explain hidden mechanisms with bold, legible motion",
  vibe: "Direct, kinetic, and analytical",
  worksInSpace: ["Show the mechanism changing state", "Use crisp visual contrasts"],
  avoidInSpace: ["Passive scenic footage", "Decorative motion without explanation"],
  styleGrammar: "Short declarative lines; active verbs",
  narrative: { scriptStyle: "analytical", hookStyle: "reveal the mechanism", pacing: "brisk" },
  criticDoctrine: "Clarity and demonstrated cause outrank atmosphere.",
  contentLaneKey: "illustrated_explainer",
  laneEmphasis: ["visible cause and effect", "one idea per beat"],
  qualityDimensions: ["legibility", "explanatory payoff"],
  bannedWords: ["game-changing", "revolutionary"],
};

const fieldBrief = channelCritiqueBrief(fieldNotes);
const motionBrief = channelCritiqueBrief(motionLab);

assert.notEqual(fieldBrief, motionBrief, "different channel identities must not collapse to a shared generic critic brief");
for (const value of [
  "Quiet Field Notes",
  "Small, specific discoveries in familiar landscapes",
  "Let silence carry weight",
  "Grand claims from small evidence",
  "Prefer truthful restraint over manufactured drama.",
  "claim-to-source traceability",
  "Forbidden channel wording",
  "miracle",
]) assert.ok(fieldBrief.includes(value), `field-notes grounding must retain ${value}`);
for (const value of [
  "Motion Lab",
  "Explain hidden mechanisms with bold, legible motion",
  "Show the mechanism changing state",
  "Decorative motion without explanation",
  "Clarity and demonstrated cause outrank atmosphere.",
  "visible cause and effect",
  "Forbidden channel wording",
  "revolutionary",
]) assert.ok(motionBrief.includes(value), `motion-lab grounding must retain ${value}`);

assert.ok(fieldBrief.includes("OUTRANKS generic criteria"), "operator doctrine must visibly take precedence over generic rubric language");
assert.equal(channelCritiqueBrief(), "", "unconfigured callers retain the no-grounding legacy prompt");
assert.ok(channelCritiqueBrief({ criticDoctrine: "x".repeat(2_000) }).length < 800,
  "operator-authored grounding must remain bounded before entering provider prompts");

registerAllBlocks();
const showBible = {
  positioning: "An authored channel promise, not generic topic coverage",
  vibe: "Precise, warm, and observant",
  worksInSpace: ["Show one real mechanism changing"],
  avoidInSpace: ["Invented scenery"],
};
const guardedInputs = {
  topic: "A test topic",
  channelName: "Grounded Field Lab",
  persona: "Viewers who value visible evidence",
  styleGrammar: "Concrete, direct language",
  criticDoctrine: "Never trade evidence for spectacle.",
  showBible,
  styleDNA: { colorGrade: "soft natural light", motifs: ["field notebook"], visualAvoid: ["glowing diagrams"] },
  contentLane: { key: "whiteboard_explainer" },
  bannedWords: ["miracle"],
};
for (const moduleId of ["whiteboard_scribe", "motion_comic", "lore_short", "self_contained_story_plan"]) {
  const manifest = getManifest(moduleId);
  assert.ok(manifest, `${moduleId} must have a registered executable manifest`);
  const guardedStore = declaredArtifactStore(manifest, guardedInputs, new Set());
  const context = channelCritiqueContextFromStore(guardedStore, ["illustrate the exact claim"]);
  const brief = channelCritiqueBrief(context);
  for (const value of [
    showBible.positioning,
    showBible.vibe,
    showBible.worksInSpace[0]!,
    showBible.avoidInSpace[0]!,
    guardedInputs.criticDoctrine,
    guardedInputs.bannedWords[0]!,
  ]) assert.ok(brief.includes(value), `${moduleId} must pass authored channel guidance through its guarded store: ${value}`);
}

console.log("CHANNEL CRITIQUE GROUNDING PASS — distinct identities and lane-specific doctrine survive the shared module boundary");
