import assert from "node:assert/strict";

import {
  OVERLAY_TEMPLATE_IDS,
  buildOverlayComposition,
  selectEvidenceOverlayShots,
  selectAutomaticEvidenceOverlayShots,
  type OverlayCandidateShot,
  type AutomaticEvidenceOverlayShot,
} from "@/lib/hyperframesOverlay";

/* ------------------------------------------------- buildOverlayComposition -- */

// Every declared template id renders a structurally valid HyperFrames
// composition: the same #root/data-composition-id/data-start/data-duration
// wrapper and .clip/data-track-index pattern src/lib/geoCinema.ts's
// cityzoom.tpl.html establishes, plus a registered window.__timelines entry.
for (const templateId of OVERLAY_TEMPLATE_IDS) {
  const html = buildOverlayComposition({ templateId, primary: "EXHIBIT 14", secondary: "12 MAR" });
  assert.ok(html.includes('data-composition-id="main"'), `${templateId}: must declare the main composition id`);
  assert.ok(html.includes('data-track-index="1"'), `${templateId}: must place its clip on a track`);
  assert.ok(html.includes('class="ov clip"'), `${templateId}: must use the .ov .clip convention`);
  assert.ok(html.includes('window.__timelines["main"] = tl;'), `${templateId}: must register a GSAP timeline for the CLI to drive`);
  assert.ok(html.includes("EXHIBIT 14"), `${templateId}: must render the primary label`);
  assert.ok(html.includes("12 MAR"), `${templateId}: must render the secondary label`);
}

// Duration flows through to both the root wrapper and the clip.
const withDuration = buildOverlayComposition({ templateId: "case_file_stamp", primary: "X", durationSec: 3.5 });
assert.ok(withDuration.includes('data-duration="3.50"'), "durationSec must be stamped into the composition");

// Default duration is applied when omitted.
const withDefaultDuration = buildOverlayComposition({ templateId: "evidence_tag", primary: "X" });
assert.ok(withDefaultDuration.includes('data-duration="2.20"'), "a default duration must be used when durationSec is omitted");

// Secondary line is optional and omitted cleanly (no dangling secondary div),
// even though the shared <style> block still declares the .hud-secondary rule.
const noSecondary = buildOverlayComposition({ templateId: "tracking_hud", primary: "TARGET-04" });
assert.ok(!noSecondary.includes('<div class="hud-secondary'), "no secondary element should render when secondary is omitted");

// HTML-unsafe characters in labels are escaped, not passed through raw.
const unsafe = buildOverlayComposition({ templateId: "case_file_stamp", primary: "<script>alert(1)</script>", secondary: "A & B" });
assert.ok(!unsafe.includes("<script>alert(1)</script>"), "primary label must be HTML-escaped");
assert.ok(unsafe.includes("&lt;script&gt;"), "escaped primary label must appear in the output");
assert.ok(unsafe.includes("A &amp; B"), "ampersands in secondary label must be escaped");

// Custom accent color is honored.
const accented = buildOverlayComposition({ templateId: "evidence_tag", primary: "X", accent: "#ff0000" });
assert.ok(accented.includes("#ff0000"), "a custom accent color must be stamped into the composition");

console.log("hyperframesOverlay: buildOverlayComposition assertions passed");

/* ------------------------------------------------- selectEvidenceOverlayShots -- */

function shot(id: string, narrativeRole: string, coveragePurpose: string, t0: number, t1: number): OverlayCandidateShot {
  return { id, narrativeRole, coveragePurpose, t0, t1 };
}

// No candidates -> no selections.
assert.deepEqual(selectEvidenceOverlayShots([]), [], "an empty shot list must select nothing");

// A shot that is neither reveal nor contradiction is never selected, even as
// an evidence_insert.
const noEligibleRole = [shot("s1", "investigation", "evidence_insert", 0, 4)];
assert.deepEqual(selectEvidenceOverlayShots(noEligibleRole), [], "non reveal/contradiction roles must never be selected");

// A reveal/contradiction shot that is NOT an evidence_insert is never selected.
const noEligiblePurpose = [shot("s1", "reveal", "aftermath", 0, 4), shot("s2", "contradiction", "spatial_anchor", 4, 8)];
assert.deepEqual(selectEvidenceOverlayShots(noEligiblePurpose), [], "reveal/contradiction shots that are not evidence_insert must never be selected");

