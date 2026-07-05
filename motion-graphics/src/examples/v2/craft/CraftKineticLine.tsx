/**
 * CraftKineticLine — ITERATION 5 motion-craft demo.
 *
 * ITER 4 verdict (verified at FULL RES, not the downscaled strip that overstated
 * it): FEEL's letterforms are actually clean — the "tiling" was a hard per-glyph
 * shadow boxing each letter + Anton's tight -0.02em kerning merging the E's.
 * ITER 5 = the polish: soften to one ambient shadow (HERO_SHADOW) + loosen hero
 * tracking (HERO_TRACKING) so the word reads as unified premium type.
 *
 * ITER 3 verdict (verified by frames): the spring entrance WORKED — FEEL's
 * entrance now shows a real motion-blur smear + a visible coast-past (goals #2/#3
 * landed). But the FEEL "tiling" SURVIVED, and crucially it was present on plain
 * settled frames AFTER the blur gate closed → it was never the blur. Root cause
 * (localized by contrast: 300px FEEL tiles, identical-code-path 220px PRO$PERITY
 * is clean): `filter:drop-shadow` on an over-tile-size GPU layer → per-tile seams.
 * ITER 4 swaps filter:drop-shadow → text-shadow. (see the wordNode style note.)
 *
 * Phrase: "I DON'T KNOW WHAT YOU FEEL ABOUT THE PROSPERITY GOSPEL"
 * (PROSPERITY rendered as PRO$PERITY — $ for the S, matches the reference).
 *
 * ITER 2 verdict (verified by frames): LAYOUT ✅ (beat-grouping fixed the iter-1
 * clutter) + audio-sync ✅ + PRO$PERITY beat clean ✅. But two failures: (a) the
 * FEEL hero showed PERSISTENT vertical seams (the ever-on BlurTrail kept
 * compositing ghosts of the still-oscillating overshoot spring at 300px), and
 * (b) motion blur + overshoot STILL didn't read — root cause: snapIn finished
 * ~90% of travel in ~1 frame, leaving nothing for the blur/punch to register on.
 *
 * ITER 3 — both failures share one fix: SPREAD the entrance, GATE the smear.
 *  1. SPRING ENTRANCE — heroes slide via the overshoot spring over ~12 frames
 *     (4-6 real mid-flight frames) + coast past the anchor → blur and overshoot
 *     both register. (constants ENTER_DUR 8→12, HERO_TRAVEL 230→300, LEAD→12.)
 *  2. SMEAR GATED TO MOTION — heroes get TRUE 180° CameraMotionBlur (smooth
 *     integrated smear, not discrete ghosts) ONLY while moving; settled words
 *     render plain & razor-clean → the FEEL seam is gone by construction.
 *
 * ITER 1 verdict (verified by frames): snap easing ✅ + audio-sync ✅, but
 * (a) motion blur invisible, (b) overshoot too weak, (c) LAYOUT cluttered —
 * every word accumulated and overlapped ("KNOWWHAT" collided, "ABOUT THE"
 * crashed into "PROSPERITY"). ITER 2 fixes all three, layout first.
 *
 * WHAT CHANGED (priority order):
 *  1. LAYOUT — beat-grouped, collision-free. At any moment the screen shows at
 *     most a SMALL TIDY lead/mid cluster + ONE giant hero word (like the
 *     reference). Beat 1 = lead column "I DON'T/KNOW/WHAT/YOU" (top-left) +
 *     hero "FEEL" (center). Beat 1 FADES OUT, then Beat 2 = "ABOUT/THE" small +
 *     hero "PRO$PERITY" + "GOSPEL". Word widths come from @remotion/layout-utils
 *     measureText so the lead column and hero never collide.
 *  2. VISIBLE MOTION BLUR — hero entrance travels ~230px over ~7 frames (high
 *     velocity), wrapped in <BlurTrail layers=6 lag=1 opacity=0.5> for a
 *     directional ghost smear, PLUS velocity-driven scaleY stretch (coeff 3).
 *  3. STRONGER OVERSHOOT — hero scale 0.8 → 1.12 → 1.0 (overshootScale), spring
 *     damping lowered to 10 so the punch is visible across frames.
 *  4. SEAM FIX — exactly ONE drop-shadow per WORD container (filter on the word
 *     div), not per letter / per AbsoluteFill cell — kills the FEEL banding.
 *  5. TRIMMED dead lead-in — onsets shifted −0.9s + audio trimmed −0.9s at remux.
 *
 * KEPT: hybrid audio-onset sync (words land on the voice) and the dark-red
 * BaroqueDamask + Vignette + FilmGrain bg (imported from ../_shared, not edited).
 *
 * 1920x1080, 30fps, 210 frames. Deterministic (useCurrentFrame only).
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { measureText } from "@remotion/layout-utils";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { FilmGrain, Vignette, BaroqueDamask } from "../_shared";
import { BlurTrail, BlurMove } from "./Move";
import {
  PHRASE_ONSETS,
  buildTimeline,
  beatOfWord,
  type TimedWord,
} from "./audioSync";
import { snapIn, overshootScale, overshoot, motionWithVelocity } from "./eases";

const { fontFamily: anton } = loadAnton();
const { fontFamily: oswald } = loadOswald();

export const CRAFT_KINETIC_DURATION = 210; // 7.0s @ 30fps

const W = 1920;
const H = 1080;

/** Frames a word starts entering BEFORE its onset, so it settles on-beat.
 *  ITER 3: heroes are spring-driven and reach their target ≈ENTER_DUR frames in,
 *  so LEAD matches the hero duration → the hero SETTLES on the spoken word. */
