import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { voyagerGoldenRecordAssetBoard } from "./VoyagerGoldenRecordAssetBoard";
import {
  cameraPush,
  CutoutLayer,
  FilmTreatment,
  foldTransform,
  gateWeave,
  handheldDrift,
  lumaWipe,
  rackFocus,
  SignalThread,
  TornPaperMatte,
} from "./motion/EditorialAssetLibrary";

const BONE = "#f2eadb";
const INK = "#080704";
const GOLD = "#d9a23a";
const RED = "#9e2b22";
const BLUE = "#1c4054";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const ease = (value: number): number => Easing.out(Easing.cubic)(clamp01(value));
const progress = (frame: number, start: number, duration: number): number => ease((frame - start) / duration);

const display: React.CSSProperties = {
  fontFamily: "Arial Narrow, Impact, Arial Black, sans-serif",
  fontWeight: 900,
  letterSpacing: "-0.055em",
  lineHeight: 0.83,
  textTransform: "uppercase",
};

const label: React.CSSProperties = {
  fontFamily: "Courier New, monospace",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

const sceneFile = (sceneId: string): string => {
  const scene = voyagerGoldenRecordAssetBoard.scenes.find((candidate) => candidate.id === sceneId);
  const file = scene?.assets.find((asset) => asset.role === "setting")?.file;
  if (!file) throw new Error(`Missing setting asset for scene ${sceneId}`);
  return file;
};

const assetFile = (sceneId: string, assetId: string): string => {
  const scene = voyagerGoldenRecordAssetBoard.scenes.find((candidate) => candidate.id === sceneId);
  const asset = scene?.assets.find((candidate) => candidate.id === assetId);
  const file = asset && "file" in asset ? asset.file : undefined;
  if (!file) throw new Error(`Missing declared asset ${assetId} for scene ${sceneId}`);
  return file;
};

const BackgroundPlate: React.FC<{
  file: string;
  frame: number;
  local: number;
  dim?: number;
  direction?: "left" | "right" | "up";
}> = ({ file, frame, local, dim = 0.2, direction = "left" }) => {
  const pan = interpolate(local, [0, 120], [0, 1], { extrapolateRight: "clamp" });
  const x = direction === "left" ? -18 * pan : direction === "right" ? 18 * pan : 0;
  const y = direction === "up" ? -22 * pan : 0;
  const scale = interpolate(local, [0, 130], [1.04, 1.12], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#020202" }}>
      <Img
        src={staticFile(file)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `${gateWeave(frame)} ${handheldDrift(frame, 0.25)} translate(${x}px, ${y}px) ${cameraPush(local, 0, 130, scale, scale + 0.028)}`,
          filter: "saturate(0.9) contrast(1.08) brightness(0.9)",
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim}) 0%, rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.54) 100%)` }} />
      <div style={{ position: "absolute", left: 56, top: 58, ...label, fontSize: 18, color: BONE, opacity: 0.76 }}>ARCHIVE / OUTBOUND / 1977</div>
      <div style={{ position: "absolute", left: 56, top: 89, width: 168, height: 2, background: GOLD, opacity: 0.9 }} />
    </AbsoluteFill>
  );
};

const PaperCard: React.FC<{
  left: number;
  top: number;
  width: number;
  rotation?: number;
  opacity?: number;
  scale?: number;
  children: React.ReactNode;
  accent?: string;
  shadow?: string;
}> = ({ left, top, width, rotation = 0, opacity = 1, scale = 1, children, accent = RED, shadow = "0 25px 50px rgba(0,0,0,0.46)" }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      minHeight: 84,
      opacity,
      transform: `rotate(${rotation}deg) scale(${scale})`,
      transformOrigin: "center center",
      background: "linear-gradient(135deg, #faf2df 0%, #dfd1b2 100%)",
      color: INK,
      boxShadow: shadow,
      padding: "26px 28px 24px",
      border: "1px solid rgba(55,36,17,0.35)",
      overflow: "hidden",
    }}
  >
    <div style={{ position: "absolute", left: 0, top: 0, height: 9, width: "100%", background: accent }} />
    <div style={{ position: "absolute", right: -22, bottom: -22, width: 94, height: 94, border: `2px solid ${accent}`, borderRadius: "50%", opacity: 0.45 }} />
    {children}
  </div>
);

const Tape: React.FC<{ left: number; top: number; width: number; rotate?: number; opacity?: number }> = ({ left, top, width, rotate = -3, opacity = 1 }) => (
  <div style={{ position: "absolute", left, top, width, height: 34, opacity, background: "rgba(214,186,117,0.55)", border: "1px solid rgba(255,255,255,0.24)", transform: `rotate(${rotate}deg)`, mixBlendMode: "screen" }} />
);

const Caption: React.FC<{ kicker: string; lines: string[]; color?: string; x?: number; y?: number; opacity?: number; scale?: number }> = ({ kicker, lines, color = BONE, x = 56, y = 215, opacity = 1, scale = 1 }) => (
  <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${scale})`, transformOrigin: "left top", maxWidth: 830 }}>
    <div style={{ ...label, color: GOLD, fontSize: 22, marginBottom: 18 }}>{kicker}</div>
    {lines.map((line, index) => <div key={line} style={{ ...display, color: index === lines.length - 1 ? color : BONE, fontSize: 112, textShadow: "0 8px 24px rgba(0,0,0,0.62)" }}>{line}</div>)}
  </div>
);

