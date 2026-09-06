/**
 * A subtitle must not outlive the picture.
 *
 * captions builds its cues from the narration clock shifted by introSec, while
 * the master is assembled separately. `videoDurationSec` sat in the block's
 * `consumes` and was read nowhere — found by scripts/audit-inert-consumes.ts —
 * so nothing connected the two and nothing checked that the last cue ended
 * before the video did.
 *
 * The severity is the point. Clamping is correct; refusing a finished render
 * over a caption tail is not, and neither is silently shipping subtitles that
 * run past the end. Every case below pins one of those three outcomes.
 */
import assert from "node:assert/strict";

import { captionCuesWithinMaster } from "@/trigger/blocks/narratedBlocks";
import type { CaptionCue } from "@/lib/ffmpeg";

const cue = (startSec: number, endSec: number, text = "line"): CaptionCue => ({ startSec, endSec, text });

/* ------------------------------ the happy case ---------------------------- */

const inside = [cue(0, 2), cue(2, 4), cue(4, 6)];
const fitted = captionCuesWithinMaster(inside, 10);
assert.deepEqual(fitted.cues, inside, "cues that fit must pass through untouched");
assert.equal(fitted.dropped, 0);
assert.equal(fitted.clamped, 0);
assert.equal(fitted.overrunSec, 0, "no overrun means nothing to report");

/* ------------------------------- the tail --------------------------------- */

// A cue straddling the end is clamped, not dropped: its words are still spoken.
const straddling = captionCuesWithinMaster([cue(0, 2), cue(2, 6)], 5);
assert.equal(straddling.cues.length, 2, "a cue that starts before the end must survive");
assert.equal(straddling.cues[1]!.endSec, 5, "its end must be clamped to the master");
assert.equal(straddling.cues[1]!.startSec, 2, "clamping must not move the start");
assert.equal(straddling.clamped, 1);
assert.equal(straddling.dropped, 0);
assert.equal(Number(straddling.overrunSec.toFixed(3)), 1, "the overrun must be reported for the log");

/* ---------------------------- past the end -------------------------------- */

// A cue that begins after the video has ended is not a subtitle; clamping it
// would produce a zero-length cue, which is worse than dropping it.
const past = captionCuesWithinMaster([cue(0, 2), cue(6, 8), cue(8, 10)], 5);
assert.equal(past.cues.length, 1, "cues starting after the end must be dropped");
assert.equal(past.dropped, 2);
assert.equal(past.clamped, 0);
assert.equal(past.overrunSec, 5, "the overrun is measured from the LAST cue, not the first dropped one");
for (const c of past.cues) {
  assert.ok(c.endSec > c.startSec, "no zero-length cue may survive");
}

/* --------------------------- unknown master ------------------------------- */

// Guessing a duration would be worse than not checking. 0, NaN and a negative
// all mean "unknown", and all must pass the cues through unchanged.
for (const unusable of [0, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
  const untouched = captionCuesWithinMaster([cue(0, 2), cue(2, 99)], unusable);
  assert.equal(
    untouched.cues.length,
    2,
    `an unusable master duration (${unusable}) must not drop cues`,
  );
  assert.equal(untouched.dropped, 0);
  assert.equal(untouched.clamped, 0);
  assert.equal(untouched.overrunSec, 0, "an unknown master cannot report an overrun");
}

/* ------------------------------ ordering ---------------------------------- */

// Clamping must not reorder or duplicate.
const many = Array.from({ length: 20 }, (_, i) => cue(i, i + 1, `cue ${i}`));
const trimmed = captionCuesWithinMaster(many, 12.5);
assert.equal(trimmed.cues.length, 13, "12 whole cues plus the one straddling 12.5");
assert.deepEqual(
  trimmed.cues.map((c) => c.text),
  many.slice(0, 13).map((c) => c.text),
  "surviving cues must keep their original order and text",
);
for (let i = 1; i < trimmed.cues.length; i++) {
  assert.ok(trimmed.cues[i]!.startSec >= trimmed.cues[i - 1]!.startSec, "cues must stay ordered");
}

console.log("CAPTIONS FIT MASTER PASS — no subtitle outlives the picture, and no render fails over one");
