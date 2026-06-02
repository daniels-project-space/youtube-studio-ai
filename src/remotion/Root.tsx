import React from "react";
import { Composition } from "remotion";
import { TitleCard, type TitleCardProps } from "./TitleCard";

/**
 * In-app Remotion root (registered by ./index.ts). Kept self-contained — only
 * `remotion` core — so it bundles for cloud rendering inside the Trigger task.
 * Duration is driven per-render from inputProps via calculateMetadata.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TitleCard"
      component={TitleCard}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: "Channel", subtitle: "", palette: [] } as TitleCardProps}
      calculateMetadata={({ props }) => ({
        durationInFrames:
          (props as { durationInFrames?: number }).durationInFrames ?? 150,
        fps: 30,
        width: (props as { width?: number }).width ?? 1920,
        height: (props as { height?: number }).height ?? 1080,
        props,
      })}
    />
  );
};