const SceneOne: React.FC<{ frame: number; local: number; opacity: number }> = ({ frame, local, opacity }) => {
  const { fps } = useVideoConfig();
  const cardIn = spring({ frame: local - 9, fps, config: { damping: 14, stiffness: 104 } });
  const titleIn = spring({ frame: local - 3, fps, config: { damping: 18, stiffness: 100 } });
  const detach = progress(local, 67, 25);
  return (
    <AbsoluteFill style={{ opacity }}>
      <BackgroundPlate file={sceneFile("record")} frame={frame} local={local} dim={0.12} direction="up" />
      <Caption kicker="1977 / EARTH" lines={["A RECORD", "LEAVES", "EARTH."]} color={GOLD} opacity={titleIn} scale={interpolate(titleIn, [0, 1], [0.9, 1])} />
      <CutoutLayer
        file={assetFile("record", "record-cutout")}
        left={292 + detach * 55}
        top={996 - detach * 76}
        width={558}
        frame={frame}
        z={0.94}
        focus={rackFocus(local, 54, 22)}
        rotation={-12 + detach * 10}
        opacity={clamp01((local - 33) / 12)}
        scale={interpolate(detach, [0, 1], [0.82, 1.1])}
      />
      <Tape left={594} top={1040} width={230} opacity={cardIn * (1 - detach * 0.35)} />
      <TornPaperMatte seed={7} style={{ position: "absolute", left: 544 + detach * 410, top: 1050 - detach * 138, width: 386, height: 232, opacity: cardIn * (1 - detach), transform: `rotate(${-4 + detach * 26}deg) scale(${interpolate(detach, [0, 1], [1, 0.66])})`, transformOrigin: "center center" }}>
        <PaperCard left={0} top={0} width={330} accent={GOLD} shadow="0 28px 58px rgba(0,0,0,0.5)">
          <div style={{ ...label, fontSize: 17, color: BLUE }}>MISSION OBJECT</div>
          <div style={{ ...display, marginTop: 12, fontSize: 54, color: INK }}>GOLDEN<br />RECORD</div>
          <div style={{ ...label, marginTop: 17, fontSize: 15, color: "#55452d" }}>BOLTED TO A PROBE</div>
        </PaperCard>
      </TornPaperMatte>
      <div style={{ position: "absolute", left: 58, bottom: 166, color: BONE, ...label, fontSize: 20, opacity: clamp01((local - 30) / 14) }}>NOT A SYMBOL. A REAL, PLAYABLE MESSAGE.</div>
      <div style={{ position: "absolute", right: 54, bottom: 161, color: GOLD, ...label, fontSize: 17, opacity: clamp01((local - 39) / 12) }}>01 / THE RECORD</div>
    </AbsoluteFill>
  );
};

