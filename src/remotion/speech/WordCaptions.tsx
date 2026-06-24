import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { frameToMs } from "./types";
import type { SpeechWord, SpeechTheme } from "./types";

type Chunk = { words: SpeechWord[]; start: number; end: number };

/**
 * Group words into short on-screen phrases by inter-word gap (same idea as
 * wordsToSrt's maxWords chunking in src/lib/assemblyai.ts). A new chunk starts
 * on a gap > gapMs or after maxWords.
 */
function chunkWords(words: SpeechWord[], gapMs = 360, maxWords = 4): Chunk[] {
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
  if (cur.length)
    chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
  return chunks;
}

/**
 * Word-by-word captions, centered-low. Each word snaps in exactly when it is
 * spoken (start ms), accumulating within its phrase, then the phrase clears.
 */
export const WordCaptions: React.FC<{
  words: SpeechWord[];
  theme: SpeechTheme;
}> = ({ words, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frameToMs(frame, fps);
  const chunks = useMemo(() => chunkWords(words), [words]);

  const idx = chunks.findIndex((c, i) => {
    const next = chunks[i + 1];
    return t >= c.start && (next ? t < next.start : t < c.end + 700);
  });
  if (idx < 0) return null;
  const chunk = chunks[idx];
  const fontSize = Math.round(width * 0.03);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "17%",
        textAlign: "center",
        padding: "0 12%",
        fontFamily: theme.fontFamily,
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 700,
          lineHeight: 1.3,
          color: theme.captionColor,
          textShadow: "0 2px 16px rgba(0,0,0,0.9)",
        }}
      >
        {chunk.words.map((w, i) => {
          const spoken = t >= w.start - 50; // snap a hair early
          const pop = interpolate(t, [w.start - 90, w.start + 30], [0.55, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.32em",
                opacity: spoken ? 1 : 0,
                transform: `scale(${spoken ? pop : 0.55})`,
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
