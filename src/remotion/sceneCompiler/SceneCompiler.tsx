import type { CSSProperties, FC } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SceneManifest } from "@/engine/episodeGraph";
import type {
  SyntheticScenarioProfile,
  SyntheticScenarioVisualKind,
} from "@/engine/syntheticScenario";

export const SCENE_COMPILER_FPS = 30;
export const SCENE_COMPILER_COMPOSITION_ID = "SceneManifest";

const SCENE_KINDS = ["map", "chart", "diagram", "panel", "puppet", "screen"] as const;

export type SceneCompilerKind = (typeof SCENE_KINDS)[number];

export interface SceneCompilerProps {
  /** Optional only because Remotion registers components as loose prop records. */
  manifest?: SceneManifest;
  width?: number;
  height?: number;
}

interface Palette {
  ink: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
}

interface NormalizedScene {
  id: string;
  t0: number;
  t1: number;
  kind: SceneCompilerKind;
  transition: "cut" | "match_cut" | "dissolve" | "wipe";
  camera: "static" | "push" | "pan-left" | "pan-right";
  label: string;
  characterIds: string[];
  settingId?: string;
  action: string;
  props: string[];
  syntheticScenarioProfile?: SyntheticScenarioProfile;
  syntheticScenarioVisualKind?: SyntheticScenarioVisualKind;
  audience: "general" | "children";
}

