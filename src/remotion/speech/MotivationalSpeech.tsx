import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo } from "remotion";
import { resolveTheme } from "./types";
import type { MotivationalSpeechProps } from "./types";
import { VintageFilter } from "./VintageFilter";
import { ChannelBug } from "./ChannelBug";
import { WordCaptions } from "./WordCaptions";
import { MotionCueLayer } from "./MotionCues";

/**
 * Speech-TV — the motivational-speech repost look, cloned from the reference
 * (Jim Rohn vintage compilation): real footage under a B&W/VHS broadcast filter,
 * a top-right segment "channel bug", word-by-word captions, and script-timed
 * motion graphics. One full-frame opaque composition (the grayscale/grain/glitch
 * must envelop the footage), rendered via src/lib/remotionRender.ts.
 *
 * Self-contained (only `remotion` core, system fonts) so it bundles for cloud
 * rendering inside the Trigger image — same constraint as the sibling comps.
 *
 * Stacking (bottom → top): footage+filter → graphics cues → captions →
 * channel bug → glitch bursts (on top, full-frame).
 */
export const MotivationalSpeech: React.FC<MotivationalSpeechProps> = ({
  sourceVideoSrc,
  musicSrc,
  musicVolume = 0.12,
  muteSource = false,
  words,
  segments,
  cues,
  theme: themeOverride,
  showChannelBug = true,
}) => {
  const theme = resolveTheme(themeOverride);
  const graphicsCues = cues.filter((c) => c.type !== "glitch");
  const glitchCues = cues.filter((c) => c.type === "glitch");

  return (
    <AbsoluteFill style={{ backgroundColor: "#05060a" }}>
      {/* footage (or vintage dark bg when no source yet) under the vintage filter */}
      <VintageFilter theme={theme}>
        {sourceVideoSrc ? (
          <OffthreadVideo
            src={sourceVideoSrc}
            muted={muteSource}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse at 50% 38%, #2a3340 0%, #11151c 55%, #070a0f 100%)",
            }}
          />
        )}
      </VintageFilter>

      {/* script-timed motion graphics (under captions) */}
      <MotionCueLayer cues={graphicsCues} theme={theme} />

      {/* word-by-word captions */}
      <WordCaptions words={words} theme={theme} />

      {/* segment channel bug */}
      {showChannelBug && segments.length > 0 && (
        <ChannelBug segments={segments} theme={theme} />
      )}

      {/* glitch bursts ride on top of everything */}
      <MotionCueLayer cues={glitchCues} theme={theme} />

      {/* low orchestral bed under the speech */}
      {musicSrc && <Audio src={musicSrc} volume={musicVolume} />}
    </AbsoluteFill>
  );
};
