/**
 * GEO CINEMA — the cinema-grade geographic intro capability for DOCUMOTION.
 *
 * The basic geo_map (flat Remotion streets) was "way too basic". This module
 * renders a REAL place as a film-grade 3D shot with HyperFrames + Three.js:
 *
 *   spin a lit Earth → settle a beacon on the exact city → flash-cut down to a
 *   night skyline of the REAL street/building geometry, windows lit, a gold
 *   beam on the hero building, bloom + colour-grade + grain over all of it.
 *
 * The point of the module (not just one video) is the INTELLIGENCE around the
 * renderer:
 *
 *   1. GEO_CAPABILITIES — a precise contract of what the renderer can do, so an
 *      LLM directs WITHIN real capability instead of hallucinating.
 *   2. directGeoScene() — an LLM art-direction step that turns the narration +
 *      place into a GeoArtDirection (palette, camera, hero, grounded labels),
 *      merged over a proven cinematic baseline so the spec is always complete.
 *   3. assessGeoDetail() — a detail-sufficiency GATE: deterministic geometry
 *      evidence + an LLM judge decide whether the scene is rich enough for a
 *      cinema-level animation BEFORE rendering, and emit concrete enrichment
 *      (bigger fetch radius, denser windows, tighter framing) when it isn't.
 *
 * The renderer is a PURE FUNCTION of (GeoScene3D, GeoArtDirection): the .tpl
 * stamps both in and HyperFrames renders headlessly. Visual-only — narration,
 * music and SFX belong to the other modules.
 */
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { geminiJson, geminiJsonPro, parseJsonLoose } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";

type Logger = (msg: string) => void;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const HYPERFRAMES_VERSION = process.env.HYPERFRAMES_VERSION || "0.6.97";

/* ----------------------------------------------------------------------- *
 * 1. CAPABILITY CONTRACT — what the renderer actually offers. Fed verbatim
 *    into the art-direction + assessment prompts so the LLM stays grounded.
 * ----------------------------------------------------------------------- */
export const GEO_CAPABILITIES = `
GEO-CINEMA RENDERER — CAPABILITY CONTRACT (HyperFrames + Three.js r128, headless 1080p).
You are art-directing a fixed renderer. Direct ONLY within these capabilities; every knob below is real.

SHOT STRUCTURE (one continuous move, ~10-12s):
  • GLOBE: a lit Earth (real NASA equirectangular texture) spins from an oblique angle and SETTLES with a
    pulsing gold beacon dead-centre on the target city, then HOLDS so the audience reads the location.
  • FLASH-CUT: a brief atmospheric flash bridges globe → city (a match cut "down" onto the streets).
  • CITY: the REAL OSM street network draws in as glowing lines; the REAL building footprints EXTRUDE upward
    from the ground with procedurally-lit windows; a HERO building (the story's location) gets a gold light
    beam + ground halo. Camera orbits and CRANES DOWN toward the hero through atmospheric fog.

RENDER FEATURES (all on): per-building procedural lit-window shader (HDR emissive → blooms), UnrealBloom,
  exponential height fog, glowing street lines (major roads brighter), water polygons (rivers/docks),
  star field, fresnel atmosphere on the globe, final colour-grade pass (lift shadows to teal, warm highlights,
  contrast, vignette, film grain). Kinetic type overlays (kicker + huge title + mono coordinates), text always
  clear of the geometry focal point.

WHAT IT IS NOT: not a free-fly camera, not labelled streets, not daytime, not photoreal buildings (stylised
  night massing), not text baked into images. Buildings/streets/water come from real data — you cannot invent
  geometry, only DIRECT how it is lit, graded, framed and paced.

KNOBS YOU CONTROL (the GeoArtDirection spec):
  palette  — earth{color,emissive,specular,shininess}, fogColor, baseBuilding, heroColor, streetColor,
             streetBig, waterColor, atmosphere (all hex strings).
  windows  — windowDensity 0..1 (how many windows are lit). windowWarm (the bright HDR glow colour) and bloom
             are FIXED at a balanced exposure — do NOT change them (dimming windows or maxing the bloom threshold
             kills the whole look).
  grade    — gradeShadow [r,g,b] shadow tint (teal ≈ [0.6,0.77,1.0]), gradeHi [r,g,b] highlight tint
             (amber ≈ [1.07,0.99,0.82]), vignette 0..1, grain 0..0.12, contrast ~1.0-1.3.
  fog      — fogColor + fogDensity (0.0015 airy … 0.004 thick/intimate). More fog hides empty edges = depth.
  camera   — cam{aStart,aEnd (orbit angle rad), radStart→radEnd (distance, smaller = tighter on hero),
             eyStart→eyEnd (height; crane DOWN = eyStart>eyEnd), lookY}. Keep the dense district framed; never
             pull so wide the centre reads as an empty void.
  calib    — calibLat/calibLon are a FIXED texture-alignment constant. Do NOT change them.
  timing   — {total, spinEnd, holdEnd, flash, phase, riseStart, riseEnd, beam, camStart, camEnd} seconds.
  labels   — 2 entries (phase "globe", phase "city"): {kicker, big, coord, kickerColor, coordColor}. Grounded
             in the REAL place + the narration. The "big" title must be a real, tonally-correct place name —
             never a comical or generic word.
`.trim();