const LEAD = 12;
/** Hero entrance duration (frames). ITER 3: 8→12. The iter-2 snapIn finished
 *  ~90% of travel in ~1 frame, so neither the motion blur nor the overshoot had
 *  enough mid-flight frames to register. A spring spread over ~12 frames gives
 *  4-6 frames of real travel → the smear and the punch both READ. */
const ENTER_DUR = 12;
/** Lead/mid entrance duration — small words stay crisp/snappy, not floaty. */
const LEAD_DUR = 7;
/** Hero entrance travel in px (big → motion blur reads). ITER 3: 230→300. */
const HERO_TRAVEL = 300;
/** Lead/mid entrance travel in px (smaller, tidy). */
const LEAD_TRAVEL = 70;
/** ITER 5: hero letter-tracking. Anton at -0.02em pulled FEEL's two E's almost
 *  together → the "boxy" read. +0.012em lets the heroes breathe (PRO$PERITY,
 *  already clean, is unaffected visually). Used by BOTH widthOf + the style so
 *  the measured layout stays exact. */
const HERO_TRACKING = "0.012em";
/** ITER 5: a single SOFT ambient drop-shadow (big blur, low alpha) instead of
 *  the tight 14px shadow that edged each glyph into its own panel. */
const HERO_SHADOW =
  "0 4px 10px rgba(0,0,0,0.30), 0 16px 40px rgba(0,0,0,0.34)";

type Role = "lead" | "mid" | "hero";

interface WordStyle {
  role: Role;
  size: number; // font px
  font: string;
  display?: string; // override token (PRO$PERITY)
  /** entrance direction unit vector (where it slides FROM). */
  dir: { x: number; y: number };
}

/* ------------------------------------------------------------------ */
/* Per-word STYLE (size/role/font). POSITIONS are computed below with   */
/* measureText so nothing can collide regardless of glyph widths.       */
/* ------------------------------------------------------------------ */
const STYLE: Record<string, WordStyle> = {
  I:      { role: "lead", size: 60, font: oswald, dir: { x: -1, y: 0 } },
  "DON'T":{ role: "lead", size: 60, font: oswald, dir: { x: -1, y: 0 } },
  KNOW:   { role: "lead", size: 60, font: oswald, dir: { x: -1, y: 0 } },
  WHAT:   { role: "lead", size: 60, font: oswald, dir: { x: -1, y: 0 } },
  YOU:    { role: "lead", size: 60, font: oswald, dir: { x: -1, y: 0 } },
  FEEL:   { role: "hero", size: 300, font: anton, dir: { x: 1, y: 0.25 } },
  ABOUT:  { role: "mid", size: 96, font: anton, dir: { x: 0, y: -1 } },
  THE:    { role: "mid", size: 84, font: oswald, dir: { x: 0, y: -1 } },
  PROSPERITY: { role: "hero", size: 220, font: anton, display: "PRO$PERITY", dir: { x: -1, y: 0.2 } },
  GOSPEL: { role: "mid", size: 84, font: anton, dir: { x: 1, y: 0.3 } },
};

/** Anchor point of a word box (its center), in canvas px. Computed from real
 *  measured widths so beat clusters are gridded and never overlap. */
interface Anchor {
  cx: number;
  cy: number;
}

/** measureText helper for a token at its style. */
const widthOf = (word: string): number => {
  const st = STYLE[word];
  const text = st.display ?? word;
  return measureText({
    text,
    fontFamily: st.font,
    fontSize: st.size,
    fontWeight: 700,
    letterSpacing: st.role === "hero" ? HERO_TRACKING : "0.02em",
  }).width;
};

/**
 * Layout grid (computed once). BEAT 1: a tidy left-aligned lead COLUMN of the
 * five filler words (each on its own baseline row), and "FEEL" as a huge hero
 * to the right of the column with a guaranteed gap. BEAT 2: "ABOUT"/"THE" small
 * along the top, "PRO$PERITY" hero centered, "GOSPEL" small bottom-right.
 */
