/**
 * Calibration harness for story_spine PACING.
 *
 * story_spine is fully deterministic and hard-gated: validateStorySpine throws
 * unless beats and shots tile the narration with zero gaps and coverage is
 * 1.0. Every existing check therefore passes by construction, and the block
 * logs "coverage 100%" truthfully. None of that says whether the plan is any
 * GOOD — a spine can tile the timeline perfectly and still attach the wrong
 * story purpose to every second of it.
 *
 * That is the gap this measures. The Director agent returns beats carrying
 * `intentSec` — "this beat should occupy N seconds on screen" — which is the
 * channel's pacing intent, produced by a real model call the run pays for. The
 * cinematic program route requires director_brief BEFORE story_spine
 * (channelProgramRoute.ts requiredBlockOrder), so that intent is present in
 * the store when the spine is planned.
 *
 * story_spine never reads it. `intentSec` appears once in storySpine.ts, in the
 * PlanStorySpineInput type, and is referenced nowhere in the body. Structure
 * beats are instead mapped onto sentences by COUNT:
 *
 *     structureBeats[floor(index * structureBeats.length / intervals.length)]
 *
 * so a beat the Director wanted to last 8 seconds and one it wanted to last 60
 * receive the same share of sentences. The `purpose` string that lands on each
 * narrative beat flows into planCinematicShotLanguage and from there into the
 * DP visual specs and the render prompts, so a misplaced purpose is not
 * cosmetic: it tells the renderer to draw the payoff while the narration is
 * still in the setup.
 *
 * WHAT IS REAL HERE, PRECISELY:
 *   REAL  planStorySpine — the shipping planner, executed, not reimplemented.
 *   REAL  briefDirector — the shipping crew agent on its pinned route, run
 *         against Show Bibles built from the real family definitions in
 *         engine/families.ts, with the cinematic route's own targetShotSec: 6.
 *   NOT   the sentence timings. A narration_tts run bills a provider for audio
 *         whose only property this needs is the duration distribution, so
 *         timings are synthesised at a measured speaking rate. Because a result
 *         that held for only one distribution would be an artifact, every
 *         director brief is measured against BOTH an even distribution and a
 *         realistically variable one (short punchy lines mixed with long ones).
 *
 * THE ORACLE, and why it cannot be argued with: both sides are computed from
 * the same real inputs by arithmetic, with no model in the loop.
 *
 *   intended  beat i owns [Σ_{j<i} intentSec_j, Σ_{j<=i} intentSec_j], scaled
 *             to the true narration duration.
 *   actual    beat i owns the union of sentence intervals whose index the
 *             shipping mapping sends to i.
 *   misplaced the seconds of timeline whose assigned purpose is not the
 *             intended one, as a fraction of the video.
 *
 * A perfect planner scores 0. The count-mapping's score is whatever it is; the
 * point of running it on real Director output is that nobody has to guess.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/story-spine-pacing-harness.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { briefDirector } from "@/engine/creative/crew";
import type { ShowBible } from "@/engine/creative/types";
import { planStorySpine } from "@/engine/storySpine";

const CACHE = "/tmp/story-spine-director-briefs.json";
/** The cinematic program route's own value (channelProgramRoute / archetypes). */
const TARGET_SHOT_SEC = 6;

interface Case {
  readonly key: string;
  readonly topic: string;
  readonly targetSeconds: number;
  readonly bible: ShowBible;
}

/**
 * Show Bibles mirroring the real families in engine/families.ts. The Director
 * is the thing under measurement, so what matters is that it receives a
 * plausible, DIFFERENT doctrine per case — a single bible reused four times
 * would measure one beat distribution and call it four.
 */
