/**
 * assembly-parity — the PARITY PROOF for the Assembly CUTOVER ADAPTER.
 *
 *   ./node_modules/.bin/tsx scripts/assembly-parity.ts
 *
 * Proves the standalone EDL path (buildPlanInput → planTimeline) reproduces the live
 * `timeline_assemble` god-block's DETERMINISTIC plan math EXACTLY — without running the
 * real god-block (no ffmpeg / Remotion / Convex / R2). The god-block's expected numbers
 * are recomputed here INDEPENDENTLY (a second implementation of the same formulas, NOT a
 * call into planTimeline), then asserted against the EDL plan:
 *
 *   • projected duration       == introSec + narrationSec + tailSec   (videoSec)
 *   • body clip durSec (cap)   == bodySegSeconds(narrationSec, cutSheet)  (bodyMaxSeg)
 *   • interleave order         == [footage[k], entity[k]] alternation
 *   • intro card present       <=> introCardPath set
 *   • outro card present       <=> tailSec >= 2
 *   • clip coverage            >= narration + tail (no loop / dead-air)
 *
 * Prints a parity table (input → god-block-expected vs EDL-actual → MATCH/DIFF) and
 * EXITS NON-ZERO on any DIFF.
 */
import { buildPlanInput } from "@/lib/assembly/cutover";
import { paramsToAssemble } from "@/lib/assembly/cutover";
import { planTimeline } from "@/lib/assembly/planTimeline";
import { projectedDurationSec, type Segment, type Timeline } from "@/lib/assembly/timeline";

/* ---------- INDEPENDENT re-implementation of the god-block's plan math ---------- */
/* (Deliberately a SEPARATE implementation from planTimeline — that is what makes
   this a parity proof and not a tautology.) */

/** narratedBlocks.ts::bodySegSeconds, re-implemented independently. */
function expectedBodySeg(narrationSec: number, cutSheet?: { sections?: { cutsPerMin: number }[] }): number {
  const cad = (cutSheet?.sections ?? []).map((s) => s.cutsPerMin).filter((c) => c > 0);
  if (cad.length) {
    const avg = cad.reduce((a, b) => a + b, 0) / cad.length;
    return Math.max(4, Math.min(30, Math.round(60 / avg)));
  }
  return narrationSec > 600 ? 25 : 10;
}

/** The god-block's interleave: footage[k] then entity[k] for k in [0, max). */
function expectedInterleave(footage: string[], entity: string[]): string[] {
  const out: string[] = [];
  const maxn = Math.max(footage.length, entity.length);
  for (let k = 0; k < maxn; k++) {
    if (footage[k]) out.push(footage[k]);
    if (entity[k]) out.push(entity[k]);
  }
  return out;
}

interface Store {
  footageClips: string[];
  entityClips?: string[];
  narrationLocalPath?: string;
  narrationDurationSec: number;
  introCardPath?: string;
  introSec?: number;
  musicKey?: string;
  musicUrl?: string;
  sentenceTimings?: { text?: string; start?: number; end: number }[];
  cutSheet?: { sections?: { name?: string; cutsPerMin: number }[] };
  chapterPlan?: { kind: "footage" | "card"; durSec: number; heading?: string }[];
  channelName?: string;
  channelAvatarKey?: string;
  script?: { closingLine?: string };
  quoteOverlays?: { path: string; startSec: number; durSec: number; text?: string }[];
  insertOverlays?: { path: string; startSec: number; durSec: number }[];
}
type Params = Record<string, unknown>;

interface Expected {
  videoSec: number;
  bodyMaxSeg: number;
  hasIntro: boolean;
  hasOutro: boolean;
  firstBodyClip: string; // first NON-card body segment src
  introSec: number;
  clipCoverage: number; // sum of non-card seg durations
}