const buildAnchors = (): Record<string, Anchor> => {
  const a: Record<string, Anchor> = {};

  /* ---- BEAT 1: lead column + FEEL ---- */
  const leadWords = ["I", "DON'T", "KNOW", "WHAT", "YOU"];
  const leadLeft = 150; // left margin for the column
  const leadRowH = 78; // baseline-to-baseline for 60px caps
  const leadTop = 300; // y of the FIRST row's center
  leadWords.forEach((w, i) => {
    const wWidth = widthOf(w);
    a[w] = { cx: leadLeft + wWidth / 2, cy: leadTop + i * leadRowH };
  });
  const leadColRight = leadLeft + Math.max(...leadWords.map(widthOf));
  // FEEL: hero, centered vertically on the column, with a clear gap to its right.
  const feelW = widthOf("FEEL");
  const feelGap = 120;
  a.FEEL = {
    cx: leadColRight + feelGap + feelW / 2,
    cy: leadTop + (leadWords.length - 1) * leadRowH * 0.5, // column vertical center
  };

  /* ---- BEAT 2: ABOUT / THE (top) + PRO$PERITY (hero) + GOSPEL ---- */
  const heroW = widthOf("PROSPERITY");
  const heroCx = W / 2; // center the giant hero
  const heroCy = 560;
  a.PROSPERITY = { cx: heroCx, cy: heroCy };
  const heroLeft = heroCx - heroW / 2;
  // ABOUT sits above-left of the hero's left edge; THE just right of ABOUT.
  const aboutW = widthOf("ABOUT");
  const theW = widthOf("THE");
  const topY = heroCy - 220;
  a.ABOUT = { cx: heroLeft + aboutW / 2 + 20, cy: topY };
  a.THE = { cx: heroLeft + aboutW + 40 + theW / 2, cy: topY + 40 };
  // GOSPEL: small, bottom-right under the hero's right portion.
  const gospelW = widthOf("GOSPEL");
  a.GOSPEL = {
    cx: heroCx + heroW / 2 - gospelW / 2 - 20,
    cy: heroCy + 170,
  };

  return a;
};

/**
 * A single animated word. snapIn slide-from-direction + overshoot scale + fade,
 * wrapped in a directional ghost-trail smear. Beat membership drives a FADE-OUT
 * so the previous beat clears before the next hero arrives — no accumulation.
 *
 * `anchors` is computed once in the parent (inside the browser render context,
 * where measureText is available) and passed down.
 */