/* ----------------------------------------------------------------------- *
 * 2. TYPES
 * ----------------------------------------------------------------------- */
export interface GeoBuilding {
  p: [number, number][];
  h: number;
  hero?: boolean;
}
export interface GeoStreet3D {
  p: [number, number][];
  big?: boolean;
}
export interface GeoScene3D {
  lat0: number;
  lon0: number;
  place: string;
  buildings: GeoBuilding[];
  streets: GeoStreet3D[];
  water: [number, number][][];
  /** radius (m) the scene was fetched at — so a re-fetch can widen it. */
  radius: number;
  synthetic?: boolean;
}

export interface GeoLabel {
  phase: "globe" | "city";
  kicker: string;
  big: string;
  coord: string;
  kickerColor?: string;
  coordColor?: string;
}
export interface GeoArtDirection {
  earth: { color: string; emissive: string; specular: string; shininess: number };
  fogColor: string;
  fogDensity: number;
  baseBuilding: string;
  windowWarm: [number, number, number];
  windowDensity: number;
  heroColor: string;
  streetColor: string;
  streetBig: string;
  waterColor: string;
  atmosphere: string;
  /** horizon city-glow backdrop so empty distance reads as haze, not black void. */
  skyTop: string;
  skyHorizon: string;
  /** city ambient fill so unlit building massing stays visible. */
  ambient: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  gradeShadow: [number, number, number];
  gradeHi: [number, number, number];
  vignette: number;
  grain: number;
  contrast: number;
  calibLat: number;
  calibLon: number;
  cam: { aStart: number; aEnd: number; radStart: number; radEnd: number; eyStart: number; eyEnd: number; lookY: number };
  timing: { total: number; spinEnd: number; holdEnd: number; flash: number; phase: number; riseStart: number; riseEnd: number; beam: number; camStart: number; camEnd: number };
  heroBeamH: number;
  maxBuildingH: number;
  labels: GeoLabel[];
}

export interface GeoDetailAssessment {
  pass: boolean;
  score: number;
  gaps: string[];
  verdict: string;
  /** partial GeoArtDirection overrides to raise fidelity. */
  enrich?: Partial<GeoArtDirection>;
  /** request a wider geometry re-fetch (metres) when the scene is too thin. */
  refetchRadius?: number;
}

/* A proven cinematic baseline. The LLM REFINES this; merging over it guarantees
 * a complete, renderable spec even when the model returns only a few overrides. */
export const DEFAULT_ART: GeoArtDirection = {
  earth: { color: "#8a9fb4", emissive: "#0f1b27", specular: "#2a4660", shininess: 12 },
  fogColor: "#0c1a2a",
  fogDensity: 0.0026,
  baseBuilding: "#1b2d3d",
  windowWarm: [4.3, 3.2, 1.75],
  windowDensity: 0.7,
  heroColor: "#ffd24a",
  streetColor: "#2f8496",
  streetBig: "#63e2d2",
  waterColor: "#081622",
  atmosphere: "#2aa6c0",
  skyTop: "#06080e",
  skyHorizon: "#173a4c",
  ambient: 1.1,
  bloomStrength: 1.4,
  bloomRadius: 0.82,
  bloomThreshold: 0.7,
  gradeShadow: [0.6, 0.77, 1.0],
  gradeHi: [1.07, 0.99, 0.82],
  vignette: 0.72,
  grain: 0.05,
  contrast: 1.15,
  calibLat: -1.5,
  calibLon: 6.5,
  cam: { aStart: -2.25, aEnd: -1.15, radStart: 430, radEnd: 250, eyStart: 210, eyEnd: 100, lookY: 30 },
  timing: { total: 10.5, spinEnd: 3.0, holdEnd: 4.4, flash: 4.4, phase: 4.6, riseStart: 4.7, riseEnd: 8.0, beam: 6.4, camStart: 4.7, camEnd: 10.5 },
  heroBeamH: 360,
  maxBuildingH: 120,
  labels: [
    { phase: "globe", kicker: "Target Located", big: "", coord: "", kickerColor: "#5fe0cf", coordColor: "#e8b23a" },
    { phase: "city", kicker: "", big: "", coord: "", kickerColor: "#e8b23a", coordColor: "#5fe0cf" },
  ],
};

/* ----------------------------------------------------------------------- *
 * 3. GEOMETRY FETCH — real OSM streets/buildings/water in a local metre grid.
 *    curl subprocess: Nominatim/Overpass WAF-block Node's undici client.
 * ----------------------------------------------------------------------- */
function curlJson<T = unknown>(args: string[], timeoutMs = 60_000): Promise<T | null> {
  return new Promise((resolve) => {
    const p = spawn("curl", ["-s", "--max-time", String(Math.round(timeoutMs / 1000)), ...args]);
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.on("close", () => {
      try {
        resolve(JSON.parse(out) as T);
      } catch {
        resolve(null);
      }
    });
    p.on("error", () => resolve(null));
  });
}