// A reveal + evidence_insert shot is selected with the case_file_stamp template.
const revealOnly = [shot("s-reveal", "reveal", "evidence_insert", 10, 14)];
const revealSelection = selectEvidenceOverlayShots(revealOnly);
assert.equal(revealSelection.length, 1, "one eligible reveal shot must be selected");
assert.equal(revealSelection[0]!.shotId, "s-reveal");
assert.equal(revealSelection[0]!.templateId, "case_file_stamp", "reveal beats must map to the case_file_stamp template");

// A contradiction + evidence_insert shot is selected with the evidence_tag template.
const contradictionOnly = [shot("s-contra", "contradiction", "evidence_insert", 2, 6)];
const contradictionSelection = selectEvidenceOverlayShots(contradictionOnly);
assert.equal(contradictionSelection.length, 1, "one eligible contradiction shot must be selected");
assert.equal(contradictionSelection[0]!.templateId, "evidence_tag", "contradiction beats must map to the evidence_tag template");

// Mixed eligible + ineligible candidates: only the eligible ones are chosen,
// ordered by t0.
const mixed = [
  shot("s-late", "reveal", "evidence_insert", 40, 44),
  shot("s-ineligible-role", "orientation", "evidence_insert", 5, 9),
  shot("s-ineligible-purpose", "reveal", "spatial_anchor", 6, 10),
  shot("s-early", "contradiction", "evidence_insert", 12, 16),
];
const mixedSelection = selectEvidenceOverlayShots(mixed);
assert.deepEqual(mixedSelection.map((s) => s.shotId), ["s-early", "s-late"], "only eligible shots are selected, ordered by t0");

// The default budget caps at 2 even with more eligible candidates.
const manyEligible = [
  shot("s1", "reveal", "evidence_insert", 0, 4),
  shot("s2", "contradiction", "evidence_insert", 10, 14),
  shot("s3", "reveal", "evidence_insert", 20, 24),
  shot("s4", "contradiction", "evidence_insert", 30, 34),
];
const cappedSelection = selectEvidenceOverlayShots(manyEligible);
assert.equal(cappedSelection.length, 2, "the default budget must cap at 2 selections even with more eligible shots");
assert.deepEqual(cappedSelection.map((s) => s.shotId), ["s1", "s2"], "the earliest eligible shots must win under the cap");

// A custom, lower budget is honored.
assert.equal(selectEvidenceOverlayShots(manyEligible, { maxPerVideo: 1 }).length, 1, "a custom maxPerVideo must be respected");
assert.equal(selectEvidenceOverlayShots(manyEligible, { maxPerVideo: 0 }).length, 0, "maxPerVideo: 0 must select nothing");

// Determinism: same input, same output.
assert.deepEqual(selectEvidenceOverlayShots(manyEligible), selectEvidenceOverlayShots(manyEligible), "selection must be deterministic for identical input");

console.log("hyperframesOverlay: selectEvidenceOverlayShots assertions passed");

/* ------------------------------------- selectAutomaticEvidenceOverlayShots -- */

function autoShot(id: string, coveragePurpose: string, t0: number, t1: number): AutomaticEvidenceOverlayShot {
  return { id, coveragePurpose, t0, t1 };
}

// The seven fixed Story Spine coveragePurpose sentences, verbatim from
// cinematicShotLanguage.ts's GRAMMAR table (kept inline here rather than
// imported, so this test independently pins the literal text the adapter
// depends on).
const COVERAGE = {
  establish: "place the viewer in the specific time, geography, and stakes before the action tightens",
  investigate: "make the evidence, document, trace, or physical detail readable before the narration draws a conclusion",
  reveal: "land the contradiction or newly understood fact with an unmistakable visual turn",
  escalate: "increase urgency through motivated action, unstable space, or narrowing options without inventing facts",
  consequence: "give the outcome emotional and spatial weight after the preceding action or discovery",
  human: "show the human relationship, decision, or reaction that makes the causal beat matter",
  advance: "advance the narrated cause-and-effect with a concrete changing visual state",
};