const PALETTES: readonly Palette[] = [
  {
    ink: "#081526",
    surface: "#102948",
    primary: "#65D9FF",
    accent: "#FFCB66",
    text: "#F4F8FF",
    muted: "#91A7C4",
  },
  {
    ink: "#151029",
    surface: "#2D2055",
    primary: "#A995FF",
    accent: "#FF8EB5",
    text: "#FBF8FF",
    muted: "#B8ADD3",
  },
  {
    ink: "#10231F",
    surface: "#17443B",
    primary: "#73E2B4",
    accent: "#F2D278",
    text: "#F4FFF9",
    muted: "#A6C9BA",
  },
  {
    ink: "#241718",
    surface: "#542C2A",
    primary: "#FF9C74",
    accent: "#FFE08A",
    text: "#FFF9F5",
    muted: "#D7B7A9",
  },
  {
    ink: "#101927",
    surface: "#1B3C67",
    primary: "#87BFFF",
    accent: "#E9ED72",
    text: "#F7FAFF",
    muted: "#B4C5DD",
  },
  {
    ink: "#211B0C",
    surface: "#51411A",
    primary: "#F3CE69",
    accent: "#8DE1D4",
    text: "#FFFCEE",
    muted: "#D1C59F",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function asFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function unit(seed: string, index: number): number {
  return hash(`${seed}:${index}`) / 4_294_967_295;
}

function paletteFor(seed: string): Palette {
  return PALETTES[hash(seed) % PALETTES.length]!;
}

/**
 * Scene labels are deliberately presentation copy, never a narration fallback.
 * This keeps a verbose script from becoming unreadable visual text by accident.
 */
export function safeSceneLabel(value: unknown, fallback = "Scene"): string {
  const normalized = (asText(value) ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  const glyphs = Array.from(normalized);
  return glyphs.length > 72 ? `${glyphs.slice(0, 69).join("")}…` : normalized;
}

function sceneRecord(scene: SceneManifest["scenes"][number]): Record<string, unknown> {
  return scene as unknown as Record<string, unknown>;
}

export function sceneKindFor(scene: SceneManifest["scenes"][number]): SceneCompilerKind {
  const raw = sceneRecord(scene);
  const explicit = asText(raw.kind)?.toLowerCase();
  const known = SCENE_KINDS.find((kind) => kind === explicit);
  if (known) return known;
  const hasCharacter = asStringArray(raw.characterIds).length > 0;
  // Episode Graph beat kinds are story functions, not renderer implementation
  // names. Map them deterministically to a visual grammar so a retry keeps the
  // same storytelling role instead of hashing into a random generic widget.
  switch (explicit) {
    case "context":
      return "map";
    case "evidence":
      return "diagram";
    case "question":
    case "lesson":
      return hasCharacter ? "puppet" : "diagram";
    case "hook":
    case "reversal":
      return hasCharacter ? "puppet" : "panel";
    case "escalation":
      return hasCharacter ? "puppet" : "chart";
    case "resolution":
      return hasCharacter ? "puppet" : "panel";
    default:
      return "diagram";
  }
}

export function sceneLabelFor(scene: SceneManifest["scenes"][number]): string {
  const raw = sceneRecord(scene);
  const copy = asRecord(raw.copy);
  const visualState = asRecord(raw.visualState);
  // Intentionally excludes copy.narration: narration is not a safe on-screen label.
  const candidate = [raw.label, copy.onScreenText, raw.onScreenText, raw.title, visualState.label, visualState.action]
    .find((value) => Boolean(asText(value)));
  return safeSceneLabel(candidate, "Scene");
}

function normalizeScene(
  source: SceneManifest["scenes"][number],
  audience: "general" | "children" = "general",
): NormalizedScene {
  const raw = sceneRecord(source);
  const visualState = asRecord(raw.visualState);
  // Keep the complete manifest ID in the seed. A display-safe truncation here would
  // make two long IDs share colors and geometry, breaking deterministic continuity.
  const id = (asText(raw.id) ?? asText(raw.nodeId) ?? asText(raw.beatId) ?? "scene").trim();
  const t0 = Math.max(0, asFinite(raw.t0, 0));
  const t1 = Math.max(t0 + 1 / SCENE_COMPILER_FPS, asFinite(raw.t1, t0 + 1));
  const transitionValue = asText(raw.transition);
  const transition =
    transitionValue === "cut" ||
    transitionValue === "match_cut" ||
    transitionValue === "dissolve" ||
    transitionValue === "wipe"
      ? transitionValue
      : "dissolve";
  const cameraRecord = asRecord(raw.camera);
  const cameraValue = (asText(raw.camera) ?? asText(cameraRecord.move))?.toLowerCase();
  const camera =
    cameraValue === "static" ||
    cameraValue === "push" ||
    cameraValue === "pan-left" ||
    cameraValue === "pan-right"
      ? cameraValue
      : (["static", "push", "pan-left", "pan-right"] as const)[hash(id) % 4]!;

  return {
    id,
    t0,
    t1,
    kind: sceneKindFor(source),
    transition,
    camera,
    label: sceneLabelFor(source),
    characterIds: asStringArray(raw.characterIds).length
      ? asStringArray(raw.characterIds)
      : asStringArray(visualState.characterIds),
    settingId: asText(raw.settingId) ?? asText(visualState.settingId),
    action: asText(visualState.action) ?? "",
    props: asStringArray(visualState.props),
    syntheticScenarioProfile: asText(visualState.syntheticScenarioProfile) as SyntheticScenarioProfile | undefined,
    syntheticScenarioVisualKind: asText(visualState.syntheticScenarioVisualKind) as SyntheticScenarioVisualKind | undefined,
    audience,
  };
}

export function sceneManifestDurationInFrames(manifest?: SceneManifest): number {
  const duration = asFinite(manifest?.durationSec, 1);
  return Math.max(1, Math.ceil(Math.max(1 / SCENE_COMPILER_FPS, duration) * SCENE_COMPILER_FPS));
}

export function sceneManifestMetadata(
  manifest: SceneManifest | undefined,
  width = 1920,
  height = 1080,
): { durationInFrames: number; fps: number; width: number; height: number } {
  return {
    durationInFrames: sceneManifestDurationInFrames(manifest),
    fps: SCENE_COMPILER_FPS,
    width,
    height,
  };
}

function Grid({ palette }: { palette: Palette }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: 0.16,
        backgroundImage: `linear-gradient(${palette.primary}22 1px, transparent 1px), linear-gradient(90deg, ${palette.primary}22 1px, transparent 1px)`,
        backgroundSize: "64px 64px",
      }}
    />
  );
}

function MapVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const points = Array.from({ length: 5 }, (_, index) => ({
    x: 84 + unit(seed, index * 2) * 810,
    y: 122 + unit(seed, index * 2 + 1) * 440,
  }));
  const route = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      <path
        d={`M 72 570 C 250 ${210 + unit(seed, 31) * 140}, 500 ${660 - unit(seed, 32) * 270}, 948 180`}
        stroke={palette.muted}
        strokeWidth="76"
        strokeLinecap="round"
        fill="none"
        opacity="0.24"
      />
      <polyline points={route} fill="none" stroke={palette.accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <g key={`${seed}-${index}`}>
          <circle cx={point.x} cy={point.y} r="25" fill={`${palette.primary}33`} />
          <circle cx={point.x} cy={point.y} r="11" fill={index === 0 ? palette.accent : palette.primary} />
        </g>
      ))}
    </svg>
  );
}

function ChartVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const bars = Array.from({ length: 7 }, (_, index) => 0.24 + unit(seed, index + 11) * 0.68);
  const line = bars
    .map((value, index) => `${112 + index * 126},${560 - value * 360}`)
    .join(" ");
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <line key={index} x1="82" x2="926" y1={170 + index * 130} y2={170 + index * 130} stroke={`${palette.muted}55`} strokeWidth="2" />
      ))}
      {bars.map((value, index) => {
        const height = value * 360;
        return <rect key={index} x={84 + index * 126} y={560 - height} width="72" height={height} rx="14" fill={`${palette.primary}${index === bars.length - 1 ? "FF" : "75"}`} />;
      })}
      <polyline points={line} fill="none" stroke={palette.accent} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      {line.split(" ").map((point, index) => {
        const [cx, cy] = point.split(",");
        return <circle key={index} cx={cx} cy={cy} r="8" fill={palette.accent} />;
      })}
    </svg>
  );
}

function DiagramVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    x: 130 + unit(seed, index * 3) * 730,
    y: 130 + unit(seed, index * 3 + 1) * 430,
    r: 38 + unit(seed, index * 3 + 2) * 20,
  }));
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      {nodes.slice(1).map((node, index) => (
        <line key={index} x1={nodes[0]!.x} y1={nodes[0]!.y} x2={node.x} y2={node.y} stroke={`${palette.muted}AA`} strokeWidth="7" />
      ))}
      {nodes.map((node, index) => (
        <g key={index}>
          <circle cx={node.x} cy={node.y} r={node.r + 16} fill={`${palette.primary}22`} />
          <circle cx={node.x} cy={node.y} r={node.r} fill={index === 0 ? palette.accent : palette.surface} stroke={palette.primary} strokeWidth="6" />
        </g>
      ))}
    </svg>
  );
}

function PanelVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const cards = Array.from({ length: 3 }, (_, index) => ({
    rotate: -5 + unit(seed, index) * 10,
    top: 118 + unit(seed, index + 10) * 155,
    hue: index === 1 ? palette.accent : palette.primary,
  }));
  return (
    <div style={{ position: "absolute", inset: 0 }} aria-hidden>
      {cards.map((card, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: 118 + index * 260,
            top: card.top,
            width: 230,
            height: 320,
            borderRadius: 30,
            transform: `rotate(${card.rotate}deg)`,
            background: `linear-gradient(150deg, ${card.hue}, ${palette.surface})`,
            border: `5px solid ${palette.text}22`,
            boxShadow: "0 28px 55px #00000044",
          }}
        >
          <div style={{ margin: 34, height: 14, width: "58%", borderRadius: 9, background: `${palette.text}BB` }} />
          <div style={{ margin: "22px 34px", height: 12, width: "76%", borderRadius: 9, background: `${palette.text}66` }} />
          <div style={{ margin: "0 34px", height: 108, borderRadius: 20, background: `${palette.ink}55` }} />
        </div>
      ))}
    </div>
  );
}

