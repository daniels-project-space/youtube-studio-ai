/**
 * overlaysToCuesAndSpecs unit test (tsx) — pure mapping, no I/O.
 *
 * Proves the EDL Overlay[] → (cues, specs, warnings) bridge:
 *   - caption → cue (text + window carried)
 *   - quote → spec (media path + durSec + data fields carried)
 *   - insert → spec (same shape; both ride the alpha-composite pass)
 *   - caption with no text → warning + skip (no silent drop)
 *   - quote with no renderable media → warning + skip (never fake a card)
 */
import assert from "node:assert/strict";
import { overlaysToCuesAndSpecs } from "../overlays";
import type { Overlay } from "../timeline";

function captionToCue(): void {
  const overlays: Overlay[] = [{ kind: "caption", startSec: 5, endSec: 9, text: "Hello world" }];
  const { cues, specs, warnings } = overlaysToCuesAndSpecs(overlays);
  assert.equal(cues.length, 1, "one caption → one cue");
  assert.equal(specs.length, 0, "no specs from a caption");
  assert.equal(warnings.length, 0, "valid caption → no warning");
  assert.deepEqual(cues[0], { startSec: 5, endSec: 9, text: "Hello world" }, "cue carries window + text");
  console.log("CAPTION→CUE PASS");
}

function quoteToSpec(): void {
  const overlays: Overlay[] = [
    {
      kind: "quote",
      startSec: 10,
      endSec: 18,
      src: "quote_card.webm",
      data: { text: "A real quote", highlights: ["real"], width: 1920, height: 1080, noBlur: false },
    },
  ];
  const { cues, specs, warnings } = overlaysToCuesAndSpecs(overlays);
  assert.equal(specs.length, 1, "one quote → one spec");
  assert.equal(cues.length, 0, "no cues from a quote");
  assert.equal(warnings.length, 0, "quote with media → no warning");
  const s = specs[0];
  assert.equal(s.path, "quote_card.webm", "spec.path from overlay.src");
  assert.equal(s.startSec, 10, "spec.startSec");
  assert.equal(s.durSec, 8, "spec.durSec = endSec - startSec");
  assert.equal(s.text, "A real quote", "spec carries data.text");
  assert.deepEqual(s.highlights, ["real"], "spec carries data.highlights");
  assert.equal(s.width, 1920, "spec carries data.width");
  assert.equal(s.height, 1080, "spec carries data.height");
  assert.equal(s.noBlur, false, "spec carries data.noBlur");
  console.log("QUOTE→SPEC PASS");
}

function insertToSpec(): void {
  // insert carries its media via data.path (not src) — both resolve.
  const overlays: Overlay[] = [
    { kind: "insert", startSec: 30, endSec: 45, data: { path: "chart.webm", noBlur: true } },
  ];
  const { specs, warnings } = overlaysToCuesAndSpecs(overlays);
  assert.equal(specs.length, 1, "one insert → one spec");
  assert.equal(warnings.length, 0, "insert with data.path → no warning");
  assert.equal(specs[0].path, "chart.webm", "spec.path resolves from data.path");
  assert.equal(specs[0].durSec, 15, "insert durSec");
  assert.equal(specs[0].noBlur, true, "insert noBlur carried");
  console.log("INSERT→SPEC PASS");
}

function captionNoTextWarns(): void {
  const overlays: Overlay[] = [
    { kind: "caption", startSec: 1, endSec: 3 }, // no text
    { kind: "caption", startSec: 4, endSec: 6, text: "   " }, // blank
  ];
  const { cues, warnings } = overlaysToCuesAndSpecs(overlays);
  assert.equal(cues.length, 0, "no cue from a text-less caption");
  assert.equal(warnings.length, 2, "both text-less captions warn");
  assert.ok(warnings.every((w) => /caption.*no text/.test(w)), "warning names the cause");
  console.log("CAPTION-NO-TEXT PASS: warning + skip, no silent drop");
}

function quoteNoMediaWarns(): void {
  const overlays: Overlay[] = [
    { kind: "quote", startSec: 5, endSec: 9, data: { text: "no card rendered" } }, // no src/path
    { kind: "insert", startSec: 10, endSec: 12 }, // no data at all
  ];
  const { specs, warnings } = overlaysToCuesAndSpecs(overlays);
  assert.equal(specs.length, 0, "no spec without a renderable media path");
  assert.equal(warnings.length, 2, "both media-less overlays warn");
  assert.ok(warnings.every((w) => /no renderable media path/.test(w)), "warning names the missing media");
  console.log("QUOTE-NO-MEDIA PASS: warning + skip, never faked");
}

function main(): void {
  captionToCue();
  quoteToSpec();
  insertToSpec();
  captionNoTextWarns();
  quoteNoMediaWarns();
  console.log("\nALL OVERLAYS TESTS PASSED");
}

main();