const CASES: readonly Case[] = [
  {
    key: "lorecraft-watercolor",
    topic: "The drowned bell of Dunwich",
    targetSeconds: 420,
    bible: {
      positioning: "Slow, illustrated folklore from the edges of the map, told as if read aloud from a keepsake book.",
      vibe: "Hushed, unhurried, faintly melancholy. Wonder over dread.",
      iconicMotif: "Hand-painted watercolour plates with visible paper grain and bleeding edges.",
      worksInSpace: ["a single sustained image held long enough to study", "narration that trusts silence"],
      avoidInSpace: ["photoreal render", "hard cuts on the beat", "horror stingers"],
      activeCrew: [],
      directorDoctrine: "Open on stillness. Earn every escalation. The reveal is a whisper, never a jolt.",
      refreshedAt: 0,
    },
  },
  {
    key: "casefile-cinematic",
    topic: "The 1971 skyjacking that was never solved",
    targetSeconds: 600,
    bible: {
      positioning: "Evidence-led reconstructions of real unresolved cases, sourced and dated on screen.",
      vibe: "Cold, procedural, controlled. The facts carry the tension.",
      iconicMotif: "Desaturated reconstruction intercut with documentary evidence cards.",
      worksInSpace: ["a timeline the viewer can follow without a map", "naming what is not known"],
      avoidInSpace: ["speculation presented as fact", "true-crime melodrama", "gore"],
      activeCrew: [],
      directorDoctrine: "Front-load the unresolved question. Withhold the strongest evidence for the final third.",
      refreshedAt: 0,
    },
  },
  {
    key: "illustrated-explainer",
    topic: "Why bridges are built to sway",
    targetSeconds: 300,
    bible: {
      positioning: "One counter-intuitive engineering idea per episode, drawn as it is explained.",
      vibe: "Bright, brisk, genuinely curious. Never smug.",
      iconicMotif: "Clean vector diagrams that assemble themselves under the narration.",
      worksInSpace: ["one idea per video", "a diagram that answers the question before the sentence ends"],
      avoidInSpace: ["stock footage of cities", "jargon without a picture"],
      activeCrew: [],
      directorDoctrine: "State the paradox in the first ten seconds. Resolve it once, completely, at the end.",
      refreshedAt: 0,
    },
  },
  {
    key: "narrated-stoic",
    topic: "Marcus Aurelius on the people who will annoy you today",
    targetSeconds: 480,
    bible: {
      positioning: "Ancient practical philosophy applied to an ordinary modern day.",
      vibe: "Steady, grounded, adult. A voice that is not selling anything.",
      iconicMotif: "Long dissolves over weathered stone and low winter light.",
      worksInSpace: ["a single passage read slowly", "application before interpretation"],
      avoidInSpace: ["hustle framing", "motivational music swells", "listicles"],
      activeCrew: [],
      directorDoctrine: "Begin inside the reader's actual morning. The philosophy arrives as relief, not instruction.",
      refreshedAt: 0,
    },
  },
];

interface Brief { key: string; hook: string; beats: { name: string; intentSec: number; note: string }[] }

async function directorBriefs(): Promise<Brief[]> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8")) as Brief[];
  const out: Brief[] = [];
  for (const c of CASES) {
    const brief = await briefDirector(c.bible, {
      topic: c.topic,
      family: c.key,
      channelName: c.key,
      targetSeconds: c.targetSeconds,
      log: (m) => console.log(`    [director] ${m}`),
    });
    if (!brief) {
      console.log(`  ${c.key}: DIRECTOR RETURNED NOTHING — excluded from the measurement`);
      continue;
    }
    out.push({ key: c.key, hook: brief.hook, beats: brief.beats });
  }
  writeFileSync(CACHE, JSON.stringify(out, null, 2));
  return out;
}

/** Words per second used to turn sentence text into timings. */
const WPS = 2.6;

/**
 * Sentence timings for a video of `durationSec`.
 *
 * `even` gives every sentence the same length; `varied` mixes short and long
 * lines the way real narration does. Measuring both is what stops the headline
 * number from being a property of the synthesis rather than of the planner.
 */
function timings(durationSec: number, count: number, shape: "even" | "varied"): Array<{ text: string; start: number; end: number }> {
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    weights.push(shape === "even" ? 1 : [0.45, 1.6, 0.8, 1.15, 2.0, 0.6][i % 6]);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const len = (weights[i]! / total) * durationSec;
    const end = i === count - 1 ? durationSec : cursor + len;
    out.push({
      text: `Sentence ${i + 1} carrying roughly ${Math.max(1, Math.round(len * WPS))} words of narration.`,
      start: cursor,
      end,
    });
    cursor = end;
  }
  return out;
}

/** The intended [t0,t1) of each director beat, scaled to the real duration. */
function intendedWindows(beats: { intentSec: number }[], durationSec: number): Array<{ t0: number; t1: number }> {
  const total = beats.reduce((a, b) => a + Math.max(1, b.intentSec), 0);
  const out: Array<{ t0: number; t1: number }> = [];
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const len = (Math.max(1, beats[i]!.intentSec) / total) * durationSec;
    const t1 = i === beats.length - 1 ? durationSec : cursor + len;
    out.push({ t0: cursor, t1 });
    cursor = t1;
  }
  return out;
}

/** Which director beat the timeline at time t was INTENDED to be in. */
function intendedIndexAt(windows: Array<{ t0: number; t1: number }>, t: number): number {
  for (let i = 0; i < windows.length; i++) if (t >= windows[i]!.t0 && t < windows[i]!.t1) return i;
  return windows.length - 1;
}

interface Measurement {
  key: string;
  shape: string;
  beats: number;
  sentences: number;
  durationSec: number;
  shots: number;
  misplacedSec: number;
  misplacedRatio: number;
  /** The most a CORRECT time mapping could misplace, given atomic sentences. */
  boundaryBudgetRatio: number;
  worstBeat: string;
}

/**
 * Run the SHIPPING planner and compare the purpose it assigned at each moment
 * with the purpose the Director intended for that moment.
 */
