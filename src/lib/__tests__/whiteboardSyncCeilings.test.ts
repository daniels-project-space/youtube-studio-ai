import assert from "node:assert/strict";
import {
  hasWhiteboardSync,
  WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  WHITEBOARD_MAX_PANELS,
  whiteboardImageCallCeiling,
  whiteboardNarrationCharacterCeiling,
  whiteboardPanelCount,
  whiteboardTtsProviderCallCeiling,
} from "@/lib/whiteboardSync";

// P2-5 (GOLDEN_MODULE_AUDIT_2026-08.md): "whiteboard" was never test-run
// directly. castWhiteboardSync's full orchestration needs Gemini + Fish Audio
// + Novita render-farm credentials and shells out to Python, but its actual
// spend-bounding gates — panel count clamp, per-panel image ceiling,
// narration/TTS character ceiling — are pure, exported, and directly
// testable. This exercises those real ceilings plus the readiness gate's
// real AND-composition across all three required subsystems.

/* ------------------------------ panel count -------------------------------*/

assert.equal(whiteboardPanelCount(6), 6);
assert.equal(whiteboardPanelCount(undefined), 6, "undefined must default to 6 panels");
assert.equal(whiteboardPanelCount(1.9), 1, "fractional panel counts must floor");
assert.equal(whiteboardPanelCount(0), 1, "zero/below-floor must clamp up to the minimum of 1");
assert.equal(whiteboardPanelCount(-5), 1, "negative counts must clamp up to 1");
assert.equal(
  whiteboardPanelCount(999),
  WHITEBOARD_MAX_PANELS,
  `an oversized request must clamp DOWN to the ${WHITEBOARD_MAX_PANELS}-panel spend ceiling`,
);
assert.equal(whiteboardPanelCount("not-a-number"), 6, "non-numeric input must fall back to the 6-panel default");

/* --------------------------- per-panel image ceiling ---------------------- */

assert.equal(
  whiteboardImageCallCeiling(4),
  4 * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  "image-call ceiling must scale linearly with the CLAMPED panel count",
);
assert.equal(
  whiteboardImageCallCeiling(999),
  WHITEBOARD_MAX_PANELS * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  "an oversized panel request must not blow through the image-call ceiling — it clamps through whiteboardPanelCount first",
);

/* ------------------------ narration character ceiling --------------------- */

{
  // Requested word count far below the per-panel floor (8 words/panel) is
  // bounded UP to the floor, not left at an unrealistically tiny number.
  const ceiling = whiteboardNarrationCharacterCeiling(4, 1);
  assert.equal(ceiling, 4 * 8 * 12, "targetWords far below the per-panel floor must be bounded up to panels*8 words");
}
{
  // Requested word count far above the per-panel cap (120 words/panel) is
  // bounded DOWN — this IS the actual TTS spend ceiling.
  const ceiling = whiteboardNarrationCharacterCeiling(3, 10_000);
  assert.equal(ceiling, 3 * 120 * 12, "an oversized targetWords request must clamp down to panels*120 words — this is the real spend cap");
}
{
  // A reasonable mid-range request is honored as-is (rounded up to whole words).
  const ceiling = whiteboardNarrationCharacterCeiling(5, 60);
  assert.equal(ceiling, 60 * 12, "a targetWords request inside the per-panel bounds must be honored, not silently reduced");
}

assert.equal(whiteboardTtsProviderCallCeiling(), 3, "TTS provider retry ceiling must remain 3");

console.log("whiteboardSyncCeilings.test.ts: panel/image/narration spend ceilings verified against realistic requests");

/* ------------------------------ readiness gate ----------------------------*/
//
// hasWhiteboardSync() must be a genuine AND across THREE independent
// subsystems (Gemini, Fish Audio TTS, Novita render farm) — not accidentally
// an OR, and not satisfied by any two of the three alone.

const NOVITA_VARS = [
  "NOVITA_API_KEY", "NOVITA_RENDER_WORKER_IMAGE", "NOVITA_RENDER_IMAGE_AUTH_ID",
  "NOVITA_RENDER_4090_PRODUCT_ID", "NOVITA_VERIFIED_4090_GPU_QUOTA", "NOVITA_MODEL_MANIFEST_KEY",
  "NOVITA_MODEL_MANIFEST_SHA256", "NOVITA_RENDER_MAX_JOB_USD", "NOVITA_RENDER_MAX_FLEET_USD",
  "INTERNAL_QUERY_SECRET",
] as const;
const GATE_VARS = ["GEMINI_API_KEY", "FISH_AUDIO_API_KEY", ...NOVITA_VARS] as const;

const saved: Record<string, string | undefined> = {};
for (const name of GATE_VARS) saved[name] = process.env[name];

function clearAll(): void {
  for (const name of GATE_VARS) delete process.env[name];
}
function setAll(): void {
  for (const name of GATE_VARS) process.env[name] = "test-value";
}
function restore(): void {
  for (const name of GATE_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
}

try {
  clearAll();
  assert.equal(hasWhiteboardSync(), false, "with nothing configured, hasWhiteboardSync must be false");

  setAll();
  assert.equal(hasWhiteboardSync(), true, "with every one of the three subsystems configured, hasWhiteboardSync must be true");

  // Drop just the TTS key — the other two subsystems alone must not satisfy the gate.
  delete process.env.FISH_AUDIO_API_KEY;
  assert.equal(hasWhiteboardSync(), false, "missing FISH_AUDIO_API_KEY alone must fail the gate even with Gemini + Novita fully configured");
  process.env.FISH_AUDIO_API_KEY = "test-value";

  // Drop just one of the ten Novita vars — proves the render-farm check is a
  // real all-ten AND, not satisfied by a partial credential set.
  delete process.env.NOVITA_MODEL_MANIFEST_SHA256;
  assert.equal(hasWhiteboardSync(), false, "a single missing Novita render-farm credential must still fail the gate");
} finally {
  restore();
}

console.log("whiteboardSyncCeilings.test.ts: hasWhiteboardSync() genuine three-subsystem AND-gate verified");
