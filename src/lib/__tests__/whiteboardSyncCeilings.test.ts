import assert from "node:assert/strict";
import {
  hasWhiteboardSync,
  WHITEBOARD_MAX_ART_IMAGES_PER_PANEL,
  WHITEBOARD_MAX_PANELS,
  boundWhiteboardNarration,
  whiteboardImageCallCeiling,
  whiteboardNarrationCharacterCeiling,
  whiteboardPanelCount,
  whiteboardStoryboardTokenCeiling,
  whiteboardTtsProviderCallCeiling,
} from "@/lib/whiteboardSync";

// P2-5 (GOLDEN_MODULE_AUDIT_2026-08.md): "whiteboard" was never test-run
// directly. castWhiteboardSync's full orchestration needs a non-Google planner + Fish Audio
// + sealed Nano Banana Pro art credentials and shells out to Python, but its actual
// spend-bounding gates — panel count clamp, per-panel image ceiling,
// narration/TTS character ceiling — are pure, exported, and directly
// testable. This exercises those real ceilings plus the readiness gate's
// real local-renderer AND-composition.

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

assert.equal(
  whiteboardStoryboardTokenCeiling(6),
  6_600,
  "the normal six-panel board receives a dense but bounded structured-plan response budget",
);
assert.equal(whiteboardStoryboardTokenCeiling(1), 3_000, "one panel retains a useful minimum response reserve");
assert.equal(whiteboardStoryboardTokenCeiling(999), 8_000, "oversized boards cannot ask one provider response to run unbounded");

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

{
  const panel = [{
    idx: 0,
    narration: "The first phrase appears before the bounded narration ends but the visual anchor appears much later in this sentence.",
    layers: [{
      kind: "art" as const,
      draw: "a simple marker diagram",
      cue: "visual anchor appears much later",
      color: "#c0392b",
      box: [0.12, 0.18, 0.76, 0.62] as [number, number, number, number],
    }],
  }];
  assert.throws(
    () => boundWhiteboardNarration(panel, 8),
    /visual cue\(s\) outside its bounded narration/i,
    "a truncated panel must fail before it silently loses its promised visual layer",
  );
}
{
  const panel = [{
    idx: 0,
    narration: "The visual anchor arrives immediately, then the panel can explain the remaining context without losing its art.",
    layers: [{
      kind: "art" as const,
      draw: "a simple marker diagram",
      cue: "visual anchor arrives immediately",
      color: "#c0392b",
      box: [0.12, 0.18, 0.76, 0.62] as [number, number, number, number],
    }],
  }];
  assert.equal(
    boundWhiteboardNarration(panel, 8)[0]?.layers.length,
    1,
    "a cue inside the actual bounded narration retains its required visual layer",
  );
}
{
  const panel = [{
    idx: 0,
    narration: "The first visual cue is spoken before the second visual cue in this panel.",
    layers: [
      {
        kind: "art" as const,
        draw: "a later marker diagram",
        cue: "second visual cue",
        color: "#c0392b",
        box: [0.12, 0.18, 0.76, 0.62] as [number, number, number, number],
      },
      {
        kind: "label" as const,
        text: "FIRST",
        cue: "first visual cue",
        color: "#c0392b",
        box: [0.12, 0.84, 0.76, 0.08] as [number, number, number, number],
        draw: "",
      },
    ],
  }];
  assert.throws(
    () => boundWhiteboardNarration(panel, 30),
    /visual cues are out of narration order/i,
    "cue ordering must be checked before an otherwise valid plan reaches paid artwork",
  );
}

console.log("whiteboardSyncCeilings.test.ts: panel/image/narration spend ceilings verified against realistic requests");

/* ------------------------------ readiness gate ----------------------------*/
//
// hasWhiteboardSync() is the local renderer gate: it is a genuine AND across
// the required storyboard planner and Fish Audio TTS. Nano Banana Pro is
// enforced by the paid art block just before its first provider submission,
// rather than being hidden in this reusable local helper.
const GATE_VARS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "FISH_AUDIO_API_KEY", "ELEVENLABS_API_KEY"] as const;

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
  assert.equal(hasWhiteboardSync(), true, "with both local renderer dependencies configured, hasWhiteboardSync must be true");

  // Drop just the default TTS key — the planner alone must not satisfy the
  // default Fish gate.
  delete process.env.FISH_AUDIO_API_KEY;
  assert.equal(hasWhiteboardSync(), false, "missing FISH_AUDIO_API_KEY alone must fail the gate even with the storyboard planner configured");
  assert.equal(
    hasWhiteboardSync({ ttsProvider: "elevenlabs" }),
    true,
    "an explicitly selected ElevenLabs voice must not require the unrelated Fish key",
  );
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal(
    hasWhiteboardSync({ ttsProvider: "elevenlabs" }),
    false,
    "a selected ElevenLabs voice must fail closed when its own key is unavailable",
  );
  process.env.ELEVENLABS_API_KEY = "test-value";
  process.env.FISH_AUDIO_API_KEY = "test-value";

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(hasWhiteboardSync(), false, "missing the storyboard planner must fail a fresh Whiteboard storyboard run");
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  assert.equal(
    hasWhiteboardSync({ ttsProvider: "elevenlabs" }),
    true,
    "the pinned non-Google OpenRouter planner is a valid fresh-storyboard route when a direct Anthropic key is absent",
  );
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(
    hasWhiteboardSync({ requiresStoryboard: false }),
    true,
    "a sealed preplanned storyboard may use the local renderer without re-requiring a planner credential",
  );
} finally {
  restore();
}

console.log("whiteboardSyncCeilings.test.ts: hasWhiteboardSync() genuine local-renderer AND-gate verified");