interface OverpassEl {
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[] }[];
}

/** Fetch + project a 3D scene (buildings with heights, streets, water). */
export async function fetchGeoScene3D(query: string, runDir: string, radius = 620, log?: Logger): Promise<GeoScene3D> {
  await mkdir(runDir, { recursive: true });
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const cache = join(runDir, `scene3d_${slug}_${radius}.json`);
  if (existsSync(cache)) {
    try {
      return JSON.parse(await readFile(cache, "utf8")) as GeoScene3D;
    } catch {
      /* refetch */
    }
  }
  const g = await curlJson<{ lat: string; lon: string; display_name: string }[]>(
    ["-A", "geo-cinema/1.0", `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`],
    20_000,
  );
  if (!g?.length) throw new Error(`geoCinema: could not geocode "${query}"`);
  const lat0 = parseFloat(g[0].lat);
  const lon0 = parseFloat(g[0].lon);
  log?.(`geoCinema: "${query}" → ${lat0},${lon0} (r=${radius}m)`);

  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const r1 = (n: number) => Math.round(n);
  const P = (lon: number, lat: number): [number, number] => [r1((lon - lon0) * mLon), r1((lat - lat0) * mLat)];

  const q =
    `[out:json][timeout:55];(` +
    `way[building](around:${radius},${lat0},${lon0});` +
    `way[highway~"^(primary|secondary|tertiary|residential|trunk|unclassified|living_street|pedestrian)$"](around:${radius},${lat0},${lon0});` +
    `way[natural=water](around:${radius + 280},${lat0},${lon0});` +
    `way[waterway=riverbank](around:${radius + 580},${lat0},${lon0});` +
    `relation[natural=water](around:${radius + 580},${lat0},${lon0}););out geom 9000;`;
  let d: { elements: OverpassEl[] } | null = null;
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    d = await curlJson<{ elements: OverpassEl[] }>(["-A", "geo-cinema/1.0", "-X", "POST", "--data-urlencode", `data=${q}`, host], 70_000);
    if (d?.elements?.length) break;
  }
  if (!d?.elements?.length) throw new Error(`geoCinema: Overpass returned no geometry for "${query}"`);

  let hseed = 99;
  const buildings: GeoBuilding[] = [];
  const streets: GeoStreet3D[] = [];
  const water: [number, number][][] = [];
  for (const e of d.elements) {
    const t = e.tags || {};
    const geom = e.geometry || (e.members && e.members.flatMap((m) => m.geometry || []));
    if (!geom || geom.length < 2) continue;
    const pts = geom.map((n) => P(n.lon, n.lat));
    if (t.building) {
      if (pts.length < 4 || buildings.length >= 240) continue;
      const lvl = parseFloat(t["building:levels"] || t["building:levels:aboveground"] || "0");
      let h = parseFloat(t.height || "0") || (lvl > 0 ? lvl * 3.4 : 0);
      const real = h > 0;
      if (!h) {
        hseed = (hseed * 1103515245 + 12345) & 0x7fffffff;
        h = 15 + (hseed % 42);
      }
      h = Math.min(95, Math.max(9, Math.round(h)));
      const dx = Math.abs(pts[0][0]);
      const dz = Math.abs(pts[0][1]);
      buildings.push({ p: pts.slice(0, 28), h, hero: dx < 40 && dz < 40, ...(real ? { real: true } : {}) } as GeoBuilding & { real?: boolean });
    } else if (t.highway) {
      streets.push({ p: pts.length > 18 ? pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1) : pts, big: ["primary", "secondary", "trunk"].includes(t.highway) });
    } else if (t.natural === "water" || t.waterway === "riverbank") {
      if (pts.length >= 4) water.push(pts.length > 60 ? pts.filter((_, i) => i % 2 === 0) : pts);
    }
  }
  if (!buildings.some((b) => b.hero) && buildings.length) {
    let bi = 0;
    let bd = Infinity;
    buildings.forEach((b, i) => {
      const dd = Math.hypot(b.p[0][0], b.p[0][1]);
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    });
    buildings[bi].hero = true;
  }
  const place = query.split(",")[0].trim();
  const scene: GeoScene3D = { lat0, lon0, place, buildings, streets, water, radius };
  await writeFile(cache, JSON.stringify(scene), "utf8");
  log?.(`geoCinema: ${buildings.length} buildings, ${streets.length} streets, ${water.length} water`);
  return scene;
}

/** Deterministic evidence about a scene's richness — grounds the LLM gate. */
export function computeSceneStats(scene: GeoScene3D) {
  const heights = scene.buildings.map((b) => b.h).sort((a, b) => a - b);
  const real = scene.buildings.filter((b) => (b as GeoBuilding & { real?: boolean }).real).length;
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return {
    buildings: scene.buildings.length,
    realHeightPct: scene.buildings.length ? Math.round((real / scene.buildings.length) * 100) : 0,
    heightMin: heights[0] || 0,
    heightMedian: median,
    heightMax: heights[heights.length - 1] || 0,
    streets: scene.streets.length,
    bigStreets: scene.streets.filter((s) => s.big).length,
    water: scene.water.length,
    hasHero: scene.buildings.some((b) => b.hero),
    radius: scene.radius,
  };
}

