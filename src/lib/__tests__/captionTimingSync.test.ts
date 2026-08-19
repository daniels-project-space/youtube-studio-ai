import assert from "node:assert/strict";
import { captionCuesFromTimings, captionGeometry } from "@/lib/ffmpeg";

// P2-4 (GOLDEN_MODULE_AUDIT_2026-08.md): "layer timing-sync gate inferred
// from Whisper/TTS caption-cue machinery, never asserted by a test... Add one
// assertion." captionCuesFromTimings() (ffmpeg.ts) is the deterministic core
// of that machinery: it takes ground-truth sentence timings and splits them
// into readable caption chunks whose start/end times must never drift from
// the source audio. This test asserts real numeric bounds against realistic
// inputs — including a case that WOULD silently ship drift if the
// distribution math regressed.

const EPS = 1e-9;

/* --------------------- no drift: single short sentence -------------------- */

{
  const cues = captionCuesFromTimings([{ text: "A short line.", start: 10, end: 12.5 }]);
  assert.equal(cues.length, 1, "a short sentence under the word/char caps must yield exactly one cue");
  assert.ok(Math.abs(cues[0].startSec - 10) < EPS, `cue must start exactly at the sentence start, got ${cues[0].startSec}`);
  assert.ok(Math.abs(cues[0].endSec - 12.5) < EPS, `cue must end exactly at the sentence end, got ${cues[0].endSec}`);
}

/* ------------------------- offsetSec shifts the whole timeline ------------ */

{
  const base = captionCuesFromTimings([{ text: "A short line.", start: 10, end: 12.5 }]);
  const shifted = captionCuesFromTimings([{ text: "A short line.", start: 10, end: 12.5 }], 5);
  assert.ok(Math.abs(shifted[0].startSec - (base[0].startSec + 5)) < EPS, "offsetSec must shift the cue start by exactly the offset");
  assert.ok(Math.abs(shifted[0].endSec - (base[0].endSec + 5)) < EPS, "offsetSec must shift the cue end by exactly the offset");
}

/* --------- minimum-duration floor: a near-zero window still gets 0.4s ----- */
//
// captionCuesFromTimings enforces `dur = Math.max(0.4, end - start)` so a
// mistimed/near-instant ASR window never produces a caption that flashes
// faster than a viewer can read. This is a real, deliberate part of the sync
// contract — a regression that drops the floor would silently ship unreadable
// captions.

{
  const cues = captionCuesFromTimings([{ text: "Blink.", start: 1, end: 1.05 }]);
  assert.equal(cues.length, 1);
  const dur = cues[0].endSec - cues[0].startSec;
  assert.ok(Math.abs(dur - 0.4) < EPS, `a near-zero-duration timing must be floored to 0.4s on screen, got ${dur}`);
  assert.ok(Math.abs(cues[0].startSec - 1) < EPS, "the floored cue must still start exactly at the sentence start");
}

/* ------- multi-chunk sentence: cues are contiguous, no gap, no overlap ---- */

{
  const longText =
    "This sentence has considerably more than seven words and more than forty two characters so it must split into multiple caption chunks";
  const start = 100;
  const end = 112;
  const dur = end - start;
  const cues = captionCuesFromTimings([{ text: longText, start, end }]);
  assert.ok(cues.length >= 2, `a long sentence must split into multiple chunks, got ${cues.length}`);

  // Head: first chunk starts exactly at the sentence start (no lead-in drift).
  assert.ok(Math.abs(cues[0].startSec - start) < EPS, `first chunk must start at ${start}, got ${cues[0].startSec}`);
  // Tail: last chunk ends exactly at the sentence end (no trailing drift).
  const last = cues[cues.length - 1];
  assert.ok(Math.abs(last.endSec - end) < EPS, `last chunk must end at ${end}, got ${last.endSec}`);

  // Contiguity: consecutive chunks must never gap or overlap — a viewer must
  // never see dead air or a jump-cut mid-sentence.
  for (let i = 1; i < cues.length; i++) {
    assert.ok(
      Math.abs(cues[i].startSec - cues[i - 1].endSec) < 1e-6,
      `chunk ${i} must start exactly where chunk ${i - 1} ended (no gap/overlap): prev end=${cues[i - 1].endSec}, this start=${cues[i].startSec}`,
    );
  }

  // The full sentence window's time budget is exactly spent, not over/under
  // allocated (the actual "drift beyond tolerance" this gate exists to catch).
  const totalAllocated = last.endSec - cues[0].startSec;
  assert.ok(Math.abs(totalAllocated - dur) < EPS, `total allocated caption time must equal the sentence duration ${dur}, got ${totalAllocated}`);

  // Word/char caps respected per chunk (default maxWords=7, maxChars=42) —
  // a caption that blows past this reads as an illegible wall of text.
  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 7, `chunk "${cue.text}" has ${words.length} words, exceeds the 7-word cap`);
  }
}

/* --------------------- multiple sentences never bleed together ------------ */

