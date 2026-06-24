import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { frameToMs } from "./types";
import type { SpeechWord } from "./types";

type Chunk = { words: SpeechWord[]; start: number; end: number };

/** Group words into spoken phrases by inter-word gap / max length. */
function chunkWords(words: SpeechWord[], gapMs = 420, maxWords = 6): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: SpeechWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (cur.length && (gap > gapMs || cur.length >= maxWords)) {
      chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
  return chunks;
}

/**
 * Karaoke captions — the phrase sits on screen and the currently-spoken word
 * highlights (accent colour + glow + a small vertical lift) in sync with the
 * audio. Spoken words stay bright; upcoming words are dimmed. Cinematic
 * title-card type: large, bold, uppercase, centred above the lower letterbox.
 *
 * The active-word emphasis is a vertical LIFT (translateY) + a tiny scale, NOT a
 * big horizontal scale — a large scale on two adjacent active words grows each
 * glyph sideways from its centre and eats the inter-word margin, jamming long
 * neighbours together ("THOUSANDYEARS"). Lift + small scale keeps the spacing.
 */
export const KaraokeCaptions: React.FC<{
  words: SpeechWord[];
  accent?: string;
  fontFamily?: string;
  bottom?: string;
}> = ({
  words,
  accent = "#ffd27a",
  fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif',
  bottom = "15%",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frameToMs(frame, fps);
  const chunks = useMemo(() => chunkWords(words), [words]);

  const idx = chunks.findIndex((c, i) => {
    const next = chunks[i + 1];
    return t >= c.start - 120 && (next ? t < next.start - 120 : t < c.end + 800);
  });
  if (idx < 0) return null;
  const chunk = chunks[idx];

  // phrase-level in/out so it doesn't hard-cut
  const appear = interpolate(t, [chunk.start - 160, chunk.start + 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fontSize = Math.round(width * 0.04);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        textAlign: "center",
        padding: "0 9%",
        fontFamily,
        opacity: appear,
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 800,
          lineHeight: 1.22,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {chunk.words.map((w, i) => {
          const active = t >= w.start - 40 && t < w.end + 60;
          const spoken = t >= w.start - 40;
          const emph = active
            ? interpolate(t, [w.start - 60, w.start + 60], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : 0;
          const pop = 1 + emph * 0.06; // small — large scale eats inter-word margin
          const lift = emph * -7; // active word rises instead of growing sideways
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.6em",
                transform: `translateY(${lift}px) scale(${pop})`,
                transformOrigin: "center bottom",
                color: active ? accent : spoken ? "#ffffff" : "rgba(255,255,255,0.42)",
                textShadow: active
                  ? `0 0 22px ${accent}aa, 0 3px 16px rgba(0,0,0,0.9)`
                  : "0 3px 16px rgba(0,0,0,0.92)",
                transition: "none",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </span>
    </div>
  );
};
