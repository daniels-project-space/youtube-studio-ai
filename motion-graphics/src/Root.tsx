/**
 * Remotion composition registry for YouTube Studio AI intro cards.
 *
 * Ported faithfully from legacy autostudio/motion-graphics/src/Root.tsx — the
 * `LofiIntroV2` composition (240 frames / 8s @ 30fps, 1920x1080) plus its
 * transparent (alpha WebM) variant used by the `intro_card` block's overlay
 * mode. Props are driven at render time via `--props {channelName, videoTitle}`.
 */
import React from "react";
import { Composition } from "remotion";
import { LofiIntroV2 } from "./LofiIntroV2";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Solid-background lofi intro (8s) — used for prepend mode. */}
      <Composition
        id="LofiIntroV2"
        component={LofiIntroV2}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          channelName: "Rainy Neon Lofi",
          videoTitle: "lofi beats to relax / study to",
          transparent: false,
        }}
      />

      {/* Transparent (alpha) lofi intro — used for overlay mode (--codec=vp8). */}
      <Composition
        id="LofiIntroV2Transparent"
        component={LofiIntroV2}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          channelName: "Rainy Neon Lofi",
          videoTitle: "lofi beats to relax / study to",
          transparent: true,
        }}
      />
    </>
  );
};
