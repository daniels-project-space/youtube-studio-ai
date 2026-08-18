import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

const W = 1080;
const H = 1920;
const PAPER = "#f7f0df";
const INK = "#06101f";
const AMBER = "#f6b93b";
const CYAN = "#62e7ff";
const RED = "#ff5b45";

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
const enter = (frame: number, start: number, duration = 16): number => clamp((frame - start) / duration);
const fade = (frame: number, start: number, end: number, ramp = 12): number => Math.min(
  enter(frame, start, ramp),
  clamp((end - frame) / ramp),
);
const fract = (value: number): number => value - Math.floor(value);
const hash = (seed: number): number => fract(Math.sin(seed * 91.173) * 48271.118);

const display: React.CSSProperties = {
  color: PAPER,
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: 900,
  letterSpacing: "-0.075em",
  lineHeight: 0.84,
  textTransform: "uppercase",
};

const mono: React.CSSProperties = {
  color: PAPER,
  fontFamily: "Courier New, monospace",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const Stars: React.FC<{ frame: number; drift: number }> = ({ frame, drift }) => (
  <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
    {Array.from({ length: 126 }, (_, index) => {
      const x = hash(index + 11) * W;
      const y = hash(index + 73) * H;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(frame / (11 + (index % 7)) + index));
      const size = index % 19 === 0 ? 4 : index % 5 === 0 ? 2.2 : 1.1;
      const dy = ((frame * drift * (0.22 + hash(index + 31))) % H + H) % H;
      return <circle key={index} cx={x} cy={(y + dy) % H} r={size} fill={index % 9 === 0 ? CYAN : PAPER} opacity={twinkle * (index % 9 === 0 ? 0.72 : 0.46)} />;
    })}
  </svg>
);

const Scanlines: React.FC<{ frame: number }> = ({ frame }) => (
  <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, opacity: 0.18, mixBlendMode: "screen" }}>
    {Array.from({ length: 60 }, (_, index) => {
      const y = (index * 37 + frame * (index % 3 === 0 ? 2 : 0.4)) % H;
      return <line key={index} x1="0" x2={W} y1={y} y2={y} stroke={index % 8 === 0 ? CYAN : PAPER} strokeWidth={index % 8 === 0 ? 1.4 : 0.45} opacity={0.22 + hash(index) * 0.25} />;
    })}
  </svg>
);

const Record: React.FC<{ x: number; y: number; radius: number; frame: number; scale?: number; opacity?: number }> = ({ x, y, radius, frame, scale = 1, opacity = 1 }) => {
  const spin = frame * 1.12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "visible", opacity }}>
      <defs>
        <radialGradient id="gold-disc" cx="35%" cy="30%"><stop offset="0" stopColor="#ffe797" /><stop offset="0.26" stopColor="#f6b93b" /><stop offset="0.7" stopColor="#a96818" /><stop offset="1" stopColor="#301907" /></radialGradient>
        <filter id="gold-glow"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>
      <g transform={`translate(${x} ${y}) rotate(${spin}) scale(${scale})`}>
        <circle r={radius + 22} fill={AMBER} opacity="0.18" filter="url(#gold-glow)" />
        <circle r={radius} fill="url(#gold-disc)" stroke="#ffe8ab" strokeWidth="4" />
        {[0.8, 0.66, 0.51, 0.34].map((ratio) => <circle key={ratio} r={radius * ratio} fill="none" stroke="#ffe8ab" strokeWidth="2" opacity="0.6" />)}
        <circle r={radius * 0.19} fill={INK} stroke="#ffe8ab" strokeWidth="3" />
        <circle r={radius * 0.055} fill={PAPER} />
        {Array.from({ length: 36 }, (_, index) => {
          const angle = (index / 36) * Math.PI * 2;
          return <line key={index} x1={Math.cos(angle) * radius * 0.84} y1={Math.sin(angle) * radius * 0.84} x2={Math.cos(angle) * radius * 0.94} y2={Math.sin(angle) * radius * 0.94} stroke="#211306" strokeWidth={index % 5 === 0 ? 3.2 : 1.2} opacity="0.7" />;
        })}
        <path d={`M ${-radius * 0.7} ${radius * 0.12} C ${-radius * 0.2} ${-radius * 0.1}, ${radius * 0.25} ${radius * 0.29}, ${radius * 0.72} ${-radius * 0.18}`} fill="none" stroke={RED} strokeWidth="5" strokeDasharray="8 13" opacity="0.88" />
        <text x="0" y={radius * 0.08} textAnchor="middle" fill={PAPER} style={{ fontFamily: "Courier New, monospace", fontWeight: 900, fontSize: radius * 0.105, letterSpacing: "0.15em" }}>EARTH / 1977</text>
      </g>
    </svg>
  );
};