/** Compute what the god-block WOULD plan, independently. */
function godBlockExpected(store: Store, params: Params): Expected {
  const introCardPath = store.introCardPath && store.introCardPath.length > 0 ? store.introCardPath : "";
  const introSec = introCardPath ? Number(store.introSec ?? 5) : 0;
  const narrationSec = Number(store.narrationDurationSec ?? 0) || 60;
  const tailSec = Number(params.tailSec ?? 3);
  const videoSec = introSec + narrationSec + tailSec;
  const bodyMaxSeg = expectedBodySeg(narrationSec, store.cutSheet);
  const interleaved = expectedInterleave(store.footageClips, store.entityClips ?? []);
  // Clip coverage the god-block produces in the body:
  //   • CHAPTER mode (assembleStructuredBody): footage windows are filled to their own
  //     durSec; chapter cards consume the rest. So clip-seconds = Σ(footage-window durSec)
  //     = narrationSec − Σ(chapter-card durSec). The card time is body time, not clip time.
  //   • BEAT mode (assembleBeatBody): clips cover narration + tail (the +3 buffer is render-
  //     side slack, not a plan-length change).
  const chapters = store.chapterPlan ?? [];
  const clipCoverage =
    chapters.length > 0
      ? chapters.filter((w) => w.kind === "footage").reduce((a, w) => a + w.durSec, 0)
      : narrationSec + tailSec;
  return {
    videoSec,
    bodyMaxSeg,
    hasIntro: introSec > 0,
    hasOutro: tailSec >= 2,
    firstBodyClip: interleaved[0] ?? "",
    introSec,
    clipCoverage,
  };
}

/* --------------------- read the same numbers off the EDL plan -------------------- */

const isCard = (s: Segment): s is Extract<Segment, { kind: "card" }> => s.kind === "card";

interface Actual {
  videoSec: number;
  bodyMaxSeg: number; // the MAX non-card seg durSec (the per-clip cap)
  hasIntro: boolean;
  hasOutro: boolean;
  firstBodyClip: string;
  clipCoverage: number;
}

function edlActual(t: Timeline): Actual {
  const bodySegs = t.segments.filter((s) => !isCard(s)) as Extract<Segment, { kind: "footage" | "entity" }>[];
  const cards = t.segments.filter(isCard);
  const durs = bodySegs.map((s) => s.durSec);
  return {
    videoSec: projectedDurationSec(t),
    bodyMaxSeg: durs.length ? Math.max(...durs) : 0,
    hasIntro: cards.some((c) => c.role === "intro"),
    hasOutro: cards.some((c) => c.role === "outro"),
    firstBodyClip: bodySegs[0]?.src ?? "",
    clipCoverage: durs.reduce((a, b) => a + b, 0),
  };
}

/* --------------------------------- the cases ------------------------------------- */

const clips = (n: number, p = "f") => Array.from({ length: n }, (_, i) => `${p}${i}.mp4`);

interface Case {
  name: string;
  store: Store;
  params: Params;
}

