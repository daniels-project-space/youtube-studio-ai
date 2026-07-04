import { Composition } from "remotion";
import { DataStats, dataStatsDefaults } from "./DataStats";
import { KineticTitle, kineticTitleDefaults } from "./KineticTitle";
import { HeroTitle, heroTitleDefaults } from "./HeroTitle";

export const Root: React.FC = () => {
  return (
    <>
      <Composition id="DataStats" component={DataStats} durationInFrames={240} fps={30} width={1920} height={1080} defaultProps={dataStatsDefaults} />
      <Composition id="KineticTitle" component={KineticTitle} durationInFrames={210} fps={30} width={1920} height={1080} defaultProps={kineticTitleDefaults} />
      <Composition id="HeroTitle" component={HeroTitle} durationInFrames={210} fps={30} width={1920} height={1080} defaultProps={heroTitleDefaults} />
    </>
  );
};