const Probe: React.FC<{ x: number; y: number; scale: number; frame: number; opacity?: number }> = ({ x, y, scale, frame, opacity = 1 }) => (
  <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "visible", opacity }}>
    <defs><filter id="probe-glow"><feGaussianBlur stdDeviation="10" /></filter></defs>
    <g transform={`translate(${x} ${y + Math.sin(frame / 16) * 4}) scale(${scale})`}>
      <circle cx="0" cy="0" r="155" fill={CYAN} opacity="0.1" filter="url(#probe-glow)" />
      <path d="M-126 20 L-22 -72 L118 -30 L174 48 L25 78 L-124 54 Z" fill="#172c42" stroke={PAPER} strokeWidth="5" />
      <path d="M-124 54 L-278 98 L-230 152 L-70 96 Z" fill="#286077" stroke={CYAN} strokeWidth="4" />
      <path d="M-84 -2 L-255 -66 L-300 -16 L-126 42 Z" fill="#286077" stroke={CYAN} strokeWidth="4" />
      <circle cx="88" cy="-58" r="76" fill="none" stroke={PAPER} strokeWidth="10" />
      <circle cx="88" cy="-58" r="51" fill="none" stroke={CYAN} strokeWidth="3" strokeDasharray="4 7" />
      <path d="M15 -45 L69 -54" stroke={PAPER} strokeWidth="8" />
      <path d="M-16 71 L-56 196" stroke={PAPER} strokeWidth="7" />
      <circle cx="-56" cy="202" r="18" fill={AMBER} />
      <circle cx="-56" cy="202" r="34" fill="none" stroke={AMBER} strokeWidth="3" opacity="0.7" />
    </g>
  </svg>
);

const Signal: React.FC<{ frame: number; y: number; opacity: number }> = ({ frame, y, opacity }) => {
  const points = Array.from({ length: 82 }, (_, index) => {
    const x = 54 + index * 12;
    const distance = Math.abs(index - ((frame * 1.4) % 82));
    const pulse = Math.max(0, 1 - distance / 16);
    const yy = y + Math.sin(index * 0.72 + frame * 0.22) * (14 + 86 * pulse) + Math.sin(index * 0.18) * 18;
    return `${x.toFixed(1)},${yy.toFixed(1)}`;
  }).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, opacity }}><polyline points={points} fill="none" stroke={CYAN} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /><line x1="54" x2="1026" y1={y} y2={y} stroke={PAPER} strokeWidth="1" opacity="0.42" /></svg>;
};

const Card: React.FC<{ x: number; y: number; value: string; label: string; start: number; frame: number; color: string }> = ({ x, y, value, label, start, frame, color }) => {
  const p = enter(frame, start, 15);
  return (
    <div style={{ position: "absolute", left: x, top: y + interpolate(p, [0, 1], [65, 0]), width: 310, height: 240, opacity: p, transform: `rotate(${interpolate(p, [0, 1], [-9, 0])}deg)`, background: PAPER, border: `4px solid ${INK}`, boxShadow: "17px 18px 0 rgba(0,0,0,0.42)", padding: "28px 24px", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 14, background: color }} />
      <div style={{ color: INK, fontFamily: "Arial Black, Arial, sans-serif", fontWeight: 900, fontSize: 76, letterSpacing: "-0.08em", lineHeight: 0.8 }}>{value}</div>
      <div style={{ color: INK, fontFamily: "Courier New, monospace", fontWeight: 900, fontSize: 26, marginTop: 23, lineHeight: 1.12, letterSpacing: "0.045em", whiteSpace: "pre-line" }}>{label}</div>
      <div style={{ position: "absolute", right: -25, bottom: -25, width: 94, height: 94, border: `4px solid ${color}`, borderRadius: "50%", opacity: 0.75 }} />
    </div>
  );
};