const EvidenceCard: React.FC<{
  title: string;
  detail: string;
  visual: "photo" | "hello" | "disc";
  left: number;
  top: number;
  local: number;
  delay: number;
  rotation: number;
  imageFile?: string;
}> = ({ title, detail, visual, left, top, local, delay, rotation, imageFile }) => {
  const { fps } = useVideoConfig();
  const entry = spring({ frame: local - delay, fps, config: { damping: 15, stiffness: 110 } });
  const fromX = left < 380 ? -420 : left > 600 ? 420 : 0;
  const fromY = top > 800 ? 360 : -300;
  const x = interpolate(entry, [0, 1], [fromX, 0]);
  const y = interpolate(entry, [0, 1], [fromY, 0]);
  return (
    <PaperCard left={left + x} top={top + y} width={252} rotation={rotation} opacity={entry} scale={interpolate(entry, [0, 1], [0.78, 1])} accent={visual === "disc" ? GOLD : RED}>
      <div style={{ height: 124, overflow: "hidden", background: visual === "photo" ? "linear-gradient(135deg, #3e3425, #b79758 55%, #1b1710)" : visual === "hello" ? "repeating-linear-gradient(20deg, #e7dbc2 0 8px, #7d3d30 9px 11px, #e7dbc2 12px 18px)" : "radial-gradient(circle at 52% 48%, #2a1a08 0 12%, #c58a25 13% 33%, #5b350f 34% 49%, #e4b84c 50% 64%, #18100a 65%)", border: "1px solid rgba(0,0,0,0.18)" }}>
        {imageFile ? <Img src={staticFile(imageFile)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.24)" }} /> : null}
      </div>
      <div style={{ ...display, fontSize: 50, marginTop: 17 }}>{title}</div>
      <div style={{ ...label, fontSize: 15, marginTop: 12, color: "#4b3d2b", lineHeight: 1.3 }}>{detail}</div>
    </PaperCard>
  );
};

const SceneTwo: React.FC<{ frame: number; local: number; opacity: number }> = ({ frame, local, opacity }) => {
  const lock = progress(local, 73, 17);
  return (
    <AbsoluteFill style={{ opacity, clipPath: lumaWipe(frame, 104, 14) }}>
      <BackgroundPlate file={sceneFile("inside")} frame={frame} local={local} dim={0.18} direction="right" />
      <div style={{ position: "absolute", left: 58, top: 196, width: 630, opacity: clamp01((local - 4) / 12) }}>
        <div style={{ ...label, color: GOLD, fontSize: 21, marginBottom: 16 }}>WHAT THEY PACKED</div>
        <div style={{ ...display, color: BONE, fontSize: 105 }}>A PLANET</div>
        <div style={{ ...display, color: GOLD, fontSize: 105 }}>IN IMAGES.</div>
      </div>
      <CutoutLayer file={assetFile("inside", "evidence-stack-cutout")} left={460} top={792} width={436} frame={frame} z={0.68} focus={0.68} rotation={7} opacity={clamp01((local - 11) / 13)} scale={0.96} />
      <EvidenceCard title="115" detail="IMAGES / EARTH" visual="photo" imageFile={assetFile("inside", "earth-photo")} left={54} top={642} local={local} delay={14} rotation={-8} />
      <EvidenceCard title="55" detail="GREETINGS / LANGUAGES" visual="hello" left={420} top={805} local={local} delay={26} rotation={5} />
      <EvidenceCard title="01" detail="GOLD RECORD" visual="disc" left={738} top={602} local={local} delay={38} rotation={-4} />
      <div style={{ position: "absolute", left: 58, right: 58, bottom: 193, height: 75, opacity: lock, background: BONE, color: INK, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 16px 30px rgba(0,0,0,0.42)" }}>
        <span style={{ ...display, fontSize: 48, letterSpacing: "-0.04em" }}>115 IMAGES / 55 GREETINGS</span>
      </div>
      <div style={{ position: "absolute", left: 58, bottom: 92, ...label, color: BONE, fontSize: 16, opacity: 0.7 }}>SOURCE NOTE / NASA + JPL RECORD INVENTORY</div>
    </AbsoluteFill>
  );
};

const EarthPhotoCard: React.FC<{ local: number }> = ({ local }) => {
  const unfold = progress(local, 8, 18);
  const thread = progress(local, 40, 42);
  const pull = interpolate(local, [0, 114], [1.28, 1.05], { extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", left: 52, top: 540, width: 412, height: 514, overflow: "hidden", opacity: unfold, transform: `${foldTransform(local, 8)} rotate(-4deg)`, transformOrigin: "left center", background: BONE, boxShadow: "0 26px 54px rgba(0,0,0,0.62)", border: "10px solid #e6d9bd" }}>
        <Img src={staticFile(assetFile("earth", "earth-photo"))} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${pull})`, filter: "contrast(1.15) saturate(1.08)" }} />
        <div style={{ position: "absolute", left: 20, top: 18, ...label, fontSize: 14, color: BONE, textShadow: "0 2px 7px #000" }}>NASA / VOYAGER 1 / 1990</div>
        <div style={{ position: "absolute", left: 20, bottom: 18, ...display, fontSize: 38, color: BONE, textShadow: "0 2px 10px #000" }}>EARTH.</div>
      </div>
      <Tape left={172} top={529} width={170} rotate={-5} opacity={unfold * 0.76} />
      <div style={{ opacity: thread }}><SignalThread frame={local} start={40} duration={42} path="M 426 798 C 536 706, 652 752, 724 866 S 814 1004, 942 1038" /></div>
    </>
  );
};

const SceneThree: React.FC<{ frame: number; local: number; opacity: number }> = ({ frame, local, opacity }) => {
  const captionIn = progress(local, 3, 16);
  return (
    <AbsoluteFill style={{ opacity, clipPath: lumaWipe(frame, 216, 14) }}>
      <BackgroundPlate file={sceneFile("earth")} frame={frame} local={local} dim={0.06} direction="left" />
      <CutoutLayer file={assetFile("earth", "probe-cutout")} left={456} top={910} width={570} frame={frame} z={0.92} focus={rackFocus(local, 38, 23)} rotation={-8} opacity={clamp01((local - 28) / 16)} scale={0.98} />
      <Caption kicker="THIRTEEN YEARS LATER" lines={["LOOK", "BACK.", "HOME."]} color={GOLD} x={54} y={194} opacity={captionIn} scale={interpolate(captionIn, [0, 1], [0.92, 1])} />
      <EarthPhotoCard local={local} />
      <div style={{ position: "absolute", right: 53, bottom: 163, background: "rgba(5,5,4,0.74)", borderLeft: `5px solid ${GOLD}`, padding: "18px 21px", ...label, color: BONE, fontSize: 17, opacity: clamp01((local - 58) / 12) }}>REAL EARTH / 1990</div>
    </AbsoluteFill>
  );
};

const SceneFour: React.FC<{ frame: number; local: number; opacity: number }> = ({ frame, local, opacity }) => {
  const { fps } = useVideoConfig();
  const titleIn = spring({ frame: local - 8, fps, config: { damping: 17, stiffness: 92 } });
  const slipOut = progress(local, 58, 40);
  return (
    <AbsoluteFill style={{ opacity, clipPath: lumaWipe(frame, 330, 14) }}>
      <BackgroundPlate file={sceneFile("distance")} frame={frame} local={local} dim={0.05} direction="up" />
      <CutoutLayer file={assetFile("distance", "record-cutout")} left={194 + slipOut * 42} top={1110 - slipOut * 58} width={492} frame={frame} z={0.82} focus={0.5} rotation={-14 + slipOut * 7} opacity={clamp01((local - 24) / 16)} scale={interpolate(slipOut, [0, 1], [0.84, 1.02])} />
      <CutoutLayer file={assetFile("distance", "probe-cutout")} left={390 + slipOut * 178} top={756 - slipOut * 162} width={620} frame={frame} z={0.96} focus={rackFocus(local, 28, 22)} rotation={-9 + slipOut * 12} opacity={clamp01((local - 18) / 16)} scale={interpolate(slipOut, [0, 1], [0.78, 1.18])} />
      <div style={{ position: "absolute", left: 0, top: 214, width: "100%", textAlign: "center", opacity: titleIn, transform: `translateY(${interpolate(titleIn, [0, 1], [38, 0])}px)` }}>
        <div style={{ ...label, color: GOLD, fontSize: 22, marginBottom: 24 }}>BEYOND THE SUN</div>
        <div style={{ ...display, color: BONE, fontSize: 143, textShadow: "0 10px 28px rgba(0,0,0,0.85)" }}>STILL</div>
        <div style={{ ...display, color: "#c63d2d", fontSize: 153, textShadow: "0 10px 28px rgba(0,0,0,0.85)" }}>OUTBOUND.</div>
        <div style={{ width: 470, height: 8, background: RED, margin: "31px auto 0" }} />
      </div>
      <PaperCard left={64 + slipOut * 360} top={1280 + slipOut * 178} width={296} rotation={-7 + slipOut * 19} opacity={1 - slipOut} scale={interpolate(slipOut, [0, 1], [1, 0.74])} accent={BLUE}>
        <div style={{ height: 112, overflow: "hidden", border: "1px solid rgba(40,30,20,0.25)", marginBottom: 14 }}><Img src={staticFile(assetFile("distance", "earth-slip"))} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.5)" }} /></div>
        <div style={{ ...label, fontSize: 15, color: BLUE }}>HOME / BEHIND</div>
        <div style={{ ...display, fontSize: 50, marginTop: 8 }}>PALE<br />BLUE DOT</div>
        <div style={{ ...label, fontSize: 14, marginTop: 16, color: "#544633" }}>EARTH / 1990</div>
      </PaperCard>
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 84, display: "flex", justifyContent: "space-between", color: BONE, ...label, fontSize: 15, opacity: clamp01((local - 70) / 16) }}><span>NASA / JPL / VOYAGER RECORD</span><span>04 / THE DISTANCE</span></div>
    </AbsoluteFill>
  );
};

export const VoyagerGoldenRecordCollageShort: React.FC = () => {
  const frame = useCurrentFrame();
  const [record, inside, earth, distance] = voyagerGoldenRecordAssetBoard.scenes;
  const visible = (scene: (typeof voyagerGoldenRecordAssetBoard.scenes)[number]) => frame >= scene.startFrame && frame < scene.startFrame + scene.durationInFrames + 12;
  const incoming = (scene: (typeof voyagerGoldenRecordAssetBoard.scenes)[number]) => clamp01((frame - scene.startFrame) / 10);

  return (
    <AbsoluteFill style={{ background: "#020202", overflow: "hidden" }}>
      {visible(record) ? <SceneOne frame={frame} local={frame - record.startFrame} opacity={incoming(record)} /> : null}
      {visible(inside) ? <SceneTwo frame={frame} local={frame - inside.startFrame} opacity={incoming(inside)} /> : null}
      {visible(earth) ? <SceneThree frame={frame} local={frame - earth.startFrame} opacity={incoming(earth)} /> : null}
      {visible(distance) ? <SceneFour frame={frame} local={frame - distance.startFrame} opacity={incoming(distance)} /> : null}
      <FilmTreatment frame={frame} />
    </AbsoluteFill>
  );
};
