import assert from "node:assert/strict";

import { sourceProofCitationOverlayFilter } from "@/lib/ffmpeg";

// The source-proof citation compositor is intentionally a local FFmpeg seam:
// no vision, GPU, provider, or media download is needed to verify that it
// receives only sealed text and cannot fall back to an uncited no-op clip.

{
  const filter = sourceProofCitationOverlayFilter({
    label: "Regional Court Archive: Closure finding",
    durationSec: 4,
  });
  assert.ok(filter.startsWith("drawtext=fontfile="), "citation compositor must construct a local drawtext filter");
  assert.ok(filter.includes("SOURCE PROOF\\nRegional Court Archive\\: Closure finding"), "the exact sealed label must be visible with a provenance heading");
  assert.ok(filter.includes("expansion=none"), "citation text must never be evaluated as a drawtext expression");
  assert.ok(filter.includes("x=w*0.05:y=h*0.07"), "citation plate must use its own upper-left safe placement, distinct from name cards");
  assert.ok(!filter.includes("enable="), "citation must persist for the full verified source-proof clip");
  assert.ok(!filter.includes("alpha="), "citation must not fade out before final-master evidence sampling");
}

{
  const filter = sourceProofCitationOverlayFilter({
    label: "O'Brien: closure record 40%",
    durationSec: 4,
  });
  assert.ok(!filter.includes("text='O'Brien"), "literal apostrophes must be escaped before entering the filter graph");
  assert.ok(filter.includes("\\'"), "apostrophes must be preserved through a drawtext escape");
  assert.ok(filter.includes("O\\'Brien\\:"), "the source label's punctuation must remain visible, not be normalized away");
  assert.ok(filter.includes("\\%"), "literal percentages must be escaped before entering the filter graph");
}

{
  const label = "Regional Court Archive: a deliberately long source finding that must wrap without losing any sealed citation words";
  const filter = sourceProofCitationOverlayFilter({ label, durationSec: 4 });
  assert.ok(filter.includes("\\n"), "long sealed labels must wrap rather than truncate or scale to illegibility");
  for (const word of ["Regional", "Archive", "deliberately", "finding", "words"]) {
    assert.ok(filter.includes(word), `wrapped citation must retain ${word}`);
  }
}

for (const invalid of [
  { label: "", durationSec: 4 },
  { label: "   ", durationSec: 4 },
  { label: "Regional Court Archive: Closure finding", durationSec: 0 },
  { label: "Regional Court Archive: Closure finding", durationSec: Number.NaN },
]) {
  assert.throws(
    () => sourceProofCitationOverlayFilter(invalid),
    /source-proof citation overlay requires/i,
    "a missing citation or invalid duration must fail closed instead of producing an uncited copy",
  );
}

console.log("ffmpegSourceProofCitationOverlay.test.ts: source-bound citation filter is full-duration, escaped, wrapped, and fail-closed");