/* ----------------------------------------------------------------------- *
 * 4. ART DIRECTION — LLM turns place + narration into a GeoArtDirection.
 * ----------------------------------------------------------------------- */
function deepMerge<T>(base: T, over: Partial<T> | undefined): T {
  if (!over) return base;
  const out: Record<string, unknown> = Array.isArray(base) ? [...(base as unknown[])] as never : { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    const b = (base as Record<string, unknown>)[k];
    if (b && typeof b === "object" && !Array.isArray(b) && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(b, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

const clamp = (v: number, lo: number, hi: number) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);

/**
 * Safety pass — the LLM directs without SEEING the render, so it pushes knobs
 * into unrenderable territory (it once lowered bloomThreshold and blew the
 * daylit Earth to solid white). Lock the exposure-critical + calibration knobs
 * to the proven baseline and bound the rest to safe ranges. The model still
 * owns palette, window warmth, grade tint, fog feel, camera energy and labels.
 */
export function clampArt(art: GeoArtDirection): GeoArtDirection {
  const a = JSON.parse(JSON.stringify(art)) as GeoArtDirection;
  // LOCKED — the EXPOSURE-CRITICAL knobs that make-or-break the look are not the
  // LLM's to move (it dimmed windows + maxed bloomThreshold → dark dead city, or
  // lowered threshold → blown-out Earth). The LLM directs MOOD/PALETTE/LABELS;
  // the exposure that makes the lit windows glow + the globe read stays fixed.
  a.earth = { ...DEFAULT_ART.earth };
  a.calibLat = DEFAULT_ART.calibLat;
  a.calibLon = DEFAULT_ART.calibLon;
  a.timing = { ...DEFAULT_ART.timing };
  a.windowWarm = [...DEFAULT_ART.windowWarm] as [number, number, number]; // bright HDR = the glow
  a.bloomThreshold = DEFAULT_ART.bloomThreshold;
  a.bloomStrength = DEFAULT_ART.bloomStrength;
  a.bloomRadius = DEFAULT_ART.bloomRadius;
  // BOUNDED — mood knobs, kept in a range that always reads
  a.fogDensity = clamp(a.fogDensity, 0.0015, 0.0030);
  a.grain = clamp(a.grain, 0, 0.09);
  a.vignette = clamp(a.vignette, 0.4, 0.8);
  a.contrast = clamp(a.contrast, 1.0, 1.3);
  a.windowDensity = clamp(a.windowDensity, 0.55, 0.85);
  a.ambient = clamp(a.ambient ?? DEFAULT_ART.ambient, 1.0, 1.6);
  a.maxBuildingH = clamp(a.maxBuildingH, 60, 160);
  a.heroBeamH = clamp(a.heroBeamH, 250, 480);
  // grade shadow must keep an atmospheric floor — never crush to pure black
  a.gradeShadow = (Array.isArray(a.gradeShadow) ? a.gradeShadow : DEFAULT_ART.gradeShadow).slice(0, 3).map((v) => clamp(v, 0.55, 1.05)) as [number, number, number];
  a.gradeHi = (Array.isArray(a.gradeHi) ? a.gradeHi : DEFAULT_ART.gradeHi).slice(0, 3).map((v) => clamp(v, 0.85, 1.2)) as [number, number, number];
  // camera kept sane (tight on the hero, crane down, never a void)
  a.cam = {
    aStart: clamp(a.cam?.aStart ?? DEFAULT_ART.cam.aStart, -3.2, -1.4),
    aEnd: clamp(a.cam?.aEnd ?? DEFAULT_ART.cam.aEnd, -1.6, -0.4),
    radStart: clamp(a.cam?.radStart ?? DEFAULT_ART.cam.radStart, 340, 640),
    radEnd: clamp(a.cam?.radEnd ?? DEFAULT_ART.cam.radEnd, 185, 320),
    eyStart: clamp(a.cam?.eyStart ?? DEFAULT_ART.cam.eyStart, 170, 420),
    eyEnd: clamp(a.cam?.eyEnd ?? DEFAULT_ART.cam.eyEnd, 90, 200),
    lookY: clamp(a.cam?.lookY ?? DEFAULT_ART.cam.lookY, 20, 70),
  };
  // exactly ONE globe + ONE city label, in that order (the LLM sometimes dupes)
  const globe = (a.labels || []).find((l) => l.phase === "globe") || DEFAULT_ART.labels[0];
  const city = (a.labels || []).find((l) => l.phase === "city") || DEFAULT_ART.labels[1];
  a.labels = [{ ...globe, phase: "globe" }, { ...city, phase: "city" }];
  return a;
}

export async function directGeoScene(args: {
  query: string;
  scene: GeoScene3D;
  narration?: string;
  topic?: string;
  heroName?: string;
  log?: Logger;
}): Promise<GeoArtDirection> {
  const stats = computeSceneStats(args.scene);
  const coordStr = `${args.scene.lat0.toFixed(2)}° ${args.scene.lat0 >= 0 ? "N" : "S"}  ${Math.abs(args.scene.lon0).toFixed(2)}° ${args.scene.lon0 >= 0 ? "E" : "W"}`;
  const prompt =
    `${GEO_CAPABILITIES}\n\n` +
    `ART-DIRECT a cinema-grade geographic intro for this REAL place.\n` +
    `PLACE: ${args.query} (centre ${coordStr})\n` +
    (args.topic ? `STORY: ${args.topic}\n` : "") +
    (args.heroName ? `HERO BUILDING (the story location): ${args.heroName}\n` : "") +
    (args.narration ? `NARRATION it must illustrate: """${args.narration.slice(0, 900)}"""\n` : "") +
    `\nSCENE GEOMETRY (already fetched, real OSM): ${JSON.stringify(stats)}\n\n` +
    `Return a JSON object of OVERRIDES to the baseline spec — only the fields you want to change to make THIS ` +
    `place cinematic and tonally right (a tense heist at night wants thick fog, low warm windows, strong vignette, ` +
    `a tight slow crane; a bright modern city wants airier fog and cooler glass). ALWAYS include "labels": a 2-item ` +
    `array — a "globe" label (kicker like "Target Located", big = the CITY name, coord = "${coordStr}") and a "city" ` +
    `label (kicker = the district/area, big = the hero location's real name, coord = a short real subtitle). The "big" ` +
    `titles MUST be real, specific and tonally serious — never comical or generic.\n` +
    `Also include "detailNotes": one sentence on the mood you directed.\n` +
    `Colours are hex strings. windowWarm/gradeShadow/gradeHi are [r,g,b] number arrays. Output ONLY the JSON.`;

  let over: Partial<GeoArtDirection> & { detailNotes?: string } = {};
  try {
    over = await geminiJsonPro<Partial<GeoArtDirection> & { detailNotes?: string }>({ prompt, maxTokens: 4000, temperature: 0.5, log: args.log });
    args.log?.(`geoCinema: art-direction — ${over.detailNotes || "(no notes)"}`);
  } catch (e) {
    args.log?.(`geoCinema: art-direction failed (${e instanceof Error ? e.message : e}); using baseline`);
  }
  const art = deepMerge(DEFAULT_ART, over);
  // Backfill any labels the model left blank so the render never ships empty type.
  if (!art.labels?.length) art.labels = JSON.parse(JSON.stringify(DEFAULT_ART.labels));
  const g = art.labels.find((l) => l.phase === "globe");
  if (g) {
    if (!g.big) g.big = args.scene.place.toUpperCase();
    if (!g.coord) g.coord = coordStr;
  }
  const c = art.labels.find((l) => l.phase === "city");
  if (c) {
    if (!c.big) c.big = (args.heroName || args.scene.place).toUpperCase();
    if (!c.kicker) c.kicker = "Location";
    if (!c.coord) c.coord = args.scene.place.toUpperCase();
  }
  return art;
}

/* ----------------------------------------------------------------------- *
 * 5. DETAIL GATE — is this rich enough for cinema? Evidence + LLM judge.
 * ----------------------------------------------------------------------- */
export async function assessGeoDetail(args: { scene: GeoScene3D; art: GeoArtDirection; log?: Logger }): Promise<GeoDetailAssessment> {
  const stats = computeSceneStats(args.scene);
  // deterministic red flags feed the judge so it cannot hallucinate richness
  const flags: string[] = [];
  if (stats.buildings < 45) flags.push(`thin massing: only ${stats.buildings} buildings`);
  if (!stats.hasHero) flags.push("no hero building flagged");
  if (stats.streets < 12) flags.push(`sparse street network: ${stats.streets} streets`);
  if (stats.realHeightPct < 15) flags.push(`almost no real building heights (${stats.realHeightPct}%) — skyline may look uniform`);
  if (stats.heightMax - stats.heightMin < 18) flags.push("low height variance — flat, un-cinematic skyline");

  const artView = {
    fogDensity: args.art.fogDensity,
    windowWarm: args.art.windowWarm,
    windowDensity: args.art.windowDensity,
    bloom: [args.art.bloomStrength, args.art.bloomRadius, args.art.bloomThreshold],
    grade: { shadow: args.art.gradeShadow, hi: args.art.gradeHi, vignette: args.art.vignette, contrast: args.art.contrast },
    cam: args.art.cam,
    labels: args.art.labels.map((l) => `${l.phase}:${l.big}`),
  };
  const prompt =
    `${GEO_CAPABILITIES}\n\n` +
    `You are the DETAIL-SUFFICIENCY GATE before an expensive render. Decide if this scene + art-direction will ` +
    `produce a CINEMA-LEVEL geographic intro — rich, deep, framed on the hero, never an empty/flat/dark void.\n\n` +
    `SCENE EVIDENCE: ${JSON.stringify(stats)}\n` +
    `DETERMINISTIC RED FLAGS: ${flags.length ? flags.join("; ") : "none"}\n` +
    `ART-DIRECTION: ${JSON.stringify(artView)}\n\n` +
    `Judge against the capability contract. Return JSON:\n` +
    `{ "pass": boolean, "score": 0-10, "gaps": ["..."], "verdict": "one sentence",\n` +
    `  "enrich": { ...partial spec overrides that would fix the gaps — e.g. raise windowDensity, thicken fog to ` +
    `hide sparse edges, tighten cam.radEnd, raise contrast, fix a weak label... },\n` +
    `  "refetchRadius": <metres, ONLY if geometry is too thin and a wider fetch would help; else omit> }\n` +
    `Pass only at score >= 7. Be strict but practical — small real cities are fine if framed tight and graded well. ` +
    `Output ONLY the JSON.`;

  try {
    const r = await geminiJson<GeoDetailAssessment>({ prompt, model: "gemini-3.1-pro-preview", maxTokens: 2500, temperature: 0.3 });
    r.gaps = r.gaps || [];
    r.pass = !!r.pass && (r.score ?? 0) >= 7;
    args.log?.(`geoCinema: detail gate ${r.pass ? "PASS" : "FAIL"} score=${r.score} — ${r.verdict || ""}`);
    return r;
  } catch (e) {
    // fail-open ONLY when there are no hard flags; otherwise force one enrich pass
    const pass = flags.length === 0;
    args.log?.(`geoCinema: detail gate errored (${e instanceof Error ? e.message : e}); ${pass ? "no flags → pass" : "flags present → enrich"}`);
    return { pass, score: pass ? 7 : 5, gaps: flags, verdict: "heuristic fallback", ...(pass ? {} : { enrich: { fogDensity: 0.003, windowDensity: 0.75 } }) };
  }
}

/* ----------------------------------------------------------------------- *
 * 6. COMPOSE + RENDER
 * ----------------------------------------------------------------------- */
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildLabelsHtml(art: GeoArtDirection): string {
  const T = art.timing;
  return art.labels
    .map((l, i) => {
      const globe = l.phase === "globe";
      const start = globe ? Math.max(0, T.spinEnd - 0.1) : T.beam;
      const dur = globe ? T.flash - T.spinEnd + 0.35 : T.total - T.beam + 0.1;
      // auto-fit the big title: long real names ("ANTWERP DIAMOND CENTRE")
      // overflow the 112px default and collide with the next label.
      const len = (l.big || "").length;
      const fs = Math.max(54, Math.min(112, Math.floor(1560 / Math.max(9, len))));
      return (
        `<div class="ov clip" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="${2 + i}" style="left:120px; bottom:${globe ? 160 : 165}px; max-width:1680px">` +
        `<div class="kick" style="color:${l.kickerColor || "#5fe0cf"}">${esc(l.kicker)}</div>` +
        `<div class="big" style="font-size:${fs}px">${esc(l.big)}</div>` +
        `<div class="coord mono" style="color:${l.coordColor || "#e8b23a"}">${esc(l.coord)}</div></div>`
      );
    })
    .join("\n      ");
}

/** Stamp the template into a renderable index.html string. */
export async function buildGeoComposition(scene: GeoScene3D, art: GeoArtDirection): Promise<string> {
  const tpl = await readFile(join(MODULE_DIR, "..", "geo", "cityzoom.tpl.html"), "utf8");
  // labels live in HTML; the 3D renderer reads everything else from SPEC
  const { labels: _omit, ...specForJs } = art;
  void _omit;
  return tpl
    .replace(/__DUR__/g, art.timing.total.toFixed(2))
    .replace("__LABELS__", buildLabelsHtml(art))
    .replace("__SPEC__", JSON.stringify(specForJs))
    .replace("__SCENE__", JSON.stringify(scene));
}

/** Write the project dir (vendored assets + index.html) and render via HyperFrames. */
export async function renderGeoIntro(args: {
  html: string;
  projectDir: string;
  assetsDir?: string;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  out?: string;
  log?: Logger;
}): Promise<string> {
  const assetsDir = args.assetsDir || process.env.GEO_ASSETS_DIR || join(MODULE_DIR, "..", "geo", "assets");
  if (!existsSync(join(assetsDir, "three.min.js")) || !existsSync(join(assetsDir, "earth.jpg")) || !existsSync(join(assetsDir, "pp"))) {
    throw new Error(`geoCinema: vendored assets missing in ${assetsDir} (need three.min.js, earth.jpg, pp/). Set GEO_ASSETS_DIR.`);
  }
  await mkdir(args.projectDir, { recursive: true });
  await cp(join(assetsDir, "three.min.js"), join(args.projectDir, "three.min.js"));
  await cp(join(assetsDir, "earth.jpg"), join(args.projectDir, "earth.jpg"));
  await cp(join(assetsDir, "pp"), join(args.projectDir, "pp"), { recursive: true });
  await writeFile(join(args.projectDir, "index.html"), args.html, "utf8");
  await writeFile(join(args.projectDir, "hyperframes.json"), JSON.stringify({ compositions: [{ id: "main" }] }), "utf8");

  const out = args.out || "geo_intro.mp4";
  args.log?.(`geoCinema: rendering ${out} (${args.quality || "standard"} ${args.fps || 30}fps) via hyperframes@${HYPERFRAMES_VERSION}…`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("npx", [`hyperframes@${HYPERFRAMES_VERSION}`, "render", "-q", args.quality || "standard", "-f", String(args.fps || 30), "--no-browser-gpu", "-o", out], {
      cwd: args.projectDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let e = "";
    p.stderr.on("data", (d) => (e += String(d)));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`hyperframes render exited ${c}: ${e.slice(-400)}`))));
    p.on("error", reject);
  });
  return join(args.projectDir, out);
}