const Word: React.FC<{ tw: TimedWord; anchors: Record<string, Anchor> }> = ({
  tw,
  anchors,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const st = STYLE[tw.word];
  const anchor = anchors[tw.word];
  if (!st || !anchor) return null;

  const start = tw.startFrame;
  if (frame < start) return null; // not yet entered

  const isHero = st.role === "hero";
  const travel = isHero ? HERO_TRAVEL : LEAD_TRAVEL;
  const dur = isHero ? ENTER_DUR : LEAD_DUR;

  // ITER 3 ENTRANCE — the core fix. Heroes are driven by a SPRING (overshoot
  // config) used as a 0→1→(~1.18)→1 position driver: the word slides in over
  // ~12 frames, coasts slightly PAST its anchor, then settles — so there are
  // several mid-flight frames at high velocity (the blur integrates a visible
  // smear) AND a perceptible coast-past (the overshoot the eye reads as alive).
  // Lead/mid words keep the crisp snapIn (small → should feel snappy, not floaty).
  const driver = isHero
    ? motionWithVelocity((f) => overshoot(f, start, fps), frame) // 0 → ~1.18 → 1
    : motionWithVelocity((f) => snapIn(f, start, dur), frame); //   0 → 1
  const p = driver.value;
  // slide from `travel` to 0. For heroes the spring's >1 band carries the word
  // a few px PAST the anchor (negative residual) then back — a real position
  // overshoot, not just a scale pop.
  const slideAmt = (1 - p) * travel;
  const slideX = st.dir.x * slideAmt;
  const slideY = st.dir.y * slideAmt;

  // overshoot scale: 0.8 → 1.12 → 1.0, now spread over enough frames to SEE it.
  const scale = isHero ? overshootScale(frame, start, fps, 0.8, 1.12) : 1;

  // velocity-driven directional stretch, scaled by the spring's instantaneous
  // speed so the fastest frames stretch most along the travel axis; →1 at settle.
  const stretch = isHero ? 1 + Math.min(0.45, Math.abs(driver.velocity) * 6) : 1;
  const stretchX = Math.abs(st.dir.x) >= Math.abs(st.dir.y) ? stretch : 1;
  const stretchY = Math.abs(st.dir.y) > Math.abs(st.dir.x) ? stretch : 1;

  // entrance fade-in on a clamped LOCAL time (not the spring value, which exceeds
  // 1 on the overshoot band and would otherwise flicker the opacity).
  const tIn = Math.min(1, Math.max(0, (frame - start) / Math.max(1, dur)));
  const fadeIn = interpolate(tIn, [0, 0.4], [0, 1], { extrapolateRight: "clamp" });

  // BEAT fade-OUT: when this word's beat clears, fade the word away over 12f.
  const beat = beatOfWord(st.display ? "PROSPERITY" : tw.word, fps);
  let fadeOut = 1;
  if (beat && beat.fadeOutFrame > 0 && frame >= beat.fadeOutFrame) {
    fadeOut = interpolate(
      frame,
      [beat.fadeOutFrame, beat.fadeOutFrame + 12],
      [1, 0],
      { extrapolateRight: "clamp" },
    );
    if (fadeOut <= 0) return null; // fully cleared — remove from tree
  }

  const opacity = fadeIn * fadeOut;
  const colour = isHero ? "#f4f4f4" : "#c7c7c7";

  // The moving word, with ONE drop-shadow on THIS container (filter, per-word —
  // kills the per-letter banding/seam artifact from iter1).
  const wordNode = (
    <div
      style={{
        position: "absolute",
        left: anchor.cx,
        top: anchor.cy,
        transform: `translate(-50%, -50%) translate(${slideX}px, ${slideY}px) scale(${scale}) scale(${stretchX}, ${stretchY})`,
        transformOrigin: "center",
        opacity,
        fontFamily: st.font,
        fontWeight: 700,
        fontSize: st.size,
        lineHeight: 1,
        letterSpacing: isHero ? HERO_TRACKING : "0.02em",
        color: colour,
        whiteSpace: "nowrap",
        // ITER 4 — THE seam fix. Use text-shadow, NOT filter:drop-shadow. At
        // 300px the FEEL hero is wider/taller than Chromium's GPU layer tile
        // size, and `filter:drop-shadow` is computed PER TILE → visible vertical
        // SEAMS at the tile boundaries (the "tiled FEEL" that survived iter-2 and
        // iter-3 even on plain, settled, un-blurred frames — while the smaller
        // 220px PRO$PERITY rendered clean on the identical code path). text-shadow
        // has no per-tile bug; dropping will-change avoids forcing the tiled layer.
        textShadow: isHero ? HERO_SHADOW : "0 3px 8px rgba(0,0,0,0.45)",
      }}
    >
      {st.display ?? tw.word}
    </div>
  );

  // ITER 3 — smear is GATED to the motion window only. The iter-2 trail wrapped
  // the word forever, so it kept compositing 6 ghosts of the still-oscillating
  // spring → the persistent seams that tiled "FEEL". Now: heroes get TRUE 180°
  // sub-frame motion blur (CameraMotionBlur — a smooth integrated smear, no
  // discrete ghosts) but ONLY while moving; once settled the word renders plain
  // and razor-clean. Lead/mid words get a light, cheap trail during entrance.
  const inMotion = frame <= start + dur + 2;
  if (!inMotion) {
    return <AbsoluteFill>{wordNode}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      {isHero ? (
        <BlurMove shutterAngle={180} samples={12}>
          {wordNode}
        </BlurMove>
      ) : (
        <BlurTrail layers={4} lagInFrames={1} trailOpacity={0.3}>
          {wordNode}
        </BlurTrail>
      )}
    </AbsoluteFill>
  );
};

export const CraftKineticLine: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const timeline = buildTimeline(PHRASE_ONSETS, fps, LEAD);
  // measureText only works in a browser; compute anchors here (render context),
  // memoized so the layout grid is built once, not per frame.
  const anchors = React.useMemo(() => buildAnchors(), []);

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a0606" }}>
      {/* Dark-red baroque background, slow drift (imported, not edited) */}
      <AbsoluteFill style={{ backgroundColor: "#2a0707" }} />
      <BaroqueDamask
        color="rgba(180,40,40,0.30)"
        accent="rgba(120,20,20,0.35)"
        bg="#2a0707"
        opacity={0.85}
        drift
        frame={frame}
        tile={340}
      />
      {/* subtle global breathing of the BG for depth */}
      <AbsoluteFill
        style={{
          transform: `scale(${1 + 0.02 * Math.sin((frame / fps) * 0.6)})`,
          transformOrigin: "center",
          background:
            "radial-gradient(ellipse 70% 60% at 50% 48%, rgba(140,20,20,0.35), transparent 70%)",
        }}
      />

      {/* Words — beat-grouped, collision-free, motion-blurred */}
      {timeline.map((tw) => (
        <Word key={tw.word} tw={tw} anchors={anchors} />
      ))}

      {/* Polish layers on top */}
      <Vignette strength={0.8} />
      <FilmGrain opacity={0.07} freq={0.72} />
    </AbsoluteFill>
  );
};
