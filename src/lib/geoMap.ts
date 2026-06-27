/**
 * GEO MAP DATA — real cartographic geometry for a named place, projected to
 * normalized [0,1] frame coords for the geo_map motion-graphics shot.
 *
 *   geocode + feature outline (Nominatim polygon_geojson)
 *     → water / waterways / roads in the framed window (Overpass)
 *     → project to 16:9 frame → cache.
 *
 * The SUBJECT is the hero: a canal/river resolves to a glowing ROUTE, a
 * country/lake/city to an AREA outline. We frame the window on the feature's
 * own bounding box (a 160 km canal fills the frame; a city centre gets a metro
 * window) and carry the true centre + degree span so the renderer can draw a
 * real lat/lon graticule and scale bar.
 *
 * Robust: any failure degrades to a deterministic ORGANIC place (noise-built
 * coastline + a crossing route), never the old tic-tac-toe grid. Cached per
 * place in the run dir.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

type Logger = (msg: string) => void;

/** curl subprocess JSON — Nominatim/Overpass WAF-block Node's undici client. */
function curlJson<T = unknown>(args: string[], timeoutMs = 45_000): Promise<T | null> {
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

export type GeoKind = "waterway" | "area" | "city";

export interface GeoStreet {
  /** Polyline in normalized [0,1] frame coords. */
  p: [number, number][];
  /** Major road (thicker + glowing). */
  m: boolean;
}
export interface CityGeo {
  label: string;
  /** Pin position in normalized coords (the geocoded centre). */
  pin: [number, number];
  /** What the subject is → drives the render style. */
  kind: GeoKind;
  /** True centre [lat, lon] of the framed window (for the coordinate readout). */
  center: [number, number];
  /** Degree span [latDeg, lonDeg] of the framed window (for graticule + scale). */
  span: [number, number];
  streets: GeoStreet[];
  /** Building footprints (normalized polygons). */
  buildings: [number, number][][];
  /** Filled water polygons (lakes / bays / seas tagged as areas). */
  water: [number, number][][];
  /** Waterway lines (rivers / canals) — ambient texture. */
  waterways: [number, number][][];
  /** The SUBJECT feature as line geometry (the hero, e.g. the canal). */
  route: [number, number][][];
  /** The SUBJECT feature as area polygons (country / lake / city outline). */
  area: [number, number][][];
  /** true if procedurally generated (OSM unavailable). */
  synthetic?: boolean;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const FRAME_AR = 16 / 9;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  boundingbox?: [string, string, string, string]; // S, N, W, E
  geojson?: { type: string; coordinates: unknown };
}

interface GeoHit {
  lat: number;
  lon: number;
  name: string;
  kind: GeoKind;
  bbox: [number, number, number, number]; // S, N, W, E
  geojson?: { type: string; coordinates: unknown };
}

function classifyKind(cls?: string, type?: string): GeoKind {
  if (cls === "waterway" || type === "canal" || type === "river" || type === "strait") return "waterway";
  if (cls === "boundary" || cls === "place" || type === "country" || type === "state" || type === "island" || type === "water" || type === "bay" || type === "sea" || type === "lake") return "area";
  return "city";
}

async function geocode(query: string, log?: Logger): Promise<GeoHit | null> {
  const j = await curlJson<NominatimResult[]>(
    ["-A", "documotion-geomap/1.0", `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=1`],
    20_000,
  );
  if (!j?.length) return null;
  const h = j[0];
  const lat = parseFloat(h.lat);
  const lon = parseFloat(h.lon);
  const kind = classifyKind(h.class, h.type);
  let bbox: [number, number, number, number];
  if (h.boundingbox?.length === 4) {
    bbox = [parseFloat(h.boundingbox[0]), parseFloat(h.boundingbox[1]), parseFloat(h.boundingbox[2]), parseFloat(h.boundingbox[3])];
  } else {
    bbox = [lat - 0.02, lat + 0.02, lon - 0.02, lon + 0.02];
  }
  log?.(`geo: "${query}" → ${lat},${lon} (${h.class ?? "?"}/${h.type ?? "?"} → ${kind})`);
  return { lat, lon, name: h.display_name, kind, bbox, geojson: h.geojson };
}

/**
 * Choose the framed window: pad the feature bbox, enforce a sane minimum size
 * (a point/small city gets a metro window), and stretch the short axis so the
 * window is exactly 16:9 in metres → streets/route fill the frame, no squash.
 */
function frameWindow(hit: GeoHit): { cLat: number; cLon: number; dLat: number; dLon: number } {
  const cLat = (hit.bbox[0] + hit.bbox[1]) / 2;
  const cLon = (hit.bbox[2] + hit.bbox[3]) / 2;
  let spanLat = Math.abs(hit.bbox[1] - hit.bbox[0]);
  let spanLon = Math.abs(hit.bbox[3] - hit.bbox[2]);
  // minimum window so a point result isn't infinitely zoomed in
  const minLat = hit.kind === "city" ? 0.026 : 0.05; // ~2.9 / 5.5 km tall
  spanLat = Math.max(spanLat, minLat);
  spanLon = Math.max(spanLon, minLat * FRAME_AR);
  // pad
  spanLat *= 1.28;
  spanLon *= 1.28;
  // enforce 16:9 in METRES (lon degrees shrink by cos(lat))
  const cosLat = Math.cos((cLat * Math.PI) / 180) || 1;
  const wM = spanLon * cosLat;
  const hM = spanLat;
  if (wM / hM > FRAME_AR) spanLat = wM / FRAME_AR; // too wide → grow height
  else spanLon = (hM * FRAME_AR) / cosLat; // too tall → grow width
  return { cLat, cLon, dLat: spanLat / 2, dLon: spanLon / 2 };
}

interface OverpassWay {
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Roads + water within the framed bbox. */
async function overpass(s: number, n: number, w: number, e: number, log?: Logger): Promise<OverpassWay[] | null> {
  const bb = `${r4(s)},${r4(w)},${r4(n)},${r4(e)}`;
  const q =
    `[out:json][timeout:25];(` +
    `way[highway~"^(primary|secondary|tertiary|trunk|motorway)$"](${bb});` +
    `way[natural=water](${bb});` +
    `way[natural=coastline](${bb});` +
    `way[waterway~"^(river|canal)$"](${bb}););out geom 5000;`;
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    const j = await curlJson<{ elements: OverpassWay[] }>(["-A", "documotion-geomap/1.0", "-X", "POST", "--data-urlencode", `data=${q}`, host], 50_000);
    if (j?.elements?.length) {
      log?.(`geo: overpass ${j.elements.length} ways`);
      return j.elements;
    }
  }
  return null;
}

/** GeoJSON ring/line coordinate walker → normalized polylines. */
function projectGeoJson(
  gj: { type: string; coordinates: unknown } | undefined,
  px: (lon: number) => number,
  py: (lat: number) => number,
): { lines: [number, number][][]; polys: [number, number][][] } {
  const lines: [number, number][][] = [];
  const polys: [number, number][][] = [];
  if (!gj) return { lines, polys };
  const ring = (coords: number[][]): [number, number][] => coords.map(([lo, la]) => [r4(px(lo)), r4(py(la))] as [number, number]);
  const c = gj.coordinates as number[] | number[][] | number[][][] | number[][][][];
  switch (gj.type) {
    case "LineString":
      lines.push(ring(c as number[][]));
      break;
    case "MultiLineString":
      for (const l of c as number[][][]) lines.push(ring(l));
      break;
    case "Polygon":
      for (const r of c as number[][][]) polys.push(ring(r));
      break;
    case "MultiPolygon":
      for (const poly of c as number[][][][]) for (const r of poly) polys.push(ring(r));
      break;
  }
  return { lines, polys };
}

const valueNoise = (seedRng: () => number) => {
  const g: number[] = Array.from({ length: 257 }, () => seedRng());
  return (x: number) => {
    const i = Math.floor(x) & 255;
    const f = x - Math.floor(x);
    const u = f * f * (3 - 2 * f);
    return g[i] * (1 - u) + g[i + 1] * u;
  };
};

/** Deterministic ORGANIC place when OSM is unavailable — coastline + route, never a grid. */
function syntheticPlace(label: string, kind: GeoKind): CityGeo {
  let s = 0;
  for (const c of label) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nz = valueNoise(rnd);
  // organic coastline: a wavy boundary; one side is water (filled polygon)
  const diag = rnd() < 0.5;
  const coast: [number, number][] = [];
  const STEPS = 48;
  const amp = 0.16 + rnd() * 0.1;
  const phase = rnd() * 10;
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const wob = (nz(u * 3.2 + phase) - 0.5) * amp;
    if (diag) coast.push([r4(u), r4(0.32 + wob + u * 0.18)]);
    else coast.push([r4(0.34 + wob + u * 0.16), r4(u)]);
  }
  // close the coastline into a water polygon along the near edge
  const water: [number, number][] = [...coast];
  if (diag) {
    water.push([1, 1.05], [0, 1.05]);
  } else {
    water.push([1.05, 1], [1.05, 0]);
  }
  // the SUBJECT route: a believable channel crossing toward the centre
  const route: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const wob = (nz(u * 2.1 + phase + 4) - 0.5) * 0.06;
    route.push([r4(0.16 + u * 0.68), r4(0.5 + wob + Math.sin(u * Math.PI) * 0.04)]);
  }
  // sparse organic roads near the land side
  const streets: GeoStreet[] = [];
  for (let k = 0; k < 14; k++) {
    const x0 = rnd();
    const y0 = rnd() * 0.5 + (diag ? 0 : 0.0);
    const pts: [number, number][] = [];
    let x = x0,
      y = y0;
    const ang = rnd() * Math.PI * 2;
    const len = 4 + Math.floor(rnd() * 5);
    for (let j = 0; j < len; j++) {
      pts.push([r4(x), r4(y)]);
      x += Math.cos(ang) * 0.05 + (rnd() - 0.5) * 0.03;
      y += Math.sin(ang) * 0.05 + (rnd() - 0.5) * 0.03;
    }
    streets.push({ p: pts, m: k % 5 === 0 });
  }
  return {
    label,
    pin: [0.5, 0.5],
    kind,
    center: [30, 31],
    span: [0.08, 0.08 * FRAME_AR],
    streets,
    buildings: [],
    water: [water],
    waterways: [],
    route: kind === "area" ? [] : [route],
    area: kind === "area" ? [water] : [],
    synthetic: true,
  };
}