function PuppetVisual({ scene, palette }: { scene: NormalizedScene; palette: Palette }) {
  const subjectSeed = scene.characterIds[0] ?? scene.id;
  const visualText = `${scene.action} ${scene.props.join(" ")} ${scene.label}`.toLowerCase();
  const garden = /garden|seed|plant|soil|water|sun|grow/.test(visualText);
  const watering = /water|watering|pour/.test(visualText);
  const seed = /seed|plant|soil/.test(visualText);
  const sunlight = /sun|light|grow/.test(visualText);
  const skin = ["#F2C6A5", "#C98562", "#925F48", "#F6D7C0"][hash(`${subjectSeed}:skin`) % 4]!;
  const hair = ["#26364A", "#5C3827", "#A96A3D", "#1E1A1A"][hash(`${subjectSeed}:hair`) % 4]!;
  const shirt = unit(subjectSeed, 3) > 0.5 ? palette.primary : palette.accent;
  const hasSecondCharacter = scene.characterIds.length > 1;

  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      <defs>
        <linearGradient id={`sky-${scene.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={garden ? "#B8E2FF" : palette.primary} stopOpacity={garden ? "1" : "0.45"} />
          <stop offset="100%" stopColor={garden ? "#F8EBC0" : palette.surface} />
        </linearGradient>
        <linearGradient id={`shirt-${scene.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={shirt} />
          <stop offset="100%" stopColor={palette.accent} />
        </linearGradient>
      </defs>
      <rect width="1000" height="720" fill={`url(#sky-${scene.id})`} />
      {garden ? (
        <>
          <circle cx="846" cy="104" r="58" fill="#FFE38A" opacity={sunlight ? "1" : "0.68"} />
          <circle cx="846" cy="104" r="80" fill="#FFE38A" opacity="0.2" />
          <path d="M0 502 C150 430 284 540 438 480 C600 416 760 506 1000 440 V720 H0Z" fill="#89C77D" />
          <rect x="86" y="472" width="414" height="140" rx="26" fill="#B97142" stroke="#70452E" strokeWidth="14" />
          <rect x="116" y="502" width="354" height="78" rx="18" fill="#624235" />
          {seed ? <ellipse cx="286" cy="544" rx="18" ry="12" fill="#D6A95A" transform="rotate(-28 286 544)" /> : null}
          {sunlight ? <path d="M286 542 C286 504 318 486 338 452 M286 542 C266 510 246 490 224 468" fill="none" stroke="#3F9A57" strokeWidth="13" strokeLinecap="round" /> : null}
          {sunlight ? <ellipse cx="342" cy="452" rx="25" ry="13" fill="#6FCB6E" transform="rotate(-27 342 452)" /> : null}
          {sunlight ? <ellipse cx="220" cy="468" rx="25" ry="13" fill="#6FCB6E" transform="rotate(28 220 468)" /> : null}
        </>
      ) : (
        <>
          <circle cx="120" cy="126" r="84" fill={`${palette.accent}3D`} />
          <circle cx="850" cy="154" r="114" fill={`${palette.primary}2E`} />
          <path d="M0 560 C196 478 318 632 502 554 C710 466 824 596 1000 516 V720 H0Z" fill={`${palette.ink}44`} />
        </>
      )}
      <g transform="translate(560 184)">
        <path d="M138 330 L93 486" stroke="#29415A" strokeWidth="36" strokeLinecap="round" />
        <path d="M218 330 L264 486" stroke="#29415A" strokeWidth="36" strokeLinecap="round" />
        <path d="M110 204 C58 254 56 304 24 342" fill="none" stroke={skin} strokeWidth="31" strokeLinecap="round" />
        <path d="M246 212 C320 254 333 306 352 344" fill="none" stroke={skin} strokeWidth="31" strokeLinecap="round" />
        <rect x="100" y="178" width="158" height="190" rx="76" fill={`url(#shirt-${scene.id})`} stroke={`${palette.ink}66`} strokeWidth="8" />
        <circle cx="180" cy="108" r="76" fill={skin} stroke={`${palette.ink}55`} strokeWidth="8" />
        <path d="M112 96 C122 18 245 8 252 104 C215 70 158 70 112 96Z" fill={hair} />
        <circle cx="153" cy="116" r="8" fill="#182438" />
        <circle cx="207" cy="116" r="8" fill="#182438" />
        <path d="M154 151 Q180 173 208 151" fill="none" stroke="#A84E58" strokeWidth="8" strokeLinecap="round" />
        {watering ? (
          <>
            <path d="M336 329 L410 296 L432 352 L358 382Z" fill="#7CC9FF" stroke="#315C83" strokeWidth="8" />
            <path d="M414 315 C468 316 476 365 439 377" fill="none" stroke="#315C83" strokeWidth="13" strokeLinecap="round" />
            <path d="M354 382 C332 412 320 432 300 458" fill="none" stroke="#8EDBFF" strokeWidth="10" strokeLinecap="round" strokeDasharray="4 18" />
          </>
        ) : seed ? (
          <ellipse cx="22" cy="344" rx="24" ry="15" fill="#D6A95A" transform="rotate(-28 22 344)" />
        ) : null}
      </g>
      {hasSecondCharacter ? (
        <g transform="translate(438 378) scale(0.62)">
          <circle cx="180" cy="108" r="76" fill="#DCA97D" />
          <path d="M112 96 C122 18 245 8 252 104 C215 70 158 70 112 96Z" fill="#2E2430" />
          <rect x="100" y="178" width="158" height="190" rx="76" fill={palette.primary} />
          <path d="M138 330 L93 486 M218 330 L264 486" stroke="#29415A" strokeWidth="36" strokeLinecap="round" />
        </g>
      ) : null}
    </svg>
  );
}

function ScreenVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const blocks = Array.from({ length: 5 }, (_, index) => ({
    width: 0.36 + unit(seed, index + 220) * 0.5,
    color: index === 0 ? palette.accent : palette.primary,
  }));
  return (
    <div style={{ position: "absolute", inset: 88, borderRadius: 34, overflow: "hidden", background: palette.surface, border: `5px solid ${palette.text}22`, boxShadow: "0 36px 84px #00000066" }} aria-hidden>
      <div style={{ height: 58, padding: "0 26px", display: "flex", alignItems: "center", gap: 12, background: `${palette.ink}99` }}>
        {[palette.accent, palette.primary, palette.muted].map((color, index) => <div key={index} style={{ width: 15, height: 15, borderRadius: "50%", background: color }} />)}
        <div style={{ marginLeft: 18, width: "48%", height: 20, borderRadius: 12, background: `${palette.text}18` }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "0.34fr 1fr", height: "calc(100% - 58px)" }}>
        <div style={{ padding: 34, background: `${palette.ink}66` }}>
          {[0, 1, 2, 3].map((index) => <div key={index} style={{ height: 21, marginBottom: 24, borderRadius: 10, background: `${palette.text}${index === 1 ? "55" : "22"}` }} />)}
        </div>
        <div style={{ padding: 60 }}>
          {blocks.map((block, index) => <div key={index} style={{ width: `${block.width * 100}%`, height: index === 0 ? 42 : 25, marginBottom: 27, borderRadius: 12, background: `${block.color}${index === 0 ? "FF" : "88"}` }} />)}
        </div>
      </div>
    </div>
  );
}

