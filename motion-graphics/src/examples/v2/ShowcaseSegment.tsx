/**
 * ShowcaseSegment — the combined ~29s recreation of the 29:24-30:00 segment.
 *
 * Sequences the beats SlideWords -> Map -> HATRED -> Scrolls with BRIEF (~7
 * frame) CHROMATIC-ABERRATION / RGB-SPLIT GLITCH TRANSITIONS between each (the
 * #1 pro element) + a fast micro-zoom and motion blur. Demonstrates pacing.
 *
 * Each beat reuses the V2 comp components. The glitch transition wraps the cut
 * point: aberration spikes at the boundary then settles. Deterministic.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { KtSlideWordsV2 } from "./KtSlideWordsV2";
import { MapArcRoutesV2 } from "./MapArcRoutesV2";
import { KtMetalSliceV2 } from "./KtMetalSliceV2";
import { KtScrollUnfurlV2 } from "./KtScrollUnfurlV2";
import { ChromaSplit, glitchEnvelope, Scanlines } from "./_shared";

// Beat durations (frames @30fps). Total ~ 4*~160 minus overlaps.
const D1 = 150; // SlideWords
const D2 = 140; // Map
const D3 = 130; // HATRED
const D4 = 165; // Scrolls
const XF = 8; // glitch overlap window

const beats = [
  { from: 0, dur: D1, C: KtSlideWordsV2 },
  { from: D1 - XF, dur: D2, C: MapArcRoutesV2 },
  { from: D1 - XF + D2 - XF, dur: D3, C: KtMetalSliceV2 },
  { from: D1 - XF + D2 - XF + D3 - XF, dur: D4, C: KtScrollUnfurlV2 },
];

export const SHOWCASE_DURATION =
  D1 + (D2 - XF) + (D3 - XF) + (D4 - XF);

/** Cut points where the glitch transition fires (global frames). */
const CUTS = [D1 - XF, D1 - XF + D2 - XF, D1 - XF + D2 - XF + D3 - XF];

const GlitchTransition: React.FC = () => {
  const frame = useCurrentFrame();
  // sum aberration across all cut points
  let env = 0;
  for (const c of CUTS) env = Math.max(env, glitchEnvelope(frame, [c], XF));
  if (env <= 0.02) return null;
  const flash = interpolate(env, [0, 1], [0, 0.45]);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 40 }}>
      <Scanlines opacity={0.18 * env} />
      <AbsoluteFill style={{ background: "#fff", opacity: flash, mixBlendMode: "overlay" }} />
      <AbsoluteFill
        style={{
          background: "#0a0a0a",
          opacity: env * 0.25,
        }}
      />
    </AbsoluteFill>
  );
};

export const ShowcaseSegment: React.FC = () => {
  const frame = useCurrentFrame();

  // global chroma + micro-zoom driven by proximity to any cut
  let env = 0;
  for (const c of CUTS) env = Math.max(env, glitchEnvelope(frame, [c], XF));
  const ca = env * 12;
  const zoom = 1 + env * 0.06;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
        <ChromaSplit amount={ca}>
          {beats.map((b, i) => (
            <Sequence key={i} from={b.from} durationInFrames={b.dur}>
              <b.C />
            </Sequence>
          ))}
        </ChromaSplit>
      </AbsoluteFill>
      <GlitchTransition />
    </AbsoluteFill>
  );
};
