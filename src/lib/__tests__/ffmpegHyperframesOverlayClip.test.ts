import assert from "node:assert/strict";
import { hyperframesOverlayCompositeFilter } from "@/lib/ffmpeg";

// hyperframesOverlayCompositeFilter is pure string construction (no ffmpeg
// process, no I/O) — the same testable seam nameCardOverlayFilter/
// filmGrainVignetteFilter use (see ffmpegNameCardOverlay.test.ts). This
// proves the overlay filter-graph fragment applyHyperframesOverlayClip()
// builds from is correct, without ever shelling out to ffmpeg.

// --- 1. Non-finite/non-positive duration degrades to a safe no-op ---------
{
  assert.equal(hyperframesOverlayCompositeFilter({ durationSec: Number.NaN }), "", "NaN duration must degrade to an empty filter");
  assert.equal(hyperframesOverlayCompositeFilter({ durationSec: 0 }), "", "zero duration must degrade to an empty filter");
  assert.equal(hyperframesOverlayCompositeFilter({ durationSec: -2 }), "", "negative duration must degrade to an empty filter");
  assert.equal(
    hyperframesOverlayCompositeFilter({ durationSec: Number.POSITIVE_INFINITY }),
    "",
    "infinite duration must degrade to an empty filter",
  );
}

// --- 2. Basic shape: alpha-honoring decode + timed overlay ----------------
{
  const filter = hyperframesOverlayCompositeFilter({ durationSec: 2.2 });
  assert.ok(filter.includes("[1:v]format=yuva420p"), "the overlay input must be forced to yuva420p so its WebM alpha channel is honored");
  assert.ok(filter.includes("[0:v][ov]overlay=0:0:"), "the base clip must be overlaid with the alpha-honored overlay input");
  assert.ok(filter.includes("eof_action=pass"), "overlay must pass through once the (shorter) overlay input ends");
  assert.ok(filter.includes("[vout]"), "the filter graph must label its output [vout] for -map");
}

// --- 3. Duration threads into the enable window, from t=0 -----------------
{
  const filter = hyperframesOverlayCompositeFilter({ durationSec: 1.5 });
  assert.ok(filter.includes("between(t,0,1.500)"), "the overlay must be enabled only from t=0 through the given duration");
}

// --- 4. A tiny sub-0.1s duration is floored, never emitted as-is ----------
{
  const filter = hyperframesOverlayCompositeFilter({ durationSec: 0.001 });
  assert.ok(filter.includes("between(t,0,0.100)"), "a sub-0.1s duration must be floored to 0.1s, never left as a near-zero window");
}

console.log("ffmpegHyperframesOverlayClip.test.ts: hyperframesOverlayCompositeFilter no-op/shape/duration/floor assertions passed");