function TownVisual({ seed, palette, overview }: { seed: string; palette: Palette; overview: boolean }) {
  const blocks = Array.from({ length: 30 }, (_, index) => ({
    x: 92 + (index % 6) * 145 + unit(seed, index) * 18,
    y: 90 + Math.floor(index / 6) * 108 + unit(seed, index + 90) * 16,
    w: 75 + unit(seed, index + 150) * 46,
    h: 48 + unit(seed, index + 210) * 34,
    occupied: unit(seed, index + 330) > (overview ? 0.26 : 0.42),
  }));
  const agents = Array.from({ length: overview ? 42 : 26 }, (_, index) => ({
    x: 100 + unit(seed, index + 480) * 800,
    y: 108 + unit(seed, index + 620) * 470,
  }));
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      <rect x="54" y="54" width="892" height="612" rx="34" fill={`${palette.ink}77`} stroke={`${palette.primary}55`} strokeWidth="4" />
      {[0, 1, 2, 3, 4].map((row) => <line key={`r-${row}`} x1="82" x2="918" y1={142 + row * 102} y2={142 + row * 102} stroke={`${palette.muted}33`} strokeWidth="3" />)}
      {[0, 1, 2, 3, 4, 5].map((column) => <line key={`c-${column}`} y1="82" y2="638" x1={142 + column * 142} x2={142 + column * 142} stroke={`${palette.muted}22`} strokeWidth="3" />)}
      {blocks.map((block, index) => (
        <rect key={index} x={block.x} y={block.y} width={block.w} height={block.h} rx="10" fill={block.occupied ? `${palette.primary}A8` : `${palette.surface}BB`} stroke={block.occupied ? palette.accent : `${palette.muted}55`} strokeWidth="3" />
      ))}
      {agents.map((agent, index) => <circle key={index} cx={agent.x} cy={agent.y} r="7" fill={index % 5 === 0 ? palette.accent : palette.text} opacity="0.9" />)}
      <rect x="88" y="88" width="192" height="52" rx="16" fill={`${palette.ink}CC`} />
      <text x="112" y="122" fill={palette.text} fontFamily="Arial" fontSize="23" fontWeight="700">{overview ? "WORLD STATE" : "NEXT TURN"}</text>
      <path d="M694 584 C744 522 812 560 868 486" fill="none" stroke={palette.accent} strokeWidth="9" strokeLinecap="round" />
      <circle cx="868" cy="486" r="13" fill={palette.accent} />
    </svg>
  );
}

