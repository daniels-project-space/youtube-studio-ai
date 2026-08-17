import assert from "node:assert/strict";
import { filmGrainVignetteFilter } from "@/lib/ffmpeg";

// filmGrainVignetteFilter is pure string construction (no ffmpeg process, no
// I/O) — exactly the seam the repo's other ffmpeg tests avoid invoking real
// video through (see footagecraftGateClip.test.ts for the analogous
// degrade-safe-branch pattern elsewhere in src/lib/__tests__). This proves
// the filter-graph fragment composeWithIntro's new `filmGrain` option and
// applyFilmGrainVignette() both build from is correct, without ever
// shelling out to ffmpeg.

// --- 1. Both zero -> empty string (no-op, filter omitted entirely) --------
{
  const expr = filmGrainVignetteFilter(0, 0);
  assert.equal(expr, "", "grain=0, vignette=0 must produce an empty filter string, not a zero-strength no-op filter");
}

// --- 2. Grain only ----------------------------------------------------------
{
  const expr = filmGrainVignetteFilter(0.1, 0);
  assert.equal(expr, "noise=alls=4:allf=t+u", "grain=0.1 must map to noise alls=round(0.1*40)=4 with temporal+uniform flags");
  assert.ok(!expr.includes("vignette"), "vignette=0 must not add a vignette filter");
}

// --- 3. Vignette only --------------------------------------------------------
{
  const expr = filmGrainVignetteFilter(0, 1);
  assert.ok(!expr.includes("noise"), "grain=0 must not add a noise filter");
  assert.match(expr, /^vignette=angle=\d+\.\d{4}:mode=forward$/, "vignette filter must carry an angle= and mode=forward");
  // strength 1 (max) must map to the STRONG end of the angle range (PI/8 ≈ 0.3927)
  const angle = Number(expr.match(/angle=([\d.]+)/)![1]);
  assert.ok(Math.abs(angle - Math.PI / 8) < 0.001, `vignette=1 must map to angle≈PI/8 (${(Math.PI / 8).toFixed(4)}), got ${angle}`);
}

// --- 4. Both present -> comma-chained in a single fragment -----------------
{
  const expr = filmGrainVignetteFilter(0.09, 0.74);
  const parts = expr.split(",");
  assert.equal(parts.length, 2, "grain+vignette must produce exactly two comma-chained filters");
  assert.ok(parts[0]!.startsWith("noise=alls="), "noise filter must come first");
  assert.ok(parts[1]!.startsWith("vignette=angle="), "vignette filter must come second");
}

// --- 5. Weak vignette (near 0) maps toward the WEAK end (PI/2) -------------
{
  const expr = filmGrainVignetteFilter(0, 0.01);
  const angle = Number(expr.match(/angle=([\d.]+)/)![1]);
  assert.ok(angle > Math.PI / 2 - 0.05, `vignette≈0 must map close to the weak PI/2 end, got angle=${angle}`);
}

// --- 6. Inputs are clamped to [0,1] and non-finite inputs degrade to 0 -----
{
  const overOne = filmGrainVignetteFilter(5, -3);
  const atMax = filmGrainVignetteFilter(1, 0);
  assert.equal(overOne, atMax, "grain=5 (out of range) must clamp to the same result as grain=1; vignette=-3 must clamp to 0 (no vignette filter)");
  assert.ok(!overOne.includes("vignette"), "clamped vignette=-3 -> 0 must omit the vignette filter");

  const nan = filmGrainVignetteFilter(Number.NaN, Number.POSITIVE_INFINITY);
  assert.equal(nan, "", "non-finite grain/vignette must degrade to 0/0 (empty filter), never throw or emit NaN into the graph");
}

// --- 7. alls is always a whole integer (ffmpeg noise= requires int) --------
{
  for (const g of [0.05, 0.13, 0.37, 0.91]) {
    const expr = filmGrainVignetteFilter(g, 0);
    const alls = expr.match(/alls=(\d+)/)?.[1];
    assert.ok(alls !== undefined && /^\d+$/.test(alls), `alls must be a plain integer for grain=${g}, got "${alls}"`);
  }
}

console.log(
  "ffmpegFilmGrainVignette.test.ts: filmGrainVignetteFilter no-op/grain-only/vignette-only/combined/clamping/int-safety all verified",
);
