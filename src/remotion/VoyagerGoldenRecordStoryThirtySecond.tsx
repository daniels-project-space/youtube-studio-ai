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
import {
  cameraPush,
  CutoutLayer,
  FilmTreatment,
  foldTransform,
  gateWeave,
  handheldDrift,
  lumaWipe,
  paperShadow,
  rackFocus,
  SignalThread,
  TornPaperMatte,
} from "./motion/EditorialAssetLibrary";

const BONE = "#f4ecdb";
const INK = "#0b0906";
const GOLD = "#d6a039";
const RED = "#9d3026";
const BLUE = "#183e55";
const NAVY = "#050b12";

const cleanroom = "assets/shorts/voyager-30s-cleanroom-original-v5.png";
const messageTable = "assets/shorts/voyager-30s-message-table-original-v5.png";
const recordPhoto = "assets/documentary-standard/v1/nasa/voyager-golden-record-pia14113.jpg";
const blueMarble = "assets/documentary-standard/v1/nasa/blue-marble-earth-pia18033.jpg";
const paleDot = "assets/documentary-standard/v1/nasa/pale-blue-dot-pia00452.jpg";
const paleDotRevisited = "assets/documentary-standard/v1/nasa/pale-blue-dot-revisited-pia23645.jpg";
const recordCutout = "assets/shorts/voyager-golden-record-v3/gold-record-cutout.png";
const probeCutout = "assets/shorts/voyager-golden-record-v3/probe-cutout.png";
const departure = "assets/shorts/voyager-golden-record-v2/probe-departure.png";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const ease = (value: number): number => Easing.out(Easing.cubic)(clamp01(value));
const enter = (frame: number, start: number, duration = 12): number => ease((frame - start) / duration);

const display: React.CSSProperties = {
  fontFamily: "Arial Narrow, Impact, Arial Black, sans-serif",
  fontWeight: 900,
  letterSpacing: "-0.055em",
  lineHeight: 0.84,
  textTransform: "uppercase",
};