/** ffmpeg: grab a single frame at time t. */
function grabFrame(video: string, t: number, out: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(process.env.FFMPEG_BIN || "ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", out, "-loglevel", "error"]);
    p.on("close", (c) => resolve(c === 0 && existsSync(out)));
    p.on("error", () => resolve(false));
  });
}

/* ----------------------------------------------------------------------- *
 * 6b. VISION VERIFIER — the LLM SEES the actual render and critiques it.
 *    A blind numeric gate pushed knobs into blowout; this one looks at pixels.
 * ----------------------------------------------------------------------- */
export interface GeoVisionVerdict {
  pass: boolean;
  score: number;
  /** per-frame critique (globe / city-establish / payoff). */
  issues: string[];
  verdict: string;
  /** SPEC overrides to fix what the LLM SAW (bounded by clampArt). */
  actions?: Partial<GeoArtDirection>;
}

/**
 * Render a fast DRAFT preview, grab the three storytelling beats (settled
 * globe, city establishing, hero payoff) and let Gemini Vision JUDGE the real
 * pixels — blown-out? dark void? hero unframed? labels overlapping/garbled?
 * beacon on a believable location? — returning corrective SPEC overrides.
 */
export async function verifyGeoRender(args: {
  scene: GeoScene3D;
  art: GeoArtDirection;
  runDir: string;
  assetsDir?: string;
  round: number;
  log?: Logger;
}): Promise<GeoVisionVerdict> {
  const log = args.log || (() => {});
  const html = await buildGeoComposition(args.scene, args.art);
  const previewDir = join(args.runDir, `preview_${args.round}`);
  // STANDARD quality (draft skips bloom/post → misleads the judge), low fps for speed.
  const video = await renderGeoIntro({ html, projectDir: previewDir, assetsDir: args.assetsDir, quality: "standard", fps: 8, out: "preview.mp4", log });
  const T = args.art.timing;
  const beats = [
    { key: "globe", t: Math.max(0.1, T.flash - 0.45), want: "SETTLED GLOBE: a clean lit blue-marble Earth (NOT a blown-out white disc), a gold target beacon resting on a believable, recognizable landmass for the city, atmosphere glow, and a readable kicker+CITY title+coordinates." },
    // judge the city when it is ESTABLISHED (fully risen + lit), not mid-rise.
    { key: "city", t: Math.min(T.total - 1.4, T.riseEnd + 0.2), want: "CITY ESTABLISHED: a real night skyline of lit-window buildings filling the frame with depth against a faint horizon glow (NOT a dark empty void / black plaza), the district reading as a real place." },
    { key: "payoff", t: Math.max(T.beam + 0.5, T.total - 0.7), want: "HERO PAYOFF: the hero building framed prominently with its gold light beam, a rich lit district around it, and a clean readable lower-left label (kicker + title + subtitle) that is NOT overlapping/garbled/overflowing the frame." },
  ];
  const paths: string[] = [];
  for (const b of beats) {
    const out = join(previewDir, `frame_${b.key}.jpg`);
    if (await grabFrame(video, b.t, out)) paths.push(out);
  }
  if (!paths.length) {
    log("geoCinema: vision verify — no frames grabbed; passing open");
    return { pass: true, score: 7, issues: [], verdict: "no frames to judge" };
  }
  const prompt =
    `${GEO_CAPABILITIES}\n\n` +
    `You are the VISION VERIFIER. ${paths.length} frames follow IN ORDER, each a storytelling beat of the geo intro:\n` +
    beats.slice(0, paths.length).map((b, i) => `  Frame ${i + 1} (${b.key}) should be — ${b.want}`).join("\n") +
    `\n\nAESTHETIC: this is an intentional CINEMATIC NOIR NIGHT piece — a mostly-dark frame with GLOWING lit windows, ` +
    `a gold hero beam and an atmospheric (non-black) horizon glow is the INTENDED look, NOT a defect. Do not penalise ` +
    `darkness or empty sky. PASS the city beats when they read as a believable night city: visible lit-window buildings ` +
    `with depth, a clearly visible hero building/beam, an atmospheric horizon (not pure black), and clean readable ` +
    `lower-left labels. Only FAIL on genuine breakage: globe blown to white; a TRULY black frame with no lit windows ` +
    `at all; the hero building absent/indistinguishable; labels garbled/overlapping/cut off; beacon stranded in open ` +
    `ocean far from land. Return JSON:\n` +
    `{ "pass": boolean, "score": 0-10, "issues": ["frame N: ..."], "verdict": "one sentence",\n` +
    `  "actions": { ...SPEC overrides to FIX what you saw } }\n` +
    `LEVERS (use the RIGHT direction): too DARK / void → RAISE ambient (1.0-1.6), RAISE windowDensity (≤0.85), RAISE ` +
    `each gradeShadow component toward ~1.0 (this LIFTS shadows — do NOT lower it, that crushes to black), brighten ` +
    `skyHorizon, and lower fogDensity (≤0.0030) so the lit windows read. Hero lost in space → lower cam.eyEnd + lower ` +
    `cam.radEnd (tighter). Window glow + bloom + Earth exposure are FIXED — never touch windowWarm, bloom*, earth, ` +
    `calib*, or timing (they are correct). Omit actions if nothing to fix.\n` +
    `Pass only at score >= 7. Output ONLY the JSON.`;
  try {
    // Provider-routed vision (groq→fal→gemini) — the Pro-model hint is gone with
    // the direct Gemini call; the verifier prompt carries all the judging context.
    const raw = await visionLocal({ prompt, imagePaths: paths, json: true, maxTokens: 4000 });
    const v = parseJsonLoose<GeoVisionVerdict>(raw);
    v.issues = Array.isArray(v.issues) ? v.issues : [];
    // robust verdict: a truncated/partial JSON can drop "score" — infer from the
    // explicit pass flag / issue count rather than silently treating it as 0.
    if (typeof v.score !== "number") v.score = v.pass === true ? 8 : v.issues.length ? 4 : 7;
    v.pass = (v.pass === true || v.score >= 7) && v.score >= 7;
    log(`geoCinema: VISION verify round ${args.round} ${v.pass ? "PASS" : "FAIL"} score=${v.score} — ${v.verdict || "(no verdict text)"}`);
    if (v.issues.length) v.issues.forEach((i) => log(`  · ${i}`));
    return v;
  } catch (e) {
    log(`geoCinema: vision verify errored (${e instanceof Error ? e.message : e}); passing open (exposure is clamp-safe)`);
    return { pass: true, score: 7, issues: [], verdict: "vision judge unavailable" };
  }
}

