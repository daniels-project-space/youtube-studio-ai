import React from "react";
import { Composition } from "remotion";
import { RankChart, type RankChartProps, totalFrames } from "./RankChart";

/**
 * ISOLATED chart Remotion root — deliberately NOT registered in
 * src/remotion/Root.tsx, for exactly the reason the quiz root gives:
 * `bundle()` compiles every composition registered in a root, so a heavy or
 * broken sibling would break an unrelated chart render. This root registers
 * exactly one composition, so the chart lane's blast radius is its own file.
 *
 * Both chart-driven families (`datachart` ranking videos and `simstory`
 * dramatized simulations) share this ONE composition — they differ only in the
 * ChartSpec they hand it, never in the renderer.
 */
export const ChartRemotionRoot: React.FC = () => {
  return (
    <Composition
      id="RankChart"
      component={RankChart}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ palette: [], title: "" } as RankChartProps}
      calculateMetadata={({ props }) => {
        const p = props as unknown as RankChartProps;
        return {
          durationInFrames: totalFrames(p.spec),
          fps: 30,
          width: p.width ?? 1920,
          height: p.height ?? 1080,
          props,
        };
      }}
    />
  );
};