const label: React.CSSProperties = {
  fontFamily: "Courier New, monospace",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

const Background: React.FC<{
  file: string;
  frame: number;
  local: number;
  direction?: "left" | "right" | "up" | "down";
  dim?: number;
  scale?: number;
}> = ({ file, frame, local, direction = "left", dim = 0.2, scale = 1.06 }) => {
  const move = interpolate(local, [0, 150], [0, 1], { extrapolateRight: "clamp" });
  const x = direction === "left" ? -36 * move : direction === "right" ? 36 * move : 0;
  const y = direction === "up" ? -42 * move : direction === "down" ? 42 * move : 0;
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Img
        src={staticFile(file)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `${gateWeave(frame)} ${handheldDrift(frame, 0.33)} translate(${x}px, ${y}px) ${cameraPush(local, 0, 150, scale, scale + 0.075)}`,
          filter: "contrast(1.1) saturate(0.93) brightness(0.9)",
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim}) 0%, rgba(0,0,0,0.04) 46%, rgba(0,0,0,0.7) 100%)` }} />
      <div style={{ position: "absolute", left: 55, top: 58, color: BONE, fontSize: 17, opacity: 0.72, ...label }}>ARCHIVE / GOLDEN RECORD</div>
      <div style={{ position: "absolute", left: 55, top: 87, width: 188, height: 2, background: GOLD }} />
    </AbsoluteFill>
  );
};

const Paper: React.FC<{
  left: number;
  top: number;
  width: number;
  rotation?: number;
  opacity?: number;
  scale?: number;
  accent?: string;
  children: React.ReactNode;
}> = ({ left, top, width, rotation = 0, opacity = 1, scale = 1, accent = RED, children }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      padding: "25px 27px 24px",
      background: "linear-gradient(135deg, #fff7e8 0%, #dfd0af 100%)",
      color: INK,
      border: "1px solid rgba(58,38,13,0.36)",
      overflow: "hidden",
      opacity,
      transform: `rotate(${rotation}deg) scale(${scale})`,
      transformOrigin: "center center",
      ...paperShadow(1.35),
    }}
  >
    <div style={{ position: "absolute", inset: "0 0 auto", height: 8, background: accent }} />
    <div style={{ position: "absolute", right: -40, bottom: -40, width: 132, height: 132, border: `2px solid ${accent}`, opacity: 0.32, borderRadius: "50%" }} />
    {children}
  </div>
);

const Tape: React.FC<{ left: number; top: number; width: number; rotate?: number; opacity?: number }> = ({ left, top, width, rotate = -3, opacity = 1 }) => (
  <div style={{ position: "absolute", left, top, width, height: 33, opacity, transform: `rotate(${rotate}deg)`, background: "rgba(221,195,125,0.62)", border: "1px solid rgba(255,255,255,0.25)", mixBlendMode: "screen" }} />
);

const Kicker: React.FC<{ children: React.ReactNode; left?: number; top?: number; opacity?: number }> = ({ children, left = 55, top = 205, opacity = 1 }) => (
  <div style={{ position: "absolute", left, top, color: GOLD, fontSize: 21, opacity, ...label }}>{children}</div>
);

const Headline: React.FC<{ lines: string[]; left?: number; top?: number; opacity?: number; lastColor?: string; size?: number }> = ({ lines, left = 52, top = 248, opacity = 1, lastColor = GOLD, size = 108 }) => (
  <div style={{ position: "absolute", left, top, opacity, maxWidth: 875 }}>
    {lines.map((line, index) => <div key={line} style={{ ...display, fontSize: size, color: index === lines.length - 1 ? lastColor : BONE, textShadow: "0 8px 26px rgba(0,0,0,0.66)" }}>{line}</div>)}
  </div>
);

const SceneLaunch: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const { fps } = useVideoConfig();
  const title = spring({ frame: local - 4, fps, config: { damping: 18, stiffness: 92 } });
  const evidence = spring({ frame: local - 24, fps, config: { damping: 15, stiffness: 108 } });
  return (
    <AbsoluteFill>
      <Background file={cleanroom} frame={frame} local={local} direction="up" dim={0.08} />
      <Kicker opacity={title}>1977 / TWO VOYAGERS</Kicker>
      <Headline lines={["TWO PROBES", "LEAVE EARTH."]} opacity={title} lastColor={GOLD} />
      <CutoutLayer file={recordCutout} left={502} top={1002} width={464} frame={frame} z={0.94} focus={rackFocus(local, 34, 22)} rotation={-14} opacity={enter(local, 30)} scale={interpolate(local, [30, 145], [0.76, 1.06], { extrapolateRight: "clamp" })} />
      <TornPaperMatte seed={11} style={{ position: "absolute", left: 64, top: 1085, width: 365, opacity: evidence, transform: `translateY(${interpolate(evidence, [0, 1], [140, 0])}px) rotate(-5deg)` }}>
        <Paper left={0} top={0} width={310} accent={GOLD}>
          <div style={{ ...label, fontSize: 15, color: BLUE }}>MISSION CARGO</div>
          <div style={{ ...display, marginTop: 12, fontSize: 53 }}>GOLD-<br />PLATED<br />RECORD</div>
        </Paper>
      </TornPaperMatte>
      <Tape left={118} top={1073} width={166} rotate={-8} opacity={evidence * 0.8} />
      <div style={{ position: "absolute", left: 56, bottom: 118, color: BONE, fontSize: 18, opacity: enter(local, 50), ...label }}>A PLAYABLE MESSAGE / BOLTED TO EACH PROBE</div>
    </AbsoluteFill>
  );
};

const SceneObject: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const photoIn = enter(local, 2, 16);
  const card = enter(local, 28, 15);
  const turn = interpolate(local, [0, 145], [-9, 7], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 145, 15) }}>
      <Background file={recordPhoto} frame={frame} local={local} direction="right" dim={0.13} scale={1.08} />
      <Kicker opacity={photoIn}>NOT A SYMBOL</Kicker>
      <Headline lines={["A REAL", "MESSAGE."]} opacity={photoIn} lastColor={GOLD} />
      <div style={{ position: "absolute", left: 455, top: 728, width: 540, height: 540, borderRadius: "50%", overflow: "hidden", opacity: card, transform: `rotate(${turn}deg) scale(${interpolate(card, [0, 1], [0.72, 1])})`, boxShadow: "0 34px 76px rgba(0,0,0,0.72)" }}>
        <Img src={staticFile(recordPhoto)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.72) translate(-9%, 6%)", filter: "saturate(1.1) contrast(1.14)" }} />
      </div>
      <Paper left={54} top={1050} width={350} rotation={-4} accent={RED} opacity={enter(local, 43)} scale={interpolate(enter(local, 43), [0, 1], [0.8, 1])}>
        <div style={{ ...label, fontSize: 15, color: RED }}>PHYSICAL OBJECT</div>
        <div style={{ ...display, marginTop: 11, fontSize: 49 }}>PLAY<br />ME.</div>
        <div style={{ ...label, fontSize: 14, marginTop: 16, color: "#514331" }}>SOUND + IMAGE / ONE DISC</div>
      </Paper>
      <SignalThread frame={local} start={56} duration={38} path="M 299 1218 C 434 1138, 538 1055, 655 936 S 764 838, 823 826" />
      <div style={{ position: "absolute", right: 54, bottom: 117, color: BONE, fontSize: 16, opacity: enter(local, 73), ...label }}>02 / THE OBJECT</div>
    </AbsoluteFill>
  );
};

const ContentsCard: React.FC<{ title: string; detail: string; file?: string; local: number; delay: number; left: number; top: number; rotate: number; accent: string }> = ({ title, detail, file, local, delay, left, top, rotate, accent }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: local - delay, fps, config: { damping: 15, stiffness: 105 } });
  return (
    <Paper left={left} top={top} width={252} rotation={rotate} accent={accent} opacity={p} scale={interpolate(p, [0, 1], [0.7, 1])}>
      <div style={{ height: 132, marginBottom: 16, overflow: "hidden", background: file ? "#17130e" : "repeating-linear-gradient(15deg, #d8c69e 0 10px, #7c392a 11px 14px, #d8c69e 15px 21px)" }}>
        {file ? <Img src={staticFile(file)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.26)" }} /> : null}
      </div>
      <div style={{ ...display, fontSize: 56 }}>{title}</div>
      <div style={{ ...label, marginTop: 10, fontSize: 14, lineHeight: 1.3, color: "#50402d" }}>{detail}</div>
    </Paper>
  );
};

const SceneContents: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const word = enter(local, 4);
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 290, 15) }}>
      <Background file={messageTable} frame={frame} local={local} direction="down" dim={0.18} scale={1.05} />
      <Kicker opacity={word}>INSIDE THE RECORD</Kicker>
      <Headline lines={["A PLANET", "IN PIECES."]} opacity={word} lastColor={GOLD} />
      <ContentsCard title="115" detail="IMAGES / EARTH" file={blueMarble} local={local} delay={23} left={48} top={708} rotate={-8} accent={GOLD} />
      <ContentsCard title="55" detail="GREETINGS / LANGUAGES" local={local} delay={36} left={414} top={830} rotate={5} accent={RED} />
      <ContentsCard title="LIFE" detail="SOUNDS / EARTH" file={cleanroom} local={local} delay={49} left={744} top={677} rotate={-4} accent={BLUE} />
      <div style={{ position: "absolute", left: 53, right: 53, bottom: 180, height: 76, display: "flex", alignItems: "center", justifyContent: "center", color: INK, background: BONE, opacity: enter(local, 91), ...display, fontSize: 46, boxShadow: "0 18px 45px rgba(0,0,0,0.5)" }}>115 IMAGES / 55 GREETINGS</div>
      <div style={{ position: "absolute", left: 54, bottom: 97, color: BONE, opacity: 0.75, fontSize: 15, ...label }}>EARTH / NOT AN ABSTRACTION</div>
    </AbsoluteFill>
  );
};

const SceneQuestion: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const title = enter(local, 5, 15);
  const blue = enter(local, 30, 18);
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 450, 15) }}>
      <Background file={blueMarble} frame={frame} local={local} direction="left" dim={0.15} scale={1.14} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(100deg, rgba(1,5,9,0.78), transparent 72%)" }} />
      <Kicker opacity={title}>THE IMPOSSIBLE BRIEF</Kicker>
      <Headline lines={["EXPLAIN", "EARTH."]} opacity={title} lastColor={GOLD} />
      <Paper left={563} top={936} width={382} rotation={6} accent={BLUE} opacity={blue} scale={interpolate(blue, [0, 1], [0.72, 1])}>
        <div style={{ ...label, fontSize: 15, color: BLUE }}>TO WHOEVER FINDS IT</div>
        <div style={{ ...display, marginTop: 12, fontSize: 48 }}>THIS IS<br />HOME.</div>
        <div style={{ ...label, marginTop: 18, fontSize: 14, color: "#50412f" }}>IMAGE / SOUND / GREETING</div>
      </Paper>
      <Tape left={661} top={921} width={174} rotate={5} opacity={blue * 0.8} />
      <CutoutLayer file={recordCutout} left={48} top={1162} width={378} frame={frame} z={0.87} focus={rackFocus(local, 55, 20)} rotation={-12} opacity={enter(local, 52)} scale={1} />
      <div style={{ position: "absolute", left: 55, bottom: 105, color: BONE, fontSize: 16, opacity: enter(local, 78), ...label }}>04 / THE QUESTION</div>
    </AbsoluteFill>
  );
};

const ScenePaleDot: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const title = enter(local, 5, 15);
  const photo = enter(local, 30, 20);
  const pull = interpolate(local, [0, 150], [1.24, 1.02], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 600, 16) }}>
      <Background file={paleDotRevisited} frame={frame} local={local} direction="up" dim={0.03} scale={1.08} />
      <Kicker opacity={title}>1990 / LOOK BACK</Kicker>
      <Headline lines={["HOME IS", "ONE DOT."]} opacity={title} lastColor={GOLD} />
      <div style={{ position: "absolute", left: 48, top: 812, width: 417, height: 538, padding: 11, background: "#e6d9bc", opacity: photo, transform: `${foldTransform(local, 30)} rotate(-4deg)`, transformOrigin: "left center", ...paperShadow(1.4) }}>
        <Img src={staticFile(paleDot)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${pull})`, filter: "contrast(1.2) saturate(1.08)" }} />
        <div style={{ position: "absolute", left: 24, bottom: 23, color: BONE, fontSize: 16, textShadow: "0 2px 8px #000", ...label }}>REAL EARTH / VOYAGER 1</div>
      </div>
      <Tape left={148} top={798} width={166} rotate={-5} opacity={photo * 0.75} />
      <CutoutLayer file={probeCutout} left={496} top={978} width={506} frame={frame} z={0.95} focus={rackFocus(local, 47, 22)} rotation={-7} opacity={enter(local, 57)} scale={interpolate(local, [58, 149], [0.76, 1.07], { extrapolateRight: "clamp" })} />
      <SignalThread frame={local} start={65} duration={42} path="M 421 1071 C 535 972, 650 1030, 762 1130 S 869 1224, 913 1248" />
      <div style={{ position: "absolute", right: 52, bottom: 110, color: BONE, fontSize: 15, opacity: enter(local, 94), ...label }}>05 / THE PALE BLUE DOT</div>
    </AbsoluteFill>
  );
};