function measure(brief: Brief, durationSec: number, sentenceCount: number, shape: "even" | "varied"): Measurement {
  const sentenceTimings = timings(durationSec, sentenceCount, shape);
  const spine = planStorySpine({
    topic: brief.key,
    narrationDurationSec: durationSec,
    sentenceTimings,
    structure: { beats: brief.beats },
    targetShotSec: TARGET_SHOT_SEC,
  });
  const windows = intendedWindows(brief.beats, durationSec);
  // purpose text -> the director beat index it came from. Names can repeat, so
  // resolve by the exact string the planner would have produced for that beat.
  const purposeOf = (i: number): string => brief.beats[i]!.note || brief.beats[i]!.name || "advance the narrated argument";

  let misplaced = 0;
  const perBeatMisplaced = new Map<string, number>();
  for (const beat of spine.narrativeBeats) {
    const mid = (beat.t0 + beat.t1) / 2;
    const intended = purposeOf(intendedIndexAt(windows, mid));
    if (beat.purpose !== intended) {
      const secs = beat.t1 - beat.t0;
      misplaced += secs;
      perBeatMisplaced.set(beat.purpose, (perBeatMisplaced.get(beat.purpose) ?? 0) + secs);
    }
  }
  const worst = [...perBeatMisplaced.entries()].sort((a, b) => b[1] - a[1])[0];
  // Each of the (beats-1) interior boundaries can land inside one sentence, and
  // that whole sentence is then charged to the wrong side. Nothing a correct
  // time mapping does can beat that, so it is the honest yardstick.
  const longestSentence = Math.max(...sentenceTimings.map((s) => s.end - s.start));
  return {
    key: brief.key,
    shape,
    beats: brief.beats.length,
    sentences: sentenceCount,
    durationSec,
    shots: spine.shotList.length,
    misplacedSec: Number(misplaced.toFixed(1)),
    misplacedRatio: Number((misplaced / durationSec).toFixed(4)),
    boundaryBudgetRatio: Number(
      (Math.min(durationSec, Math.max(0, brief.beats.length - 1) * longestSentence) / durationSec).toFixed(4),
    ),
    worstBeat: worst ? `${worst[1].toFixed(0)}s wrongly labelled "${worst[0].slice(0, 52)}"` : "none",
  };
}

async function main(): Promise<void> {
  console.log("=== story_spine pacing calibration ===\n");
  const briefs = await directorBriefs();
  if (!briefs.length) {
    console.log("no director briefs — cannot measure. (Is OPENROUTER_API_KEY injected?)");
    return;
  }

  const rows: Measurement[] = [];
  for (const brief of briefs) {
    const declared = brief.beats.reduce((a, b) => a + Math.max(1, b.intentSec), 0);
    console.log(
      `${brief.key}: ${brief.beats.length} beats, declared ${declared}s ` +
        `(${brief.beats.map((b) => `${b.intentSec}s`).join(" ")})`,
    );
    // Sentence counts spanning a realistic script: ~2.6 wps over the declared
    // length gives roughly one sentence per 4-8s of narration.
    for (const perSentenceSec of [4, 6, 8]) {
      const count = Math.max(brief.beats.length, Math.round(declared / perSentenceSec));
      for (const shape of ["even", "varied"] as const) {
        rows.push(measure(brief, declared, count, shape));
      }
    }
  }

  console.log("\n  beats  sents  shots   misplaced   channel / shape");
  for (const r of rows) {
    console.log(
      `  ${String(r.beats).padStart(5)}  ${String(r.sentences).padStart(5)}  ${String(r.shots).padStart(5)}   ` +
        `${(r.misplacedRatio * 100).toFixed(1).padStart(5)}%     ${r.key} / ${r.shape}`,
    );
  }
  const avg = rows.reduce((a, r) => a + r.misplacedRatio, 0) / rows.length;
  const worst = [...rows].sort((a, b) => b.misplacedRatio - a.misplacedRatio)[0]!;
  console.log(`\n  mean misplaced: ${(avg * 100).toFixed(1)}%   worst: ${(worst.misplacedRatio * 100).toFixed(1)}% (${worst.key}/${worst.shape})`);
  console.log(`  worst single beat: ${worst.worstBeat}`);

  // The floor is NOT zero, and an earlier version of this file claimed it was —
  // its own output falsified it on the first run after the fix (8.1% on an
  // "even" case). A sentence is atomic: when a beat boundary falls inside one,
  // that whole sentence goes to one side. So the reachable floor is bounded by
  // the boundaries times the sentence length, and THAT is the number worth
  // asserting, because a regression in the mapping would blow past it while a
  // coarse script would not.
  let breaches = 0;
  for (const r of rows) {
    if (r.misplacedRatio > r.boundaryBudgetRatio + 1e-9) {
      breaches++;
      console.log(
        `  BUDGET BREACH ${r.key}/${r.shape}: misplaced ${(r.misplacedRatio * 100).toFixed(1)}% ` +
          `exceeds the ${(r.boundaryBudgetRatio * 100).toFixed(1)}% that sentence atomicity alone can explain`,
      );
    }
  }
  console.log(
    `\n  sentence-atomicity budget: ${breaches === 0 ? "every case inside it" : `${breaches} case(s) OUTSIDE it`}\n` +
      `  (budget = (beats-1) x longest sentence / duration — the most a correct\n` +
      `   time mapping can misplace when a boundary lands mid-sentence)`,
  );
  writeFileSync("/tmp/story-spine-pacing.json", JSON.stringify(rows, null, 2));
  if (breaches) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
