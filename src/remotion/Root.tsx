import React from "react";
import { Composition } from "remotion";
import { TitleCard, type TitleCardProps } from "./TitleCard";
import { QuoteOverlay, type QuoteOverlayProps } from "./QuoteOverlay";
import { DataInsert, type DataInsertProps } from "./DataInsert";
import { ThumbText, type ThumbTextProps } from "./ThumbText";
import { ThumbTemplate, type ThumbTemplateProps } from "./ThumbTemplate";
import { DocuMotion, type DocuMotionProps } from "./DocuMotion";
import { MotivationalSpeech } from "./speech/MotivationalSpeech";
import type { MotivationalSpeechProps } from "./speech/types";
import { CinematicSpeech, type CinematicSpeechProps } from "./speech/CinematicSpeech";

/**
 * In-app Remotion root (registered by ./index.ts). Kept self-contained — only
 * `remotion` core — so it bundles for cloud rendering inside the Trigger task.
 * Duration is driven per-render from inputProps via calculateMetadata.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="TitleCard"
      component={TitleCard}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: "Channel", subtitle: "", palette: [], bgImage: "", outro: false, chapter: false } as TitleCardProps}
      calculateMetadata={({ props }) => ({
        durationInFrames:
          (props as { durationInFrames?: number }).durationInFrames ?? 150,
        fps: 30,
        width: (props as { width?: number }).width ?? 1920,
        height: (props as { height?: number }).height ?? 1080,
        props,
      })}
    />
      <Composition
        id="QuoteOverlay"
        component={QuoteOverlay}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ quote: "", highlights: [] } as QuoteOverlayProps}
        calculateMetadata={({ props }) => ({
          durationInFrames:
            (props as { durationInFrames?: number }).durationInFrames ?? 120,
          fps: 30,
          width: (props as { width?: number }).width ?? 1920,
          height: (props as { height?: number }).height ?? 1080,
          props,
        })}
      />
      <Composition
        id="ThumbTemplate"
        component={ThumbTemplate}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{ layout: "diagonal_split", artSrc: "", words: ["TITLE"] } as ThumbTemplateProps}
      />
      <Composition
        id="ThumbText"
        component={ThumbText}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{ lines: [{ text: "TITLE" }] } as ThumbTextProps}
      />
      <Composition
        id="DocuMotion"
        component={DocuMotion}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ shots: [] } as DocuMotionProps}
        calculateMetadata={({ props }) => {
          const p = props as DocuMotionProps & { width?: number; height?: number };
          const total = (p.shots ?? []).reduce(
            (sum, s) => sum + Math.max(1, s.durationInFrames),
            0,
          );
          return {
            durationInFrames: Math.max(1, total),
            fps: 30,
            width: p.width ?? 1920,
            height: p.height ?? 1080,
            props,
          };
        }}
      />
      <Composition
        id="CinematicSpeech"
        component={CinematicSpeech}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ words: [], segments: [] } as CinematicSpeechProps}
        calculateMetadata={({ props }) => ({
          durationInFrames:
            (props as { durationInFrames?: number }).durationInFrames ?? 900,
          fps: 30,
          width: (props as { width?: number }).width ?? 1920,
          height: (props as { height?: number }).height ?? 1080,
          props,
        })}
      />
      <Composition
        id="MotivationalSpeech"
        component={MotivationalSpeech}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ words: [], segments: [], cues: [] } as MotivationalSpeechProps}
        calculateMetadata={({ props }) => ({
          durationInFrames:
            (props as { durationInFrames?: number }).durationInFrames ?? 900,
          fps: 30,
          width: (props as { width?: number }).width ?? 1920,
          height: (props as { height?: number }).height ?? 1080,
          props,
        })}
      />
      <Composition
        id="DataInsert"
        component={DataInsert}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ kind: "big_stat", value: "0", title: "" } as DataInsertProps}
        calculateMetadata={({ props }) => ({
          durationInFrames:
            (props as { durationInFrames?: number }).durationInFrames ?? 180,
          fps: 30,
          width: (props as { width?: number }).width ?? 1920,
          height: (props as { height?: number }).height ?? 1080,
          props,
        })}
      />
    </>
  );
};