function DecisionVisual({ seed, palette, outcome }: { seed: string; palette: Palette; outcome: boolean }) {
  const options = ["A", "B", "C"];
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      <path d="M500 108 V210 M500 210 L244 350 M500 210 L500 350 M500 210 L756 350" fill="none" stroke={`${palette.muted}AA`} strokeWidth="8" strokeLinecap="round" />
      <circle cx="500" cy="108" r="52" fill={palette.accent} />
      <text x="500" y="118" textAnchor="middle" fill={palette.ink} fontFamily="Arial" fontSize="30" fontWeight="900">AI</text>
      {options.map((option, index) => {
        const x = 124 + index * 252;
        const selected = outcome && index === hash(seed) % options.length;
        return (
          <g key={option}>
            <rect x={x} y="350" width="240" height="210" rx="28" fill={selected ? `${palette.accent}CC` : `${palette.surface}EE`} stroke={selected ? palette.text : `${palette.primary}88`} strokeWidth="5" />
            <text x={x + 36} y="408" fill={selected ? palette.ink : palette.primary} fontFamily="Arial" fontSize="30" fontWeight="900">OPTION {option}</text>
            <rect x={x + 36} y="444" width="156" height="16" rx="8" fill={selected ? `${palette.ink}66` : `${palette.text}55`} />
            <rect x={x + 36} y="486" width={80 + unit(seed, index) * 90} height="14" rx="7" fill={selected ? `${palette.ink}55` : `${palette.primary}77`} />
            {selected ? <text x={x + 36} y="538" fill={palette.ink} fontFamily="Arial" fontSize="22" fontWeight="800">CHOSEN PATH</text> : null}
          </g>
        );
      })}
      <text x="500" y="640" textAnchor="middle" fill={palette.muted} fontFamily="Arial" fontSize="24" fontWeight="700">{outcome ? "TRADE-OFF REVEAL" : "CONSTRAINTS → CHOICE"}</text>
    </svg>
  );
}

