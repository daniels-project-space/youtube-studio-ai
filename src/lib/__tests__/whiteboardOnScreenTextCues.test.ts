import assert from "node:assert/strict";

import { buildWhiteboardOnScreenTextCues } from "@/lib/whiteboardOnScreenTextCues";

const cues = buildWhiteboardOnScreenTextCues({
  durationMs: 8_000,
  panels: [
    {
      idx: 0,
      startMs: 0,
      endMs: 3_000,
      layers: [
        { kind: "art", cueStartMs: 200 },
        { kind: "label", text: "Water clock", cueStartMs: 500 },
        { kind: "label", text: "Second label", cueStartMs: 1_500 },
      ],
    },
    {
      idx: 1,
      startMs: 3_000,
      endMs: 7_000,
      layers: [
        { kind: "label", text: "Single", cueStartMs: 3_500 },
        { kind: "label", text: "Canal schedule", cueStartMs: 4_000 },
      ],
    },
  ],
});

assert.deepEqual(
  cues.map((cue) => ({ id: cue.id, expectedText: cue.expectedText })),
  [
    { id: "whiteboard.panel-0.label", expectedText: "Water clock" },
    { id: "whiteboard.panel-1.label", expectedText: "Canal schedule" },
  ],
  "each text-bearing panel gets one deterministic, substantial OCR anchor",
);
assert.ok(cues.every((cue) => cue.sampleSec >= 0 && cue.sampleSec < 7));

assert.throws(
  () => buildWhiteboardOnScreenTextCues({
    durationMs: 5_000,
    panels: [{
      idx: 0,
      startMs: 0,
      endMs: 5_000,
      layers: [{ kind: "label", text: "Too late", cueStartMs: 4_500 }],
    }],
  }),
  /only 500ms for final-master OCR review/,
  "unreviewable instructional text must fail rather than silently omit proof",
);

assert.throws(
  () => buildWhiteboardOnScreenTextCues({
    durationMs: 5_000,
    panels: [
      { idx: 0, startMs: 0, endMs: 1_000, layers: [] },
      { idx: 0, startMs: 1_000, endMs: 2_000, layers: [] },
    ],
  }),
  /indexes must be unique/,
);

console.log("Whiteboard on-screen text cue derivation tests passed");