// No candidates -> no selections.
assert.deepEqual(selectAutomaticEvidenceOverlayShots([]), [], "an empty shot list must select nothing");

// The five non-evidentiary buckets are never eligible.
const nonEvidentiary = [
  autoShot("s-establish", COVERAGE.establish, 0, 4),
  autoShot("s-escalate", COVERAGE.escalate, 4, 8),
  autoShot("s-consequence", COVERAGE.consequence, 8, 12),
  autoShot("s-human", COVERAGE.human, 12, 16),
  autoShot("s-advance", COVERAGE.advance, 16, 20),
];
assert.deepEqual(
  selectAutomaticEvidenceOverlayShots(nonEvidentiary),
  [],
  "establish/escalate/consequence/human/advance coveragePurpose shots must never be selected",
);

// The "investigate" bucket (contains "evidence") maps to the evidence_tag
// template via the reconstructed "contradiction" role.
const investigateOnly = [autoShot("s-investigate", COVERAGE.investigate, 10, 14)];
const investigateSelection = selectAutomaticEvidenceOverlayShots(investigateOnly);
assert.equal(investigateSelection.length, 1, "an investigate-bucket shot must be selected");
assert.equal(investigateSelection[0]!.shotId, "s-investigate");
assert.equal(
  investigateSelection[0]!.templateId,
  "evidence_tag",
  "investigate-bucket (evidence) shots must map to the evidence_tag template",
);

// The "reveal" bucket (contains "contradiction") maps to case_file_stamp.
const revealOnlyAuto = [autoShot("s-reveal", COVERAGE.reveal, 2, 6)];
const revealSelectionAuto = selectAutomaticEvidenceOverlayShots(revealOnlyAuto);
assert.equal(revealSelectionAuto.length, 1, "a reveal-bucket shot must be selected");
assert.equal(
  revealSelectionAuto[0]!.templateId,
  "case_file_stamp",
  "reveal-bucket (contradiction) shots must map to the case_file_stamp template",
);

// Mixed: only the two evidentiary buckets are chosen, ordered by t0, capped
// at the same default budget of 2 selectEvidenceOverlayShots itself uses.
const autoMixed = [
  autoShot("s-late-reveal", COVERAGE.reveal, 40, 44),
  autoShot("s-establish-ineligible", COVERAGE.establish, 5, 9),
  autoShot("s-early-investigate", COVERAGE.investigate, 12, 16),
  autoShot("s-human-ineligible", COVERAGE.human, 20, 24),
];
const autoMixedSelection = selectAutomaticEvidenceOverlayShots(autoMixed);
assert.deepEqual(
  autoMixedSelection.map((s) => s.shotId),
  ["s-early-investigate", "s-late-reveal"],
  "only investigate/reveal coveragePurpose shots are selected, ordered by t0",
);

// Case-insensitivity: the literal substring match does not depend on case.
const upperCaseCoverage = [autoShot("s-upper", COVERAGE.investigate.toUpperCase(), 0, 4)];
assert.equal(
  selectAutomaticEvidenceOverlayShots(upperCaseCoverage).length,
  1,
  "the evidence/contradiction substring match must be case-insensitive",
);

// A custom, lower budget is honored (delegated straight through to
// selectEvidenceOverlayShots's own budget cap).
const manyEvidentiary = [
  autoShot("s1", COVERAGE.reveal, 0, 4),
  autoShot("s2", COVERAGE.investigate, 10, 14),
  autoShot("s3", COVERAGE.reveal, 20, 24),
];
assert.equal(selectAutomaticEvidenceOverlayShots(manyEvidentiary).length, 2, "the default budget must cap at 2");
assert.equal(
  selectAutomaticEvidenceOverlayShots(manyEvidentiary, { maxPerVideo: 1 }).length,
  1,
  "a custom maxPerVideo must be respected",
);

// Determinism.
assert.deepEqual(
  selectAutomaticEvidenceOverlayShots(autoMixed),
  selectAutomaticEvidenceOverlayShots(autoMixed),
  "selection must be deterministic for identical input",
);

console.log("hyperframesOverlay: selectAutomaticEvidenceOverlayShots assertions passed");