/** Fetch (or load cached) projected city geometry. Never throws. */
export async function fetchCityGeo(query: string, runDir: string, log?: Logger): Promise<CityGeo> {
  await mkdir(runDir, { recursive: true });
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const cache = join(runDir, `geo_${slug}.json`);
  if (existsSync(cache)) {
    try {
      const cached = JSON.parse(await readFile(cache, "utf8")) as CityGeo;
      if (cached.center && cached.span) return cached; // tolerate old-schema caches by ignoring them
    } catch {
      /* refetch */
    }
  }
  const label = query.split(/[,—-]/)[0].trim().toUpperCase();
  const hit = await geocode(query, log);
  if (!hit) {
    const syn = syntheticPlace(label, "waterway");
    await writeFile(cache, JSON.stringify(syn), "utf8");
    return syn;
  }

  const win = frameWindow(hit);
  const px = (lon: number) => (lon - (win.cLon - win.dLon)) / (2 * win.dLon);
  const py = (lat: number) => 1 - (lat - (win.cLat - win.dLat)) / (2 * win.dLat);
  const inFrame = (x: number, y: number) => x > -0.15 && x < 1.15 && y > -0.15 && y < 1.15;
  const clip = (pts: [number, number][]) => pts.filter(([x, y]) => inFrame(x, y));

  // subject geometry from Nominatim
  const subj = projectGeoJson(hit.geojson, px, py);
  const route: [number, number][][] = [];
  const area: [number, number][][] = [];
  for (const l of subj.lines) {
    const c = l.length > 220 ? l.filter((_, i) => i % 3 === 0 || i === l.length - 1) : l;
    if (c.length >= 2) route.push(c);
  }
  for (const p of subj.polys) {
    const c = p.length > 200 ? p.filter((_, i) => i % 3 === 0 || i === p.length - 1) : p;
    if (c.length >= 3) area.push(c);
  }

  // window roads + water from Overpass
  const ways = await overpass(win.cLat - win.dLat, win.cLat + win.dLat, win.cLon - win.dLon, win.cLon + win.dLon, log);
  const MAJOR = new Set(["primary", "secondary", "trunk", "motorway"]);
  const streets: GeoStreet[] = [];
  const water: [number, number][][] = [];
  const waterways: [number, number][][] = [];
  for (const w of ways ?? []) {
    const g = w.geometry;
    if (!g?.length) continue;
    const pts = clip(g.map((nd) => [r4(px(nd.lon)), r4(py(nd.lat))] as [number, number]));
    if (pts.length < 2) continue;
    const thin = (p: [number, number][], every = 2) => (p.length > 14 ? p.filter((_, i) => i % every === 0 || i === p.length - 1) : p);
    if (w.tags?.natural === "water" && pts.length >= 3) {
      if (water.length < 120) water.push(thin(pts));
    } else if (w.tags?.waterway || w.tags?.natural === "coastline") {
      if (waterways.length < 80) waterways.push(thin(pts));
    } else if (w.tags?.highway) {
      if (streets.length < 200) streets.push({ p: thin(pts), m: MAJOR.has(w.tags.highway) });
    }
  }

  const out: CityGeo = {
    label,
    pin: [r4(px(hit.lon)), r4(py(hit.lat))],
    kind: hit.kind,
    center: [r4(win.cLat), r4(win.cLon)],
    span: [r4(win.dLat * 2), r4(win.dLon * 2)],
    streets: streets.slice(0, 170),
    buildings: [],
    water,
    waterways,
    route,
    area,
  };

  // nothing meaningful resolved → organic fallback (better than an empty frame)
  if (route.length === 0 && area.length === 0 && streets.length < 5 && water.length === 0) {
    const syn = syntheticPlace(label, hit.kind);
    syn.pin = [r4(px(hit.lon)), r4(py(hit.lat))];
    syn.center = [r4(win.cLat), r4(win.cLon)];
    syn.span = [r4(win.dLat * 2), r4(win.dLon * 2)];
    await writeFile(cache, JSON.stringify(syn), "utf8");
    return syn;
  }
  log?.(`geo: "${label}" framed — route ${route.length}, area ${area.length}, ${streets.length} roads, ${water.length} water, ${waterways.length} waterways`);
  await writeFile(cache, JSON.stringify(out), "utf8");
  return out;
}