{
  const timings = [
    { text: "First sentence here.", start: 0, end: 2 },
    { text: "Second sentence follows.", start: 2, end: 4.5 },
  ];
  const cues = captionCuesFromTimings(timings);
  assert.equal(cues.length, 2, "two short, distinct sentences must produce two independent cues");
  assert.ok(Math.abs(cues[0].endSec - 2) < EPS, "first sentence's cue must end exactly at its own sentence boundary");
  assert.ok(Math.abs(cues[1].startSec - 2) < EPS, "second sentence's cue must start exactly at its own sentence boundary, not drift from the first");
  assert.ok(Math.abs(cues[1].endSec - 4.5) < EPS);
}

/* -------------------------- empty text is skipped, not zeroed ------------- */

{
  const cues = captionCuesFromTimings([
    { text: "   ", start: 0, end: 1 },
    { text: "Real line.", start: 1, end: 2 },
  ]);
  assert.equal(cues.length, 1, "a whitespace-only timing must be skipped entirely, not emitted as an empty/zero-length cue");
  assert.ok(Math.abs(cues[0].startSec - 1) < EPS);
}

/* ------------- portrait captions must FIT the frame, not clip off it ------- */

// Regression guard for the 9:16 caption-clipping defect: burnCaptions/
// writeCaptionsAss derived Fontsize from HEIGHT only, so 1080x1920 produced a
// 102px font with 908px of usable width while a full-budget cue needs ~2.8x
// that. With WrapStyle:2 (no auto-wrap) the overflow was CLIPPED at both frame
// edges — every portrait Short shipped half-legible captions. Assert the
// widest cue captionCuesFromTimings() can emit still fits the usable width.

// Conservative DejaVu Sans Bold advance, averaged over mixed-case text. The
// real burn measured ~0.55em; 0.60 keeps the assertion pessimistic.
const EM_ADVANCE = 0.6;
const MAX_CHARS = 42; // captionCuesFromTimings' default char budget

{
  // Widest cue the splitter can emit: MAX_CHARS of text on one line.
  const worstCase = "M".repeat(MAX_CHARS);
  const cues = captionCuesFromTimings([{ text: worstCase, start: 0, end: 3 }]);
  assert.ok(
    cues.every((c) => c.text.length <= MAX_CHARS),
    `no cue may exceed the ${MAX_CHARS}-char budget the geometry is sized against`,
  );

  for (const [label, W, H, maxLines] of [
    ["portrait 9:16", 1080, 1920, 2],
    ["landscape 16:9", 1920, 1080, 1],
  ] as const) {
    const g = captionGeometry(W, H);

    assert.ok(g.availableWidth > 0, `${label}: side margins must leave usable width`);
    assert.ok(
      g.fontSize > 0 && g.fontSize < H * 0.12,
      `${label}: font ${g.fontSize} must be sane for a ${W}x${H} frame`,
    );

    // THE BUG: a full-budget cue rendered wider than the frame allows and,
    // with wrapping disabled, was clipped instead of wrapped.
    const widestLinePx = MAX_CHARS * g.fontSize * EM_ADVANCE;
    const linesNeeded = Math.ceil(widestLinePx / g.availableWidth);
    assert.ok(
      linesNeeded <= maxLines,
      `${label}: worst-case ${MAX_CHARS}-char cue needs ${linesNeeded} lines ` +
      `(font ${g.fontSize}px, usable ${g.availableWidth}px) — must stay within ${maxLines}. ` +
      `Height-only sizing regressed: portrait must size off WIDTH.`,
    );

    // Captions must never be laid out past the frame edges.
    assert.ok(
      g.sideM > 0 && 2 * g.sideM < W,
      `${label}: side margin ${g.sideM} must sit inside the ${W}px frame`,
    );
    assert.equal(g.availableWidth, W - 2 * g.sideM, `${label}: usable width must be frame minus both margins`);
  }
}

{
  // Orientation branch is real: the same frame area sized differently.
  const portrait = captionGeometry(1080, 1920);
  const landscape = captionGeometry(1920, 1080);
  assert.equal(portrait.portrait, true, "1080x1920 must be detected as portrait");
  assert.equal(landscape.portrait, false, "1920x1080 must be detected as landscape");

  // Landscape must NOT regress — these are the pre-fix, visually-verified values.
  assert.equal(landscape.fontSize, 57, "landscape font must stay 0.053*H = 57px (no regression)");
  assert.equal(landscape.sideM, 154, "landscape side margin must stay 0.08*W = 154px (no regression)");

  // Portrait must use the validated width-derived sizing, NOT 0.053*H = 102px.
  assert.equal(portrait.fontSize, 66, "portrait font must be 0.053*W*1.15 = 66px, not the clipping 102px");
  assert.ok(
    portrait.fontSize < Math.round(1920 * 0.053),
    "portrait font must be smaller than the old height-derived size that caused clipping",
  );
  assert.equal(portrait.sideM, 65, "portrait side margin must be the tighter 0.06*W = 65px");
}

console.log("captionTimingSync.test.ts: captionCuesFromTimings() head/tail/contiguity drift bounds verified against realistic Whisper-style timing windows");
console.log("captionTimingSync.test.ts: captionGeometry() portrait/landscape caption fit verified — worst-case cue stays inside the frame in both orientations");