const SceneClose: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const { fps } = useVideoConfig();
  const title = spring({ frame: local - 5, fps, config: { damping: 18, stiffness: 88 } });
  const out = interpolate(local, [45, 149], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 750, 16) }}>
      <Background file={departure} frame={frame} local={local} direction="up" dim={0.12} scale={1.08} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(2,5,9,0.08), rgba(2,5,9,0.65))" }} />
      <div style={{ position: "absolute", top: 235, width: "100%", textAlign: "center", opacity: title, transform: `translateY(${interpolate(title, [0, 1], [35, 0])}px)` }}>
        <div style={{ ...label, color: GOLD, fontSize: 22, marginBottom: 24 }}>INTERSTELLAR SPACE</div>
        <div style={{ ...display, color: BONE, fontSize: 136, textShadow: "0 10px 30px rgba(0,0,0,0.8)" }}>STILL</div>
        <div style={{ ...display, color: RED, fontSize: 149, textShadow: "0 10px 30px rgba(0,0,0,0.8)" }}>HELLO.</div>
      </div>
      <CutoutLayer file={probeCutout} left={313 + out * 316} top={840 - out * 326} width={660} frame={frame} z={0.98} focus={rackFocus(local, 25, 20)} rotation={-10 + out * 13} opacity={enter(local, 22)} scale={interpolate(out, [0, 1], [0.88, 1.26])} />
      <CutoutLayer file={recordCutout} left={65 + out * 167} top={1280 - out * 110} width={386} frame={frame} z={0.78} focus={0.83} rotation={-14 + out * 8} opacity={enter(local, 32) * (1 - out * 0.42)} scale={interpolate(out, [0, 1], [1, 0.72])} />
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 94, display: "flex", justifyContent: "space-between", color: BONE, fontSize: 15, opacity: enter(local, 70), ...label }}><span>ONE RECORD / OUR HELLO</span><span>06 / OUTBOUND</span></div>
    </AbsoluteFill>
  );
};

export const VoyagerGoldenRecordStoryThirtySecond: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = (start: number, end: number, component: (local: number) => React.ReactNode) => frame >= start && frame < end ? component(frame - start) : null;
  return (
    <AbsoluteFill style={{ background: "#020307", overflow: "hidden" }}>
      {scene(0, 160, (local) => <SceneLaunch frame={frame} local={local} />)}
      {scene(145, 305, (local) => <SceneObject frame={frame} local={local} />)}
      {scene(290, 465, (local) => <SceneContents frame={frame} local={local} />)}
      {scene(450, 615, (local) => <SceneQuestion frame={frame} local={local} />)}
      {scene(600, 765, (local) => <ScenePaleDot frame={frame} local={local} />)}
      {scene(750, 900, (local) => <SceneClose frame={frame} local={local} />)}
      <FilmTreatment frame={frame} />
    </AbsoluteFill>
  );
};
