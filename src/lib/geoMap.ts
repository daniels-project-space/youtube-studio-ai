/**
 * GEO MAP DATA — real street + building geometry for a named place, projected
 * to normalized [0,1] frame coordinates for the geo_map motion-graphics shot.
 *
 *   geocode (Nominatim) → streets + buildings (Overpass) → project → cache.
 *
 * Robust: on any failure it returns a deterministic PROCEDURAL street grid so
 * geo_map always renders something. Cached per-place in the run dir.
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
  streets: GeoStreet[];
  /** Building footprints (normalized polygons). */
  buildings: [number, number][][];
  /** true if procedurally generated (OSM unavailable). */
  synthetic?: boolean;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Frame is 16:9 → make the ground rectangle match so streets fill the frame. */
const HALF_W_M = 900;
const HALF_H_M = 520;

async function geocode(query: string, log?: Logger): Promise<{ lat: number; lon: number; name: string } | null> {
  const j = await curlJson<{ lat: string; lon: string; display_name: string }[]>(
    ["-A", "documotion-geomap/1.0", `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`],
    20_000,
  );
  if (!j?.length) return null;
  log?.(`geo: "${query}" → ${j[0].lat},${j[0].lon}`);
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), name: j[0].display_name };
}

interface OverpassWay {
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

async function overpass(lat: number, lon: number, log?: Logger): Promise<OverpassWay[] | null> {
  const q =
    `[out:json][timeout:25];(` +
    `way[highway~"^(primary|secondary|tertiary|residential|trunk|motorway|unclassified|living_street)$"](around:1100,${lat},${lon});` +
    `way[building](around:650,${lat},${lon}););out geom 6000;`;
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    const j = await curlJson<{ elements: OverpassWay[] }>(["-A", "documotion-geomap/1.0", "-X", "POST", "--data-urlencode", `data=${q}`, host], 50_000);
    if (j?.elements?.length) {
      log?.(`geo: overpass ${j.elements.length} ways`);
      return j.elements;
    }
  }
  return null;
}

/** Deterministic stylised street grid when OSM is unavailable. */
function syntheticCity(label: string): CityGeo {
  let s = 0;
  for (const c of label) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const streets: GeoStreet[] = [];
  const buildings: [number, number][][] = [];
  const N = 11;
  for (let i = 0; i <= N; i++) {
    const base = i / N;
    const jitter = (rnd() - 0.5) * 0.03;
    streets.push({ p: [[0, r4(base + jitter)], [0.5, r4(base + (rnd() - 0.5) * 0.03)], [1, r4(base + jitter)]], m: i % 4 === 0 });
    streets.push({ p: [[r4(base + jitter), 0], [r4(base + (rnd() - 0.5) * 0.03), 0.5], [r4(base + jitter), 1]], m: i % 4 === 2 });
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      if (rnd() < 0.4) continue;
      const x = (i + 0.2) / N + rnd() * 0.02;
      const y = (j + 0.2) / N + rnd() * 0.02;
      const w = 0.025 + rnd() * 0.02;
      const h = 0.025 + rnd() * 0.02;
      buildings.push([[r4(x), r4(y)], [r4(x + w), r4(y)], [r4(x + w), r4(y + h)], [r4(x), r4(y + h)]]);
    }
  return { label, pin: [0.5, 0.5], streets, buildings, synthetic: true };
}

/** Fetch (or load cached) projected city geometry. Never throws. */
export async function fetchCityGeo(query: string, runDir: string, log?: Logger): Promise<CityGeo> {
  await mkdir(runDir, { recursive: true });
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const cache = join(runDir, `geo_${slug}.json`);
  if (existsSync(cache)) {
    try {
      return JSON.parse(await readFile(cache, "utf8")) as CityGeo;
    } catch {
      /* refetch */
    }
  }
  const label = query.split(/[,—-]/)[0].trim().toUpperCase();
  const geo = await geocode(query, log);
  if (!geo) {
    const syn = syntheticCity(label);
    await writeFile(cache, JSON.stringify(syn), "utf8");
    return syn;
  }
  const ways = await overpass(geo.lat, geo.lon, log);
  if (!ways) {
    const syn = syntheticCity(label);
    syn.pin = [0.5, 0.5];
    await writeFile(cache, JSON.stringify(syn), "utf8");
    return syn;
  }
  // Project: rectangle of HALF_W_M × HALF_H_M metres around the centre → [0,1].
  const dLat = HALF_H_M / 111_320;
  const dLon = HALF_W_M / (111_320 * Math.cos((geo.lat * Math.PI) / 180));
  const px = (lon: number) => (lon - (geo.lon - dLon)) / (2 * dLon);
  const py = (lat: number) => 1 - (lat - (geo.lat - dLat)) / (2 * dLat);
  const inFrame = (x: number, y: number) => x > -0.1 && x < 1.1 && y > -0.1 && y < 1.1;

  const MAJOR = new Set(["primary", "secondary", "trunk", "motorway"]);
  const streets: GeoStreet[] = [];
  const buildings: [number, number][][] = [];
  for (const w of ways) {
    const g = w.geometry;
    if (!g?.length) continue;
    const pts = g.map((n) => [r4(px(n.lon)), r4(py(n.lat))] as [number, number]).filter(([x, y]) => inFrame(x, y));
    if (pts.length < 2) continue;
    if (w.tags?.building) {
      if (buildings.length < 260 && pts.length >= 3) buildings.push(pts.length > 10 ? pts.filter((_, i) => i % 2 === 0) : pts);
    } else if (w.tags?.highway) {
      streets.push({ p: pts.length > 14 ? pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1) : pts, m: MAJOR.has(w.tags.highway) });
    }
  }
  const out: CityGeo = { label, pin: [r4(px(geo.lon)), r4(py(geo.lat))], streets: streets.slice(0, 170), buildings };
  if (out.streets.length < 6) {
    const syn = syntheticCity(label);
    await writeFile(cache, JSON.stringify(syn), "utf8");
    return syn;
  }
  log?.(`geo: "${label}" projected — ${out.streets.length} streets, ${out.buildings.length} buildings`);
  await writeFile(cache, JSON.stringify(out), "utf8");
  return out;
}