function PovVisual({ seed, palette }: { seed: string; palette: Palette }) {
  const skyline = Array.from({ length: 10 }, (_, index) => ({
    x: index * 112,
    h: 110 + unit(seed, index + 780) * 250,
  }));
  return (
    <svg viewBox="0 0 1000 720" style={{ width: "100%", height: "100%" }} aria-hidden>
      <rect width="1000" height="720" fill={palette.ink} />
      <rect width="1000" height="420" fill={palette.primary} opacity="0.34" />
      <circle cx="770" cy="160" r="92" fill={`${palette.accent}88`} />
      {skyline.map((building, index) => <rect key={index} x={building.x} y={590 - building.h} width="92" height={building.h} fill={`${palette.surface}EE`} stroke={`${palette.primary}77`} strokeWidth="3" />)}
      <path d="M350 720 C374 590 452 548 500 612 C548 548 626 590 650 720" fill={`${palette.primary}AA`} />
      <path d="M82 670 L310 528 L420 606" fill="none" stroke={`${palette.text}D8`} strokeWidth="34" strokeLinecap="round" />
      <path d="M918 670 L690 528 L580 606" fill="none" stroke={`${palette.text}D8`} strokeWidth="34" strokeLinecap="round" />
      <rect x="62" y="58" width="230" height="58" rx="16" fill={`${palette.ink}C8`} stroke={`${palette.primary}AA`} strokeWidth="3" />
      <text x="88" y="95" fill={palette.text} fontFamily="Arial" fontSize="24" fontWeight="800">POV // SIGNAL LIVE</text>
      <path d="M756 616 H918" stroke={palette.accent} strokeWidth="8" strokeDasharray="16 12" />
    </svg>
  );
}

function VisualByKind({ scene, palette }: { scene: NormalizedScene; palette: Palette }) {
  switch (scene.syntheticScenarioVisualKind) {
    case "town_overview":
      return <TownVisual seed={scene.id} palette={palette} overview />;
    case "town_turn":
      return <TownVisual seed={scene.id} palette={palette} overview={false} />;
    case "decision_options":
      return <DecisionVisual seed={scene.id} palette={palette} outcome={false} />;
    case "decision_outcome":
      return <DecisionVisual seed={scene.id} palette={palette} outcome />;
    case "pov_hud":
      return <PovVisual seed={scene.id} palette={palette} />;
  }
  switch (scene.kind) {
    case "map":
      return <MapVisual seed={scene.id} palette={palette} />;
    case "chart":
      return <ChartVisual seed={scene.id} palette={palette} />;
    case "diagram":
      return <DiagramVisual seed={scene.id} palette={palette} />;
    case "panel":
      return <PanelVisual seed={scene.id} palette={palette} />;
    case "puppet":
      return <PuppetVisual scene={scene} palette={palette} />;
    case "screen":
      return <ScreenVisual seed={scene.id} palette={palette} />;
  }
}

