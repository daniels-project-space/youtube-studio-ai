import assert from "node:assert/strict";

import { CHANNEL_INCEPTION_FAMILY_POLICIES } from "@/engine/channelInceptionContracts";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import {
  ESTABLISHED_CONFIDENCE,
  inspectStyleDNADraft,
  styleDNAConfidence,
  type StyleDNADraft,
} from "@/engine/creative/styleDNA";

const draft: StyleDNADraft = {
  palette: ["#17202A", "#E7B75A", "#D9E1E8"],
  recurringSubject: "a chalk-drawing science mentor",
  setting: "a midnight observatory filled with graphite diagrams",
  composition: "close diagrams in the foreground, telescope in the rear",
  colorGrade: "cool graphite shadows with warm brass highlights",
  motifs: ["chalk orbit arcs", "brass telescope"],
  variationAxes: ["sky condition", "diagram subject"],
  motionVocabulary: ["chalk strokes", "slow star drift"],
  motionDiscipline: "locked camera; only the named diagram and sky elements move",
  visualAvoid: ["generic stock footage", "unexplained decorative motion"],
  thumbnail: {
    composition: "mentor beside a single orbit diagram",
    textRule: "two words maximum",
    palette: ["#17202A", "#E7B75A", "#D9E1E8"],
    subject: "the chalk orbit diagram",
  },
  audio: {
    role: "narration_bed",
    genre: "patient instrumental science underscore",
    bpmMin: 64,
    bpmMax: 78,
    instrumentation: ["felt piano", "soft analog synth"],
    textures: ["low observatory room tone"],
    moodArc: "curiosity to clear understanding",
    loudnessLufs: -14,
    loopable: false,
  },
  narrative: {
    scriptStyle: "concrete causal explanations with defined terms",
    hookStyle: "open with the surprising physical consequence",
    pacing: "one diagram change per explanatory beat",
    voiceProfile: "warm mid-range voice with measured articulation",
    delivery: "patient, exact, and quietly enthusiastic",
  },
  seo: {
    titleFormula: "How [celestial object] stays in orbit",
    descriptionStructure: "question, causal explanation, source notes",
    playlistStrategy: "orbital mechanics in learning order",
  },
};

assert.deepEqual(inspectStyleDNADraft(draft, true, "The Chalk Observatory"), []);
assert.equal(styleDNAConfidence({ hasVision: true, hasTitles: true, hasDatabank: true, accepted: true }), 1);
assert.ok(
  styleDNAConfidence({ hasVision: true, hasTitles: true, hasDatabank: true, accepted: false }) < ESTABLISHED_CONFIDENCE,
  "a fully grounded draft that failed specificity review must stay below the established threshold",
);

for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  const requiresNarrative = CHANNEL_INCEPTION_FAMILY_POLICIES[family].requiresNarrativePlaybook;
  const issues = inspectStyleDNADraft({ ...draft, narrative: undefined }, requiresNarrative, "The Chalk Observatory");
  assert.equal(
    issues.some((issue) => issue.includes("narrated family but no narrative block")),
    requiresNarrative,
    `${family} Style DNA narrative requirement must match channel inception policy`,
  );
}

const corruptions: Array<{ field: string; candidate: StyleDNADraft; issue: string }> = [
  {
    field: "audio.role",
    candidate: { ...draft, audio: { ...draft.audio, role: "ambient_everything" as never } },
    issue: "audio.role must declare a supported channel music purpose",
  },
  { field: "composition", candidate: { ...draft, composition: " " }, issue: "composition is empty" },
  { field: "colorGrade", candidate: { ...draft, colorGrade: " " }, issue: "colorGrade is empty" },
  { field: "variationAxes", candidate: { ...draft, variationAxes: [" "] }, issue: "variationAxes has no approved variation" },
  { field: "motionVocabulary", candidate: { ...draft, motionVocabulary: [] }, issue: "motionVocabulary has no permitted motion" },
  { field: "motionDiscipline", candidate: { ...draft, motionDiscipline: " " }, issue: "motionDiscipline is empty" },
  { field: "visualAvoid", candidate: { ...draft, visualAvoid: [] }, issue: "visualAvoid has no explicit anti-patterns" },
  {
    field: "audio.instrumentation",
    candidate: { ...draft, audio: { ...draft.audio, instrumentation: [] } },
    issue: "audio.instrumentation is empty",
  },
  { field: "audio.textures", candidate: { ...draft, audio: { ...draft.audio, textures: [] } }, issue: "audio.textures is empty" },
  { field: "audio.moodArc", candidate: { ...draft, audio: { ...draft.audio, moodArc: " " } }, issue: "audio.moodArc is empty" },
  { field: "seo.titleFormula", candidate: { ...draft, seo: { ...draft.seo, titleFormula: " " } }, issue: "seo.titleFormula is empty" },
  { field: "seo.descriptionStructure", candidate: { ...draft, seo: { ...draft.seo, descriptionStructure: " " } }, issue: "seo.descriptionStructure is empty" },
  { field: "seo.playlistStrategy", candidate: { ...draft, seo: { ...draft.seo, playlistStrategy: " " } }, issue: "seo.playlistStrategy is empty" },
  { field: "audio BPM bounds", candidate: { ...draft, audio: { ...draft.audio, bpmMin: 301 } }, issue: "audio BPM bounds must stay within 30–300" },
  { field: "audio BPM order", candidate: { ...draft, audio: { ...draft.audio, bpmMin: 92, bpmMax: 72 } }, issue: "audio BPM minimum exceeds its maximum" },
  { field: "audio LUFS", candidate: { ...draft, audio: { ...draft.audio, loudnessLufs: -8 } }, issue: "audio.loudnessLufs must stay within -23 to -12 LUFS" },
  { field: "narrative.scriptStyle", candidate: { ...draft, narrative: { ...draft.narrative!, scriptStyle: " " } }, issue: "narrative.scriptStyle is empty" },
  { field: "narrative.hookStyle", candidate: { ...draft, narrative: { ...draft.narrative!, hookStyle: " " } }, issue: "narrative.hookStyle is empty" },
  { field: "narrative.pacing", candidate: { ...draft, narrative: { ...draft.narrative!, pacing: " " } }, issue: "narrative.pacing is empty" },
  { field: "narrative.voiceProfile", candidate: { ...draft, narrative: { ...draft.narrative!, voiceProfile: " " } }, issue: "narrative.voiceProfile is empty" },
  { field: "narrative.delivery", candidate: { ...draft, narrative: { ...draft.narrative!, delivery: " " } }, issue: "narrative.delivery is empty" },
];

for (const corruption of corruptions) {
  const issues = inspectStyleDNADraft(corruption.candidate, true, "The Chalk Observatory");
  assert.ok(issues.some((issue) => issue.includes(corruption.issue)), `${corruption.field} corruption must be rejected`);
}

const nonNarrated = inspectStyleDNADraft({ ...draft, narrative: undefined }, false, "The Chalk Observatory");
assert.deepEqual(nonNarrated, [], "non-narrated formats must not be forced to invent a voice profile");

console.log(`style DNA draft admission passed: valid profile plus ${corruptions.length} rejecting corruptions`);
