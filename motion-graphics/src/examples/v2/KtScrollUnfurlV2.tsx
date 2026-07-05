/**
 * KtScrollUnfurlV2 — AGED ornate scrolls, broadcast tier. Matches frame
 * at_29-52 / at_29-57.
 *
 * V3-style AGED parchment scroll-banners (torn/deckled edges via feTurbulence
 * feDisplacementMap, curled rolled ends, sepia/parchment gradient + subtle
 * paper-grain overlay, soft drop shadow) holding brown SCRIPT promises
 * (Tangerine). Scrolls SCALE-IN from center staggered with a spring settle,
 * connected by thin hanging strings. A proper BLACK TRUMPETER silhouette
 * (figure leaning, arm raised, horn to the mouth) at left. BG: the dense
 * BaroqueDamask filigree + vignette + grain.
 *
 * The aged-scroll recipe is replicated from the V3 CameraPathFollow ScrollBanner
 * (torn rough filter + parchment gradient + curled ends + inner rule lines) so
 * the two share the same finish; CameraPathFollow itself is untouched.
 *
 * Native Remotion path. Deterministic.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadTangerine } from "@remotion/google-fonts/Tangerine";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { FilmGrain, Vignette, BaroqueDamask } from "./_shared";

const { fontFamily: tangerine } = loadTangerine();
const { fontFamily: cinzel } = loadCinzel();

const PARCHMENT = "#e7d9b0";
const PARCHMENT_DK = "#c9b482";
const INK = "#3a2412";

/**
 * Aged parchment scroll-banner with torn/deckled edges + curled rolled ends.
 * Replicated from the V3 CameraPathFollow ScrollBanner approach. Viewbox is
 * 760x320; the caller scales it to fit.
 */