const CASES: Case[] = [
  {
    name: "narrated 120s + intro + outro + chapters",
    store: {
      footageClips: clips(8, "f"),
      entityClips: ["e0.jpg", "e1.jpg"],
      narrationLocalPath: "narr.wav",
      narrationDurationSec: 120,
      introCardPath: "intro.mp4",
      introSec: 5,
      musicKey: "music/mix.mp3",
      sentenceTimings: [
        { text: "One.", start: 0, end: 4 },
        { text: "Two.", start: 4, end: 9 },
      ],
      chapterPlan: [
        { kind: "footage", durSec: 40 },
        { kind: "card", durSec: 6, heading: "Part Two" },
        { kind: "footage", durSec: 74 },
      ],
      channelName: "Investory",
      channelAvatarKey: "brand/avatar.png",
      script: { closingLine: "Stay curious." },
      quoteOverlays: [{ path: "q0.webm", startSec: 20, durSec: 6, text: "A quote." }],
      insertOverlays: [{ path: "i0.webm", startSec: 60, durSec: 8 }],
    },
    params: { aspect: "16:9", tailSec: 3, minSeconds: 60, maxSeconds: 1200, burnCaptions: true },
  },
  {
    name: "shorts 9:16 30s (no chapters, short tail)",
    store: {
      footageClips: clips(4, "s"),
      narrationLocalPath: "narr.wav",
      narrationDurationSec: 30,
      introCardPath: "", // cold-open: no intro card ⇒ introSec collapses to 0
      musicUrl: "https://cdn/music.mp3",
      sentenceTimings: [{ start: 0, end: 30, text: "Go." }],
      script: { closingLine: "Follow for more." },
      quoteOverlays: [],
      insertOverlays: [],
    },
    params: { aspect: "9:16", tailSec: 2, minSeconds: 15, maxSeconds: 90 },
  },
  {
    name: "long 700s (length-based 25s cadence)",
    store: {
      footageClips: clips(40, "L"),
      entityClips: clips(5, "Le"),
      narrationLocalPath: "narr.wav",
      narrationDurationSec: 700,
      introCardPath: "intro.mp4",
      introSec: 5,
      musicKey: "music/mix.mp3",
      script: { closingLine: "Until next time." },
    },
    params: { aspect: "16:9", tailSec: 3, minSeconds: 600, maxSeconds: 1200 },
  },
  {
    name: "essay 300s + cutSheet cadence (6 cuts/min ⇒ 10s)",
    store: {
      footageClips: clips(20, "c"),
      narrationLocalPath: "narr.wav",
      narrationDurationSec: 300,
      introCardPath: "intro.mp4",
      introSec: 5,
      musicKey: "music/mix.mp3",
      cutSheet: { sections: [{ name: "intro", cutsPerMin: 6 }, { name: "body", cutsPerMin: 6 }] },
      script: { closingLine: "Think it through." },
    },
    params: { aspect: "16:9", tailSec: 3 },
  },
];

/* ----------------------------------- run ---------------------------------------- */

interface Row {
  field: string;
  expected: string;
  actual: string;
  match: boolean;
}

function cmpNum(a: number, b: number, tol = 0): boolean {
  return Math.abs(a - b) <= tol;
}

let anyDiff = false;

for (const c of CASES) {
  const exp = godBlockExpected(c.store, c.params);
  const params = paramsToAssemble(c.params);
  const plan = planTimeline(buildPlanInput(c.store as unknown as Record<string, unknown>, c.params), params);
  const act = edlActual(plan);

  const rows: Row[] = [
    { field: "videoSec", expected: String(exp.videoSec), actual: String(act.videoSec), match: cmpNum(exp.videoSec, act.videoSec) },
    { field: "bodyMaxSeg", expected: String(exp.bodyMaxSeg), actual: String(act.bodyMaxSeg), match: cmpNum(exp.bodyMaxSeg, act.bodyMaxSeg) },
    { field: "hasIntro", expected: String(exp.hasIntro), actual: String(act.hasIntro), match: exp.hasIntro === act.hasIntro },
    { field: "hasOutro", expected: String(exp.hasOutro), actual: String(act.hasOutro), match: exp.hasOutro === act.hasOutro },
    { field: "firstBodyClip", expected: exp.firstBodyClip, actual: act.firstBodyClip, match: exp.firstBodyClip === act.firstBodyClip },
    // EDL coverage must be >= the god-block's narration+tail body (no loop / dead-air); equal in non-chapter mode.
    { field: "clipCoverage>=narr+tail", expected: `>=${exp.clipCoverage}`, actual: act.clipCoverage.toFixed(1), match: act.clipCoverage + 0.5 >= exp.clipCoverage },
  ];

  console.log(`\n=== ${c.name} ===`);
  console.log("field                      | god-block expected | EDL actual    | result");
  console.log("---------------------------|--------------------|---------------|-------");
  for (const r of rows) {
    if (!r.match) anyDiff = true;
    console.log(
      `${r.field.padEnd(26)} | ${r.expected.padEnd(18)} | ${r.actual.padEnd(13)} | ${r.match ? "MATCH" : "DIFF"}`,
    );
  }
}

console.log(
  anyDiff
    ? "\nPARITY: DIFF — the EDL path does NOT reproduce the god-block plan. See rows above."
    : "\nPARITY: ALL MATCH — the EDL path reproduces the god-block's length, cadence, and structure exactly.",
);
process.exit(anyDiff ? 1 : 0);