/* ----------------------------------------------------------------------- *
 * 7. ORCHESTRATOR — fetch → direct → GATE (loop) → compose → render.
 * ----------------------------------------------------------------------- */
export async function craftGeoIntro(args: {
  query: string;
  runDir: string;
  narration?: string;
  topic?: string;
  heroName?: string;
  assetsDir?: string;
  /** vision verify rounds (each renders a fast draft preview the LLM looks at). */
  maxVerifyRounds?: number;
  out?: string;
  log?: Logger;
}): Promise<{ outPath: string; scene: GeoScene3D; art: GeoArtDirection; assessment: GeoDetailAssessment; verdict: GeoVisionVerdict; rounds: number }> {
  const log = args.log || (() => {});
  const maxRounds = args.maxVerifyRounds ?? 2;

  // 1. real geometry + a CHEAP numeric pre-check that can WIDEN the fetch
  //    (vision can't conjure missing buildings — only a bigger radius can).
  let scene = await fetchGeoScene3D(args.query, join(args.runDir, "geo"), 620, log);
  const assessment = await assessGeoDetail({ scene, art: DEFAULT_ART, log });
  if (assessment.refetchRadius && assessment.refetchRadius > scene.radius) {
    log(`geoCinema: geometry thin → widening fetch to ${assessment.refetchRadius}m`);
    scene = await fetchGeoScene3D(args.query, join(args.runDir, "geo"), Math.min(1200, assessment.refetchRadius), log);
  }

  // 2. LLM art-direction → safety-clamped (locks exposure/calib/timing).
  let art = clampArt(await directGeoScene({ query: args.query, scene, narration: args.narration, topic: args.topic, heroName: args.heroName, log }));

  // 3. VISION VERIFY LOOP — render a draft preview, let the LLM SEE it, apply
  //    its corrective overrides (re-clamped), repeat until it looks cinematic.
  let verdict: GeoVisionVerdict = { pass: false, score: 0, issues: [], verdict: "not yet verified" };
  let round = 0;
  while (round < maxRounds) {
    round++;
    verdict = await verifyGeoRender({ scene, art, runDir: args.runDir, assetsDir: args.assetsDir, round, log });
    if (verdict.pass || !verdict.actions) break;
    art = clampArt(deepMerge(art, verdict.actions));
    log(`geoCinema: applied vision fixes, re-previewing (round ${round + 1})`);
  }
  log(`geoCinema: verify ${verdict.pass ? "PASSED" : "ACCEPTED (rounds exhausted)"} after ${round} round(s), score=${verdict.score}`);

  // 4. final full-resolution render of the VERIFIED art.
  const html = await buildGeoComposition(scene, art);
  const outPath = await renderGeoIntro({ html, projectDir: join(args.runDir, "render"), assetsDir: args.assetsDir, quality: "standard", fps: 30, out: args.out, log });
  log(`geoCinema: rendered → ${outPath}`);
  return { outPath, scene, art, assessment, verdict, rounds: round };
}
