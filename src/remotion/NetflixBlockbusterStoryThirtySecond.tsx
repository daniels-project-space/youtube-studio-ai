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

const BONE = "#f4ecdc";
const INK = "#090806";
const RED = "#d92d2b";
const BLUE = "#174567";
const YELLOW = "#e8c141";

const startup = "assets/shorts/netflix-blockbuster-story-v5/startup-original.png";
const meeting = "assets/shorts/netflix-blockbuster-story-v5/meeting-original.png";
const mail = "assets/shorts/netflix-blockbuster-story-v5/mail-original.png";
const closing = "assets/shorts/netflix-blockbuster-story-v5/closing-original.png";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const ease = (value: number): number => Easing.out(Easing.cubic)(clamp(value));
const inAt = (frame: number, start: number, duration = 13): number => ease((frame - start) / duration);

const display: React.CSSProperties = {
  fontFamily: "Arial Narrow, Impact, Arial Black, sans-serif",
  fontWeight: 900,
  letterSpacing: "-0.06em",
  lineHeight: 0.82,
  textTransform: "uppercase",
};

const label: React.CSSProperties = {
  fontFamily: "Courier New, monospace",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

const Backdrop: React.FC<{
  file: string;
  frame: number;
  local: number;
  direction?: "left" | "right" | "up";
  shade?: number;
  scale?: number;
}> = ({ file, frame, local, direction = "left", shade = 0.14, scale = 1.07 }) => {
  const p = interpolate(local, [0, 160], [0, 1], { extrapolateRight: "clamp" });
  const x = direction === "left" ? -36 * p : direction === "right" ? 36 * p : 0;
  const y = direction === "up" ? -44 * p : 0;
  return (
    <AbsoluteFill style={{ background: "#07090d" }}>
      <Img
        src={staticFile(file)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `${gateWeave(frame)} ${handheldDrift(frame, 0.34)} translate(${x}px, ${y}px) ${cameraPush(local, 0, 160, scale, scale + 0.075)}`,
          filter: "saturate(0.93) contrast(1.1) brightness(0.9)",
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${shade}) 0%, rgba(0,0,0,0.04) 49%, rgba(0,0,0,0.73) 100%)` }} />
      <div style={{ position: "absolute", left: 54, top: 58, color: BONE, fontSize: 17, opacity: 0.74, ...label }}>BUSINESS STORY / 2000—2010</div>
      <div style={{ position: "absolute", left: 54, top: 88, width: 184, height: 2, background: RED }} />
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
      background: "linear-gradient(135deg, #fff8e7 0%, #dbcaaa 100%)",
      border: "1px solid rgba(64,42,15,0.36)",
      color: INK,
      opacity,
      overflow: "hidden",
      transform: `rotate(${rotation}deg) scale(${scale})`,
      transformOrigin: "center center",
      ...paperShadow(1.4),
    }}
  >
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 8, background: accent }} />
    <div style={{ position: "absolute", right: -38, bottom: -38, width: 124, height: 124, border: `2px solid ${accent}`, borderRadius: "50%", opacity: 0.34 }} />
    {children}
  </div>
);

const Tape: React.FC<{ left: number; top: number; width: number; rotate?: number; opacity?: number }> = ({ left, top, width, rotate = -4, opacity = 1 }) => (
  <div style={{ position: "absolute", left, top, width, height: 34, opacity, transform: `rotate(${rotate}deg)`, background: "rgba(220,195,125,0.62)", border: "1px solid rgba(255,255,255,0.25)", mixBlendMode: "screen" }} />
);

const Heading: React.FC<{ kicker: string; lines: string[]; opacity: number; last?: string; top?: number; size?: number }> = ({ kicker, lines, opacity, last = RED, top = 210, size = 108 }) => (
  <div style={{ position: "absolute", left: 54, top, opacity }}>
    <div style={{ color: YELLOW, fontSize: 21, marginBottom: 18, ...label }}>{kicker}</div>
    {lines.map((line, index) => <div key={line} style={{ ...display, fontSize: size, color: index === lines.length - 1 ? last : BONE, textShadow: "0 8px 26px rgba(0,0,0,0.7)" }}>{line}</div>)}
  </div>
);

const SceneProblem: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const { fps } = useVideoConfig();
  const title = spring({ frame: local - 4, fps, config: { damping: 18, stiffness: 92 } });
  const note = spring({ frame: local - 29, fps, config: { damping: 15, stiffness: 105 } });
  return (
    <AbsoluteFill>
      <Backdrop file={startup} frame={frame} local={local} direction="up" shade={0.08} />
      <Heading kicker="YEAR 2000" lines={["NETFLIX", "IS BLEEDING."]} opacity={title} last={RED} />
      <TornPaperMatte seed={15} style={{ position: "absolute", left: 61, top: 1064, width: 382, opacity: note, transform: `translateY(${interpolate(note, [0, 1], [145, 0])}px) rotate(-5deg)` }}>
        <Paper left={0} top={0} width={324} accent={RED}>
          <div style={{ ...label, color: BLUE, fontSize: 15 }}>STARTUP PROBLEM</div>
          <div style={{ ...display, marginTop: 12, fontSize: 54 }}>CASH<br />RUNNING<br />OUT.</div>
        </Paper>
      </TornPaperMatte>
      <Tape left={111} top={1052} width={176} rotate={-8} opacity={note * 0.82} />
      <div style={{ position: "absolute", left: 54, bottom: 119, color: BONE, opacity: inAt(local, 50), fontSize: 17, ...label }}>SMALL STARTUP / BIG PROBLEM</div>
    </AbsoluteFill>
  );
};

const SceneOffer: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const offer = inAt(local, 3, 14);
  const sheet = inAt(local, 31, 18);
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 145, 15) }}>
      <Backdrop file={meeting} frame={frame} local={local} direction="right" shade={0.13} scale={1.08} />
      <Heading kicker="THE PITCH" lines={["BUY US.", "$50M."]} opacity={offer} last={YELLOW} />
      <Paper left={50} top={962} width={367} rotation={-4} accent={BLUE} opacity={sheet} scale={interpolate(sheet, [0, 1], [0.74, 1])}>
        <div style={{ ...label, color: BLUE, fontSize: 15 }}>THE OFFER</div>
        <div style={{ ...display, marginTop: 10, fontSize: 50 }}>NETFLIX<br />+ ONLINE</div>
        <div style={{ ...label, marginTop: 17, fontSize: 14, color: "#50412f" }}>BUY THE STARTUP / RUN THE WEB</div>
      </Paper>
      <Paper left={568} top={1110} width={318} rotation={6} accent={YELLOW} opacity={inAt(local, 49)} scale={interpolate(inAt(local, 49), [0, 1], [0.7, 1])}>
        <div style={{ ...display, fontSize: 65, color: BLUE }}>$50M</div>
        <div style={{ ...label, marginTop: 11, fontSize: 14, color: "#54432e" }}>THE ASK / 2000</div>
      </Paper>
      <SignalThread frame={local} start={59} duration={37} path="M 364 1140 C 454 1050, 564 1064, 684 1182 S 778 1254, 807 1251" color={YELLOW} />
      <div style={{ position: "absolute", right: 54, bottom: 114, color: BONE, opacity: inAt(local, 76), fontSize: 15, ...label }}>BLOCKBUSTER MEETING / 2000</div>
    </AbsoluteFill>
  );
};

const SceneNo: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const { fps } = useVideoConfig();
  const title = spring({ frame: local - 6, fps, config: { damping: 16, stiffness: 108 } });
  const stamp = spring({ frame: local - 39, fps, config: { damping: 14, stiffness: 130 } });
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 290, 15) }}>
      <Backdrop file={meeting} frame={frame} local={local} direction="left" shade={0.28} scale={1.15} />
      <Heading kicker="BLOCKBUSTER'S ANSWER" lines={["THEY", "PASSED."]} opacity={title} last={YELLOW} />
      <div style={{ position: "absolute", left: 130, top: 930, width: 792, height: 285, border: `22px solid ${RED}`, color: RED, display: "flex", alignItems: "center", justifyContent: "center", opacity: stamp, transform: `rotate(-8deg) scale(${interpolate(stamp, [0, 1], [1.7, 1])})`, mixBlendMode: "screen", boxShadow: "0 20px 45px rgba(0,0,0,0.4)" }}>
        <span style={{ ...display, fontSize: 170, letterSpacing: "-0.08em" }}>NO.</span>
      </div>
      <div style={{ position: "absolute", left: 54, bottom: 118, color: BONE, opacity: inAt(local, 69), fontSize: 18, ...label }}>THE DECISION THAT CHANGED THE MARKET</div>
    </AbsoluteFill>
  );
};

const SceneOpposite: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const title = inAt(local, 4, 15);
  const first = inAt(local, 28, 14);
  const second = inAt(local, 43, 14);
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 435, 15) }}>
      <Backdrop file={mail} frame={frame} local={local} direction="up" shade={0.08} scale={1.08} />
      <Heading kicker="NETFLIX DID THE OPPOSITE" lines={["NO LATE", "FEES."]} opacity={title} last={RED} />
      <Paper left={54} top={980} width={330} rotation={-5} accent={RED} opacity={first} scale={interpolate(first, [0, 1], [0.75, 1])}>
        <div style={{ ...display, fontSize: 59 }}>DVDs<br />BY MAIL.</div>
        <div style={{ ...label, marginTop: 16, color: "#50402e", fontSize: 14 }}>THE STORE COMES TO YOU</div>
      </Paper>
      <Paper left={604} top={1130} width={310} rotation={5} accent={YELLOW} opacity={second} scale={interpolate(second, [0, 1], [0.72, 1])}>
        <div style={{ ...display, fontSize: 59, color: BLUE }}>NO<br />STORES.</div>
        <div style={{ ...label, marginTop: 16, color: "#50402e", fontSize: 14 }}>CUSTOMER FIRST</div>
      </Paper>
      <SignalThread frame={local} start={57} duration={38} path="M 306 1166 C 450 1082, 557 1121, 666 1251 S 775 1310, 811 1302" color={RED} />
      <div style={{ position: "absolute", left: 55, bottom: 105, color: BONE, opacity: inAt(local, 84), fontSize: 15, ...label }}>THE NEW MODEL / CUSTOMER FIRST</div>
    </AbsoluteFill>
  );
};

const SceneFall: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const title = inAt(local, 5, 15);
  const card = inAt(local, 34, 18);
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 580, 15) }}>
      <Backdrop file={closing} frame={frame} local={local} direction="right" shade={0.09} scale={1.08} />
      <Heading kicker="TEN YEARS LATER" lines={["THE STORES", "GO DARK."]} opacity={title} last={YELLOW} />
      <Paper left={57} top={1050} width={411} rotation={-4} accent={RED} opacity={card} scale={interpolate(card, [0, 1], [0.7, 1])}>
        <div style={{ ...label, color: RED, fontSize: 15 }}>2010</div>
        <div style={{ ...display, marginTop: 11, fontSize: 56 }}>CHAPTER<br />11.</div>
        <div style={{ ...label, marginTop: 16, color: "#50402e", fontSize: 14 }}>BLOCKBUSTER FILES FOR BANKRUPTCY</div>
      </Paper>
      <div style={{ position: "absolute", right: 54, bottom: 114, color: BONE, opacity: inAt(local, 72), fontSize: 15, ...label }}>FIVE THOUSAND+ STORES / GONE</div>
    </AbsoluteFill>
  );
};

const SceneClose: React.FC<{ frame: number; local: number }> = ({ frame, local }) => {
  const { fps } = useVideoConfig();
  const title = spring({ frame: local - 6, fps, config: { damping: 18, stiffness: 90 } });
  const red = interpolate(local, [25, 149], [0.28, 0.84], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: lumaWipe(frame, 740, 15), background: "#090909" }}>
      <Backdrop file={mail} frame={frame} local={local} direction="left" shade={0.52} scale={1.18} />
      <div style={{ position: "absolute", inset: 0, opacity: red, mixBlendMode: "screen", background: "radial-gradient(circle at 50% 55%, rgba(213,37,36,0.92) 0%, rgba(116,8,14,0.46) 28%, transparent 58%)" }} />
      <div style={{ position: "absolute", top: 256, width: "100%", textAlign: "center", opacity: title, transform: `translateY(${interpolate(title, [0, 1], [36, 0])}px)` }}>
        <div style={{ color: YELLOW, fontSize: 22, marginBottom: 25, ...label }}>THE REVERSAL</div>
        <div style={{ ...display, color: BONE, fontSize: 137, textShadow: "0 10px 32px rgba(0,0,0,0.82)" }}>ONE</div>
        <div style={{ ...display, color: RED, fontSize: 154, textShadow: "0 10px 32px rgba(0,0,0,0.82)" }}>NO.</div>
        <div style={{ ...display, color: BONE, fontSize: 120, textShadow: "0 10px 32px rgba(0,0,0,0.82)" }}>EXPENSIVE.</div>
      </div>
      <Paper left={124} top={1248} width={688} rotation={-2} accent={RED} opacity={inAt(local, 44)} scale={interpolate(inAt(local, 44), [0, 1], [0.82, 1])}>
        <div style={{ ...label, color: RED, fontSize: 15 }}>WHAT FOLLOWED</div>
        <div style={{ ...display, marginTop: 13, fontSize: 58 }}>THE NEW WAY<br />TO WATCH.</div>
      </Paper>
      <div style={{ position: "absolute", left: 55, right: 55, bottom: 92, color: BONE, display: "flex", justifyContent: "space-between", opacity: inAt(local, 75), fontSize: 15, ...label }}><span>NETFLIX / BLOCKBUSTER</span><span>THE $50M NO</span></div>
    </AbsoluteFill>
  );
};

export const NetflixBlockbusterStoryThirtySecond: React.FC = () => {
  const frame = useCurrentFrame();
  const show = (start: number, end: number, render: (local: number) => React.ReactNode) => frame >= start && frame < end ? render(frame - start) : null;
  return (
    <AbsoluteFill style={{ background: "#050507", overflow: "hidden" }}>
      {show(0, 160, (local) => <SceneProblem frame={frame} local={local} />)}
      {show(145, 305, (local) => <SceneOffer frame={frame} local={local} />)}
      {show(290, 450, (local) => <SceneNo frame={frame} local={local} />)}
      {show(435, 595, (local) => <SceneOpposite frame={frame} local={local} />)}
      {show(580, 755, (local) => <SceneFall frame={frame} local={local} />)}
      {show(740, 900, (local) => <SceneClose frame={frame} local={local} />)}
      <FilmTreatment frame={frame} />
    </AbsoluteFill>
  );
};