const Sources: React.FC = () => <><div style={{ position: "absolute", left: 58, bottom: 61 }}><div style={{ ...mono, color: PAPER, fontSize: 18, opacity: 0.72 }}>SOURCE // NASA · JPL · GOLDEN RECORD</div><div style={{ marginTop: 10, width: 308, height: 2, background: RED }} /></div><div style={{ position: "absolute", right: 53, bottom: 59, ...mono, color: CYAN, fontSize: 17, opacity: 0.7 }}>ORIGINAL / PROCEDURAL / 15S</div></>;

export const VoyagerGoldenRecordShort: React.FC = () => {
  const frame = useCurrentFrame();
  const sceneA = fade(frame, 0, 86);
  const sceneB = fade(frame, 70, 176);
  const sceneC = fade(frame, 158, 266);
  const sceneD = fade(frame, 244, 366);
  const sceneE = fade(frame, 344, 450);
  const finalScale = interpolate(clamp((frame - 354) / 92), [0, 1], [1, 0.075]);

  return <AbsoluteFill style={{ background: `radial-gradient(circle at 52% 31%, #193453 0%, ${INK} 46%, #02050b 100%)`, overflow: "hidden" }}>
    <Stars frame={frame} drift={sceneD > 0.1 ? -0.95 : -0.23} />
    <Scanlines frame={frame} />
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,16,31,0.18), rgba(0,0,0,0.72))" }} />
    <div style={{ position: "absolute", left: 58, top: 66 }}><div style={{ ...mono, color: CYAN, fontSize: 20 }}>ARCHIVE / OUTBOUND 1977</div><div style={{ width: 316, height: 2, background: CYAN, marginTop: 13 }} /></div>

    {sceneA > 0 && <><Record x={540} y={980} radius={286} frame={frame} scale={interpolate(enter(frame, 0, 24), [0, 1], [0.45, 1])} opacity={sceneA} /><div style={{ position: "absolute", left: 58, top: 258, opacity: sceneA }}><div style={{ ...mono, color: AMBER, fontSize: 23, marginBottom: 20 }}>1977 // EARTH EXPORT</div><div style={{ ...display, fontSize: 118 }}>A RECORD</div><div style={{ ...display, fontSize: 118, color: AMBER }}>FOR THE</div><div style={{ ...display, fontSize: 118 }}>DARK.</div></div><Signal frame={frame} y={1452} opacity={sceneA} /><div style={{ position: "absolute", left: 58, top: 1558, width: 805, ...mono, fontSize: 30, color: PAPER, opacity: sceneA, lineHeight: 1.34 }}>NASA sent a playable message beyond the edge of home.</div></>}

    {sceneB > 0 && <><div style={{ position: "absolute", left: 58, top: 330, opacity: sceneB }}><div style={{ ...display, fontSize: 100 }}>NOT A</div><div style={{ ...display, fontSize: 100, color: RED }}>SYMBOL.</div><div style={{ ...mono, color: PAPER, fontSize: 26, marginTop: 28, width: 410, lineHeight: 1.3 }}>A REAL, PLAYABLE MESSAGE.</div></div><Record x={823} y={980} radius={165} frame={frame} scale={interpolate(enter(frame, 82, 18), [0, 1], [1.15, 0.78])} opacity={sceneB} /><Probe x={interpolate(enter(frame, 80, 22), [0, 1], [-200, 408])} y={1040} scale={1.15} frame={frame} opacity={sceneB} /><div style={{ position: "absolute", left: 60, top: 1455, ...mono, fontSize: 24, color: CYAN, opacity: sceneB }}>DISTANCE: OPEN // DIRECTION: OUTBOUND</div></>}

    {sceneC > 0 && <><div style={{ position: "absolute", left: 58, top: 312, opacity: sceneC }}><div style={{ ...display, fontSize: 90 }}>PACKED</div><div style={{ ...display, fontSize: 90, color: CYAN }}>WITH US.</div></div><Card x={58} y={590} value="115" label={"IMAGES\nOF EARTH"} start={164} frame={frame} color={AMBER} /><Card x={391} y={742} value="55" label={"LANGUAGES\nSAY HELLO"} start={182} frame={frame} color={CYAN} /><Card x={716} y={554} value="1" label={"GOLD\nRECORD"} start={200} frame={frame} color={RED} /><div style={{ position: "absolute", left: 62, top: 1272, width: 956, opacity: enter(frame, 172, 14) }}><div style={{ height: 2, background: CYAN, width: `${Math.round(enter(frame, 172, 14) * 100)}%` }} /><div style={{ ...mono, fontSize: 23, color: CYAN, marginTop: 17 }}>RECORDED FACTS // VOYAGER GOLDEN RECORD</div><div style={{ ...mono, fontSize: 19, color: PAPER, opacity: 0.68, marginTop: 10 }}>001010 110001 1977 // GOLDEN RECORD</div></div><Signal frame={frame + 15} y={1550} opacity={sceneC} /></>}

    {sceneD > 0 && <><Probe x={interpolate(clamp((frame - 244) / 105), [0, 1], [610, -30])} y={interpolate(clamp((frame - 244) / 105), [0, 1], [908, 418])} scale={0.77} frame={frame} opacity={sceneD} /><div style={{ position: "absolute", left: 60, top: 360, opacity: sceneD, width: 870 }}><div style={{ ...display, fontSize: 103 }}>VOYAGER</div><div style={{ ...display, fontSize: 103, color: AMBER }}>NEVER</div><div style={{ ...display, fontSize: 103 }}>STOPPED.</div></div><div style={{ position: "absolute", left: 60, top: 737, width: 860, opacity: sceneD }}><div style={{ ...mono, color: CYAN, fontSize: 29, lineHeight: 1.28 }}>NOW THE FARTHEST HUMAN-MADE OBJECT.</div><div style={{ marginTop: 19, height: 3, background: CYAN, width: `${Math.round(enter(frame, 272, 28) * 100)}%` }} /></div>{Array.from({ length: 9 }, (_, index) => <div key={index} style={{ position: "absolute", left: 60 + index * 108, top: 1190 + index * 39, width: 300 - index * 21, height: 2, background: index % 2 ? CYAN : PAPER, opacity: sceneD * (0.35 + index * 0.05), transform: `rotate(${-20 + index * 2}deg)`, transformOrigin: "left center" }} />)}<div style={{ position: "absolute", left: 59, top: 1620, ...mono, color: PAPER, fontSize: 24, opacity: sceneD }}>A TINY OBJECT / CARRYING A WHOLE PLANET</div></>}

    {sceneE > 0 && <><Record x={540} y={934} radius={285} frame={frame} scale={finalScale} opacity={sceneE} /><div style={{ position: "absolute", left: 0, top: 370, width: "100%", textAlign: "center", opacity: sceneE }}><div style={{ ...mono, color: CYAN, fontSize: 22, marginBottom: 27 }}>IF IT IS EVER FOUND</div><div style={{ ...display, fontSize: 148 }}>WE WERE</div><div style={{ ...display, fontSize: 148, color: RED }}>HERE.</div><div style={{ display: "inline-block", width: 548, height: 11, background: RED, marginTop: 34 }} /></div><div style={{ position: "absolute", left: 0, top: 1288, width: "100%", textAlign: "center", ...mono, color: PAPER, fontSize: 25, opacity: sceneE }}>THE VOYAGER GOLDEN RECORD</div></>}
    <Sources />
  </AbsoluteFill>;
};
