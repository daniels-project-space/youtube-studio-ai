import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Sophisticated intro title card: a stoic marble bust sits behind the text at
 * 50% opacity (slow ken-burns), under a dark vignette for legibility. The title
 * fades IN and OUT slowly with a thin gold divider, over a deep charcoal base.
 * Self-contained (only `remotion` core) so it bundles for cloud rendering.
 */
export type TitleCardProps = {
  title: string;
  subtitle?: string;
  palette?: string[];
  /** Data-URI (or URL) of the bust image rendered at 50% opacity behind text. */
  bgImage?: string;
  /** Outro mode: the whole card fades to black over the last ~1.4s. */
  outro?: boolean;
  /** Chapter mode: the whole card gently fades IN from black and OUT to black. */
  chapter?: boolean;
};

const GOLD = "#c8a24a";

export const TitleCard: React.FC<TitleCardProps> = ({ title, subtitle, bgImage, outro, chapter }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();

  // slow ken-burns on the bust
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.07]);
  // Calm but LEGIBLE fades: on a 5s card the old 1.4s-in/1.4s-out ramps left
  // the title at partial opacity for ~55% of its life — QA (rightly) flagged
  // "too faded to read". Full opacity by ~0.7s, hold, fade only the last ~0.8s.
  const fadeIn = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 26, durationInFrames - 6], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textOpacity = fadeIn * fadeOut;
  const rise = interpolate(fadeIn, [0, 1], [24, 0]);
  const dividerW = interpolate(fadeIn, [0, 1], [0, Math.round(width * 0.22)]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#070709", fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {bgImage && (
        <AbsoluteFill>
          <Img
            src={bgImage}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              // Dimmer bg = the title owns the contrast (avatar art can be busy).
              opacity: 0.38,
              transform: `scale(${zoom})`,
            }}
          />
        </AbsoluteFill>
      )}
      {/* vignette + center darkening for text contrast */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.62) 70%, rgba(0,0,0,0.8) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 10%",
          textAlign: "center",
          opacity: textOpacity,
        }}
      >
        <div
          style={{
            transform: `translateY(${rise}px)`,
            color: "#ffffff",
            fontSize: Math.round(width * 0.052),
            fontWeight: 700,
            letterSpacing: "2px",
            textShadow: "0 4px 18px rgba(0,0,0,0.95), 0 10px 48px rgba(0,0,0,0.8)",
            lineHeight: 1.18,
          }}
        >
          {title}
        </div>
        <div style={{ width: dividerW, height: 2, backgroundColor: GOLD, marginTop: 26, opacity: 0.9 }} />
        {subtitle && (
          <div
            style={{
              marginTop: 18,
              color: "rgba(243,239,230,0.8)",
              fontSize: Math.round(width * 0.02),
              fontStyle: "italic",
              letterSpacing: "3px",
              textTransform: "uppercase",
            }}
          >
            {subtitle}
          </div>
        )}
      </AbsoluteFill>
      {outro && (
        <AbsoluteFill
          style={{
            backgroundColor: "#000",
            opacity: interpolate(frame, [durationInFrames - 42, durationInFrames - 4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
      )}
      {chapter && (
        // gentle fade IN from black (first ~0.8s) and OUT to black (last ~0.8s)
        <AbsoluteFill
          style={{
            backgroundColor: "#000",
            opacity: Math.max(
              interpolate(frame, [0, 24], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              interpolate(frame, [durationInFrames - 24, durationInFrames], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            ),
          }}
        />
      )}
    </AbsoluteFill>
  );
};