const ScrollBanner: React.FC<{
  topLine: string;
  bottomLine?: string;
  big?: boolean;
  uid: string;
}> = ({ topLine, bottomLine, big, uid }) => (
  <svg width="100%" height="100%" viewBox="0 0 760 320">
    <defs>
      <linearGradient id={`${uid}-parch`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f2e7c4" />
        <stop offset="55%" stopColor={PARCHMENT} />
        <stop offset="100%" stopColor={PARCHMENT_DK} />
      </linearGradient>
      {/* torn/deckled edge via fractal-noise displacement */}
      <filter id={`${uid}-rough`}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.012 0.03"
          numOctaves={2}
          seed={3}
          result="n"
        />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="10" />
      </filter>
      {/* subtle paper grain, multiplied over the body */}
      <filter id={`${uid}-grain`}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="2"
          seed="11"
          result="g"
        />
        <feColorMatrix in="g" type="saturate" values="0" result="gs" />
        <feComponentTransfer in="gs" result="ga">
          <feFuncA type="linear" slope="0.12" intercept="0" />
        </feComponentTransfer>
        <feComposite in="ga" in2="SourceGraphic" operator="in" />
      </filter>
    </defs>

    {/* curled left rolled end */}
    <g stroke={INK} strokeWidth="4" fill={`url(#${uid}-parch)`}>
      <path
        d="M150 90 C90 70 70 130 92 160 C70 196 96 250 150 234 L150 90 Z"
        filter={`url(#${uid}-rough)`}
      />
      <path
        d="M150 234 C120 250 96 246 92 220"
        fill="none"
        opacity="0.6"
      />
    </g>
    {/* curled right rolled end */}
    <g stroke={INK} strokeWidth="4" fill={`url(#${uid}-parch)`}>
      <path
        d="M610 90 C672 68 698 132 672 162 C700 198 668 252 610 234 L610 90 Z"
        filter={`url(#${uid}-rough)`}
      />
      <path
        d="M610 234 C640 250 666 246 672 220"
        fill="none"
        opacity="0.6"
      />
    </g>
    {/* main parchment body with torn edges */}
    <path
      d="M150 80 C320 64 440 64 610 80 L610 244 C440 260 320 260 150 244 Z"
      fill={`url(#${uid}-parch)`}
      stroke={INK}
      strokeWidth="4"
      filter={`url(#${uid}-rough)`}
    />
    {/* paper grain overlay on the body */}
    <path
      d="M150 80 C320 64 440 64 610 80 L610 244 C440 260 320 260 150 244 Z"
      fill="#000"
      opacity="0.5"
      style={{ mixBlendMode: "multiply" }}
      filter={`url(#${uid}-grain)`}
    />
    {/* faint inner rule lines */}
    <path
      d="M180 108 H580 M180 216 H580"
      stroke="rgba(58,36,18,0.16)"
      strokeWidth="2"
      fill="none"
    />

    {/* promise text in script ink */}
    <text
      x="380"
      y={bottomLine ? "150" : "178"}
      textAnchor="middle"
      fontFamily={tangerine}
      fontWeight={700}
      fontSize="78"
      fill={INK}
    >
      {topLine}
    </text>
    {bottomLine && (
      <text
        x="380"
        y="234"
        textAnchor="middle"
        fontFamily={tangerine}
        fontWeight={700}
        fontSize={big ? "104" : "84"}
        fill={INK}
      >
        {bottomLine}
      </text>
    )}
  </svg>
);

/**
 * Black TRUMPETER / horn-blower silhouette — a crouched herald leaning forward,
 * both arms raised holding a long horn angled UP to the mouth, the bell flaring
 * out toward the upper-left (matching the reference at_29-52). Drawn as clean
 * solid shapes so it reads clearly as a figure, not a blob.
 *
 * Coordinate frame: figure faces RIGHT-toward-the-scrolls, horn points up-left
 * away from them; viewBox 360x400.
 */
const Trumpeter: React.FC = () => (
  <svg width="300" height="333" viewBox="0 0 360 400">
    <g fill="rgba(12,3,3,0.85)">
      {/* back leg (planted), bent at the knee, leaning into the blow */}
      <path d="M196 250 C 214 286 222 330 214 388 L 184 388 C 188 338 178 296 162 264 Z" />
      {/* front leg striding forward */}
      <path d="M150 252 C 130 290 110 330 96 388 L 128 388 C 142 338 158 300 178 268 Z" />
      {/* hips + torso, hunched forward over the horn */}
      <path
        d="M150 250
           C 138 214 140 178 168 156
           C 156 140 158 120 176 112
           C 178 96 196 86 214 92
           C 232 98 238 118 228 134
           C 248 148 256 178 248 214
           C 244 234 232 250 210 256
           C 188 262 162 262 150 250 Z"
      />
      {/* head, tilted up to meet the mouthpiece */}
      <circle cx="206" cy="98" r="26" />
      {/* upper arm + forearm raised, hands gripping the horn near the mouth */}
      <path
        d="M214 132
           C 196 120 172 116 150 122
           C 132 128 120 116 132 102
           C 146 88 178 86 206 96
           C 226 104 234 120 226 134 Z"
      />
    </g>
    {/* the long horn: tube from the lips angling up-left into a flaring bell */}
    <g fill="rgba(12,3,3,0.85)">
      {/* mouthpiece + straight tube up to the left */}
      <path d="M198 92 L 78 36 L 70 56 L 192 112 Z" />
      {/* flaring conical bell at the far end (upper-left) */}
      <path d="M78 36 C 50 18 18 26 8 54 C 30 46 56 46 86 58 Z" />
      {/* bell rim accent */}
      <path d="M8 54 C 16 40 34 30 52 30 L 48 44 C 34 44 22 50 14 60 Z" />
    </g>
  </svg>
);

export const KtScrollUnfurlV2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // banner placement (centre x,y) + intrinsic size. Layout mirrors the ref:
  // two stacked left, two on the right, alternating sides.
  const scrolls = [
    { top: "Believe this", bottom: "Message", big: true, x: 640, y: 235, w: 700, h: 295, start: 8 },
    { top: "Your pigs", bottom: "won't die", x: 660, y: 625, w: 660, h: 280, start: 33 },
    { top: "Your wife won't", bottom: "have miscarriages", x: 1320, y: 320, w: 720, h: 300, start: 58 },
    { top: "rings on", bottom: "your fingers", x: 1340, y: 720, w: 660, h: 280, start: 83 },
  ];

  const hornP = interpolate(frame, [4, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // gentle horn lean "blow" bob
  const hornBob = Math.sin(frame * 0.12) * 3 * hornP;

  return (
    <AbsoluteFill style={{ fontFamily: cinzel, backgroundColor: "#2e0808" }}>
      {/* dense red baroque damask ground */}
      <BaroqueDamask
        bg="#2e0808"
        color="rgba(30,8,6,0.6)"
        accent="rgba(24,6,5,0.7)"
        opacity={0.95}
        tile={320}
        drift
        frame={frame}
      />
      {/* warm radial wash so the centre reads brighter, like the ref */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 95% 90% at 42% 40%, rgba(150,40,40,0.45) 0%, rgba(86,16,16,0.2) 52%, rgba(46,8,8,0.5) 100%)",
        }}
      />

      {/* trumpeter silhouette at lower-left, horn flaring into open space */}
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 470,
          opacity: 0.9 * hornP,
          transform: `translate(${interpolate(hornP, [0, 1], [-46, 0])}px, ${hornBob}px)`,
          filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.5))",
        }}
      >
        <Trumpeter />
      </div>

      {/* connecting hanging strings between the two left-column scrolls */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {[560, 720].map((x) => (
          <line
            key={x}
            x1={x}
            y1={382}
            x2={x}
            y2={486}
            stroke="rgba(30,16,8,0.6)"
            strokeWidth="2.5"
            opacity={interpolate(frame, [40, 56], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        ))}
      </svg>

      {/* the scrolls — scale-in from center, staggered, with a spring settle */}
      {scrolls.map((s, i) => {
        const sp = spring({
          frame: frame - s.start,
          fps,
          config: { damping: 13, stiffness: 110, mass: 0.85 },
        });
        const scale = interpolate(sp, [0, 1], [0.18, 1]);
        const opacity = interpolate(frame - s.start, [0, 9], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: s.x - s.w / 2,
              top: s.y - s.h / 2,
              width: s.w,
              height: s.h,
              transform: `scale(${scale})`,
              transformOrigin: "center center",
              opacity,
              filter: "drop-shadow(0 18px 28px rgba(0,0,0,0.5))",
            }}
          >
            <ScrollBanner
              topLine={s.top}
              bottomLine={s.bottom}
              big={s.big}
              uid={`scu${i}`}
            />
          </div>
        );
      })}

      <Vignette strength={0.78} />
      <FilmGrain opacity={0.05} />
    </AbsoluteFill>
  );
};
