import React from "react";
import { AbsoluteFill, Audio } from "remotion";
import { CinematicFrame, CINEMATIC_THEME } from "./CinematicFrame";
import type { CinematicTheme } from "./CinematicFrame";
import { KaraokeCaptions } from "./KaraokeCaptions";
import { SpeakerNameTag } from "./SpeakerNameTag";
import type { SpeechSegment, SpeechWord } from "./types";

/**
 * CinematicSpeech — the upgraded motivational-speech look: raw speech footage
 * under a cinematic film grade with karaoke word-highlight captions and a small
 * bottom-left speaker name lower-third. NO motion graphics.
 */
export type CinematicSpeechProps = {
  sourceVideoSrc?: string;
  musicSrc?: string;
  musicVolume?: number;
  muteSource?: boolean;
  words: SpeechWord[];
  segments: SpeechSegment[];
  theme?: Partial<CinematicTheme>;
};

export const CinematicSpeech: React.FC<CinematicSpeechProps> = ({
  sourceVideoSrc,
  musicSrc,
  musicVolume = 0.1,
  muteSource = false,
  words,
  segments,
  theme,
}) => {
  const th = { ...CINEMATIC_THEME, ...(theme ?? {}) };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <CinematicFrame videoSrc={sourceVideoSrc} segments={segments} muteSource={muteSource} theme={theme}>
        <KaraokeCaptions words={words} accent={th.accent} fontFamily={th.fontFamily} />
        <SpeakerNameTag segments={segments} accent={th.accent} fontFamily={th.fontFamily} />
      </CinematicFrame>
      {musicSrc && <Audio src={musicSrc} volume={musicVolume} />}
    </AbsoluteFill>
  );
};