function cameraTransform(scene: NormalizedScene, localFrame: number, sceneFrames: number): string {
  const progress = interpolate(localFrame, [0, Math.max(1, sceneFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  if (scene.camera === "push") return `scale(${1 + progress * 0.045})`;
  if (scene.camera === "pan-left") return `translateX(${-progress * 24}px) scale(1.018)`;
  if (scene.camera === "pan-right") return `translateX(${progress * 24}px) scale(1.018)`;
  return "scale(1.012)";
}

function SceneLayer({
  scene,
  opacity,
  clipPath,
  labelOpacity = 1,
}: {
  scene: NormalizedScene;
  opacity: number;
  clipPath?: string;
  labelOpacity?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // A stable setting keeps its palette across every beat. The old scene-ID
  // seed made the same garden or room jump colour at every cut.
  const palette = paletteFor(scene.settingId ?? scene.id);
  const localFrame = Math.max(0, frame - Math.floor(scene.t0 * fps));
  const sceneFrames = Math.max(1, Math.ceil((scene.t1 - scene.t0) * fps));
  const visualStyle: CSSProperties = {
    clipPath,
    transform: cameraTransform(scene, localFrame, sceneFrames),
    transformOrigin: "center",
    background: `radial-gradient(circle at ${22 + unit(scene.id, 901) * 55}% ${15 + unit(scene.id, 902) * 40}%, ${palette.primary}32, transparent 42%), ${palette.ink}`,
  };

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={visualStyle}>
        <Grid palette={palette} />
        <div style={{ position: "absolute", inset: "9% 8% 17%", borderRadius: 38, overflow: "hidden", background: `${palette.surface}88`, border: `2px solid ${palette.text}1F` }}>
          <VisualByKind scene={scene} palette={palette} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "6%", display: "flex", alignItems: "end", gap: 36, opacity: labelOpacity }}>
        <div style={{ maxWidth: "88%", color: palette.text, fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 800, fontSize: 52, letterSpacing: "-0.035em", lineHeight: 1.07, textShadow: "0 4px 22px #00000088" }}>
          {scene.label}
        </div>
      </div>
      {scene.syntheticScenarioProfile ? (
        <div style={{ position: "absolute", top: "5%", right: "7%", borderRadius: 999, padding: "10px 18px", background: "#071525D9", border: `2px solid ${palette.accent}`, color: palette.text, fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "0.08em" }}>
          FICTIONAL AI SCENARIO · ILLUSTRATIVE ASSUMPTIONS
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

function activeSceneIndex(scenes: readonly NormalizedScene[], second: number): number {
  const exact = scenes.findIndex((scene) => second >= scene.t0 && second < scene.t1);
  if (exact >= 0) return exact;
  const next = scenes.findIndex((scene) => second < scene.t0);
  return next >= 0 ? Math.max(0, next - 1) : Math.max(0, scenes.length - 1);
}

export const SceneCompiler: FC<SceneCompilerProps> = ({ manifest }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scenes = (manifest?.scenes ?? [])
    .map((scene) => normalizeScene(scene, manifest?.audience ?? "general"))
    .sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));

  if (scenes.length === 0) {
    return <AbsoluteFill style={{ background: "#101827" }} />;
  }

  const second = frame / fps;
  const index = activeSceneIndex(scenes, second);
  const current = scenes[index]!;
  const previous = index > 0 ? scenes[index - 1] : undefined;
  const localFrame = Math.max(0, frame - Math.floor(current.t0 * fps));
  const transitionFrames = Math.min(Math.max(1, Math.round(fps * 0.35)), Math.max(1, Math.ceil((current.t1 - current.t0) * fps / 3)));
  const transitionProgress = interpolate(localFrame, [0, transitionFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const currentOpacity = current.transition === "dissolve" ? transitionProgress : 1;
  const currentClip = current.transition === "wipe" ? `inset(0 ${Math.round((1 - transitionProgress) * 100)}% 0 0)` : undefined;
  const isAnimatedTransition = current.transition === "dissolve" || current.transition === "wipe";
  const previousLabelOpacity = isAnimatedTransition
    ? interpolate(transitionProgress, [0, 0.25], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const currentLabelOpacity = isAnimatedTransition && previous
    ? interpolate(transitionProgress, [0.68, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;

  return (
    <AbsoluteFill style={{ background: "#101827", overflow: "hidden" }}>
      {previous ? <SceneLayer scene={previous} opacity={1} labelOpacity={previousLabelOpacity} /> : null}
      <SceneLayer
        scene={current}
        opacity={currentOpacity}
        clipPath={currentClip}
        labelOpacity={currentLabelOpacity}
      />
    </AbsoluteFill>
  );
};
