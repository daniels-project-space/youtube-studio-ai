/**
 * A whiteboard layer must be drawable, and that must be decided before paying.
 *
 * The layer schema validates that `box` is four FINITE numbers and stops there.
 * Nothing bounded it to the board, so [1.5, 0.2, 0.8, 0.6] passed every check
 * and drew entirely outside the frame — the panel silently lost that layer
 * after an attested image worker had already rendered it. The function meant to
 * protect against this was called clampBox and did not clamp: it mapped the
 * array to Number and returned it unchanged.
 *
 * Two lines of defence, in the right order:
 *
 *   whiteboardStoryboardDefects  rejects it in the TEXT-only planning loop,
 *                                where the fix costs a rewrite, not a render
 *   clampBox                     makes whatever still reaches the renderer
 *                                drawable instead of dropping it
 *
 * Also pinned here: repeated narration is caught ANYWHERE in the board. The
 * previous check compared each panel only with the one before it, so panels 1
 * and 5 could ship the same spoken line.
 */
import assert from "node:assert/strict";

import { whiteboardStoryboardDefects } from "@/trigger/blocks/whiteboardScribeBlocks";

type Layer = { kind: "art" | "label"; role?: string; draw?: string; text?: string; cue: string; box?: number[] };
type Panel = { narration: string; layers: Layer[] };

const NARRATION = "This is a full spoken line of narration that easily clears the eight word floor.";

/**
 * A panel that satisfies every PRE-EXISTING check, so any defect a case below
 * produces is the new one. The Golden whiteboard grammar wants one hero, two
 * evidence drawings, a fourth drawing, and a handwritten label — five visual
 * events — which the first version of this fixture did not have, and the
 * baseline assertion caught that immediately.
 */
const HERO: Layer = { kind: "art", role: "hero", draw: "a composed causal scene", cue: "full spoken line", box: [0.05, 0.2, 0.4, 0.5] };
function panel(overrides: Partial<Panel> = {}): Panel {
  return {
    narration: NARRATION,
    layers: [
      { ...HERO },
      { kind: "art", role: "evidence", draw: "a supporting diagram", cue: "narration that", box: [0.5, 0.2, 0.2, 0.2] },
      { kind: "art", role: "evidence", draw: "a second supporting drawing", cue: "easily clears", box: [0.5, 0.45, 0.2, 0.2] },
      { kind: "art", role: "evidence", draw: "a fourth meaningful drawing", cue: "eight word", box: [0.75, 0.2, 0.2, 0.2] },
      { kind: "label", text: "42", cue: "word floor", box: [0.75, 0.5, 0.2, 0.1] },
    ],
    ...overrides,
  };
}

/** The baseline layers with ONE art box replaced, so only that box is on trial. */
function withHeroBox(box: number[]): Panel {
  const base = panel();
  return { ...base, layers: [{ ...HERO, box }, ...base.layers.slice(1)] };
}

const board = (panels: Panel[]) =>
  ({ title: "A board", panels } as unknown as Parameters<typeof whiteboardStoryboardDefects>[0]);

/**
 * Only the defects THIS test is about.
 *
 * The Golden whiteboard grammar also enforces drawing-time pacing — five layers
 * declare ~26s of hand drawing, so a panel needs roughly that much narration —
 * and satisfying it here would make every fixture about pacing instead of about
 * board bounds. Those checks have their own coverage; scoping keeps a failure
 * here unambiguous.
 */
const MINE = /outside the board|zero or negative size|repeat the same narration/;
const defects = (panels: Panel[]) =>
  whiteboardStoryboardDefects(board(panels), panels.length, 0).filter((issue) => MINE.test(issue));

/* ------------------------------ the baseline ------------------------------ */

assert.deepEqual(
  defects([panel(), panel({ narration: `${NARRATION} And a second, different line.` })]),
  [],
  "a board with in-bounds boxes and distinct narration must raise none of THESE defects, " +
    "or every case below is meaningless",
);

/* ------------------------------- off-board -------------------------------- */

for (const [label, box] of [
  ["past the right edge", [0.6, 0.2, 0.8, 0.5]],
  ["past the bottom edge", [0.1, 0.6, 0.5, 0.8]],
  ["negative x", [-0.4, 0.2, 0.5, 0.5]],
  ["negative y", [0.1, -0.3, 0.5, 0.5]],
  ["wholly outside", [1.5, 0.2, 0.8, 0.6]],
] as const) {
  const found = defects([withHeroBox([...box])]);
  assert.ok(
    found.some((issue) => /outside the board/.test(issue)),
    `${label} must be rejected before rendering; got ${JSON.stringify(found)}`,
  );
}

// Zero and negative sizes draw nothing at all, and say so distinctly — "outside
// the board" would send the writer to fix the wrong number.
for (const box of [[0.1, 0.2, 0, 0.5], [0.1, 0.2, 0.5, 0], [0.1, 0.2, -0.3, 0.5]]) {
  const found = defects([withHeroBox(box)]);
  assert.ok(
    found.some((issue) => /zero or negative size/.test(issue)),
    `a ${JSON.stringify(box)} box must be reported as unsizable, not as off-board`,
  );
}

/* --------------------------- edges are allowed ---------------------------- */

// Exactly filling the board is correct, not a defect, and a hair over is a
// rounding artefact rather than a mistake.
// The last two genuinely EXCEED 1 and are forgiven only by the tolerance. The
// first version of this list used [0.005,0.005,0.99,0.99], which sums to 0.995
// and needs no tolerance at all — so removing EPS left the test passing, and the
// mutation exposed that the tolerance was unpinned.
for (const box of [[0, 0, 1, 1], [0.2, 0.2, 0.8, 0.8], [0.01, 0.01, 1, 1], [0, 0, 1.015, 1.015]]) {
  assert.deepEqual(
    defects([withHeroBox(box)]),
    [],
    `a box of ${JSON.stringify(box)} fits the board and must pass`,
  );
}

/* ------------------------- repeats, anywhere on the board ----------------- */

const first = panel();
const middle = panel({ narration: `${NARRATION} A genuinely different second line.` });
const repeat = panel();
const found = defects([first, middle, middle, repeat]);
assert.ok(
  found.some((issue) => /panels 1 and 4 repeat/.test(issue)),
  `a repeat FOUR panels apart must be caught, not just an adjacent one; got ${JSON.stringify(found)}`,
);
assert.ok(
  found.some((issue) => /panels 2 and 3 repeat/.test(issue)),
  "an adjacent repeat must still be caught",
);

console.log("WHITEBOARD BOARD BOUNDS PASS — off-board layers and distant repeats are caught before paying");
