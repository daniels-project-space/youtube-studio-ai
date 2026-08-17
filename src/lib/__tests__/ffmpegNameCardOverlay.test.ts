import assert from "node:assert/strict";
import { nameCardOverlayFilter } from "@/lib/ffmpeg";

// nameCardOverlayFilter is pure string construction (no ffmpeg process, no
// I/O) — the same testable seam filmGrainVignetteFilter uses (see
// ffmpegFilmGrainVignette.test.ts). This proves the drawtext filter-graph
// fragment applyNameCardOverlay() builds from is correct — the ffmpeg
// finishing-pass primitive backing the narrow on-screen name-card exception
// for `narrativeRole: "introduction"` beats (src/engine/cinematicCaseSequence.ts) —
// without ever shelling out to ffmpeg.

// --- 1. Empty/whitespace-only text -> empty string (no-op, filter omitted) -
{
  assert.equal(nameCardOverlayFilter({ text: "", durationSec: 5 }), "", "empty text must produce an empty filter string");
  assert.equal(nameCardOverlayFilter({ text: "   ", durationSec: 5 }), "", "whitespace-only text must produce an empty filter string");
}

// --- 2. Basic shape: drawtext with the exact reviewed text, escaped -------
{
  const expr = nameCardOverlayFilter({ text: "LEAD INVESTIGATOR — CASE FILE 118", durationSec: 5 });
  assert.ok(expr.startsWith("drawtext=fontfile="), "must build a drawtext filter");
  assert.ok(expr.includes("text='LEAD INVESTIGATOR"), "must carry the reviewed name-card text verbatim");
  assert.ok(expr.includes("expansion=none"), "expansion=none must be set so the text is never treated as a drawtext expression");
}

// --- 3. Drawtext special characters are escaped, not passed through raw ---
{
  const expr = nameCardOverlayFilter({ text: "O'Brien: Lead, 40%", durationSec: 5 });
  assert.ok(!expr.includes("text='O'Brien"), "an unescaped single quote must not reach the filter graph unescaped");
  assert.ok(!/text='[^']*:[^']*'/.test(expr) || expr.includes("\\:"), "a literal colon in the text must be escaped for the drawtext option grammar");
}

// --- 4. Fade envelope respects the clip duration ----------------------------
{
  // A very short clip (2s) with default fadeIn/fadeOut (0.5/0.6) must clamp
  // both to at most half the duration so hold-start never exceeds hold-end.
  const expr = nameCardOverlayFilter({ text: "NAME", durationSec: 2 });
  const holdStartMatch = expr.match(/lt\(t,([\d.]+)\)/);
  assert.ok(holdStartMatch, "alpha expression must contain a hold-start comparison");
  const holdStart = Number(holdStartMatch![1]);
  assert.ok(holdStart <= 1, `fadeIn must clamp to at most half of a 2s clip, got holdStart=${holdStart}`);
}

// --- 5. Position affects the x= expression ---------------------------------
{
  const center = nameCardOverlayFilter({ text: "NAME", durationSec: 5 });
  const left = nameCardOverlayFilter({ text: "NAME", durationSec: 5, position: "left" });
  const right = nameCardOverlayFilter({ text: "NAME", durationSec: 5, position: "right" });
  assert.ok(center.includes("x=(w-text_w)/2"), "default/center position must center the text");
  assert.ok(left.includes("x=w*0.08"), "left position must anchor near the left safe margin");
  assert.ok(right.includes("x=w-text_w-w*0.08"), "right position must anchor near the right safe margin");
}

// --- 6. accentColor threads through as the fontcolor, theme-driven --------
{
  const themed = nameCardOverlayFilter({ text: "NAME", durationSec: 5, accentColor: "#c81e25" });
  const untheme = nameCardOverlayFilter({ text: "NAME", durationSec: 5 });
  assert.ok(themed.includes("fontcolor=0xc81e25"), "an accentColor (e.g. DETECTIVE theme.accent) must become the drawtext fontcolor");
  assert.ok(untheme.includes("fontcolor=white"), "no accentColor must fall back to a plain white fontcolor");
}

// --- 7. fontFile override is honored instead of the CLOUD_FONTS default ---
{
  const expr = nameCardOverlayFilter({ text: "NAME", durationSec: 5, fontFile: "/opt/fonts/Oswald-Bold.ttf" });
  assert.ok(expr.includes("fontfile=/opt/fonts/Oswald-Bold.ttf"), "an explicit fontFile (e.g. a resolved Oswald .ttf) must override the default");
}

// --- 8. Non-finite/non-positive duration degrades to a safe no-op ---------
{
  assert.equal(nameCardOverlayFilter({ text: "NAME", durationSec: Number.NaN }), "", "NaN duration must degrade to an empty filter, never emit NaN into the graph");
  assert.equal(nameCardOverlayFilter({ text: "NAME", durationSec: 0 }), "", "zero duration must degrade to an empty filter");
  assert.equal(nameCardOverlayFilter({ text: "NAME", durationSec: -3 }), "", "negative duration must degrade to an empty filter");
  assert.equal(nameCardOverlayFilter({ text: "NAME", durationSec: Number.POSITIVE_INFINITY }), "", "infinite duration must degrade to an empty filter");
}

console.log(
  "ffmpegNameCardOverlay.test.ts: nameCardOverlayFilter no-op/escaping/fade-envelope/position/theme-color/fontFile/degrade-safety all verified",
);
