/**
 * sim_narrative — ONE job: AUTHOR a dramatized "simulation run" as a story.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * It is NOT a genetic algorithm, NOT an agent loop, and NOT a per-tick model
 * call. A real evolutionary simulation (or an AI-town style per-agent loop)
 * costs compute and model calls proportional to generations × population, for
 * an output the audience cannot verify anyway. That was explicitly rejected.
 *
 * WHAT IT ACTUALLY DOES
 * ONE bounded LLM call writes a complete, structured narrative arc: a handful
 * of named story beats at chosen generation numbers, plus a fitness/population
 * curve whose shape is keyed to those beats — so the graph spikes exactly when
 * the narration says something dramatic happened. The curve is INTERPOLATED
 * DETERMINISTICALLY from the beats by this file (`curveFromBeats`), not asked
 * for point-by-point, which keeps the call small and the motion coherent.
 *
 * THE HARD HONESTY REQUIREMENT
 * This must never read as a real experiment, so the honesty is structural
 * rather than editorial:
 *   1. the emitted ChartSpec is `speculative: true`, which makes
 *      `chartSpecDefects` REFUSE any row that carries a citation and REQUIRE a
 *      verbatim on-screen disclosure — the renderer burns it into every frame;
 *   2. the authored script is FORCED to open on `SPECULATIVE_OPENER` and close
 *      on `SPECULATIVE_CLOSER`, prepended/appended here in code rather than
 *      requested in the prompt, so a model that ignores the instruction cannot
 *      remove them;
 *   3. `simNarrativeDefects` rejects any narration that asserts the run was
 *      real ("we ran", "our experiment", "the data shows", "actual results"),
 *      and the block throws rather than shipping it.
 *
 * IT ADDS NO RENDERER. The finished video is produced by `chart_render` from
 * rankChartBlocks.ts — the exact same module the real-data ranking family uses.
 */
import type { Block } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { PRICE } from "@/engine/pricing";
import {
  assertChartSpecIntegrity,
  chartNarrationBrief,
  CHART_DEFAULT_OUTRO_SECONDS,
  CHART_DEFAULT_SECONDS_PER_ROW,
  CHART_SPEC_VERSION,
  SPECULATIVE_DISCLOSURE,
  type ChartBeat,
  type ChartSpec,
} from "@/lib/chartSpec";

/**
 * The first and last thing the viewer hears. Prepended/appended in CODE — a
 * model cannot drop them, and a test asserts they survive into `narrationText`.
 */
export const SPECULATIVE_OPENER =
  "Imagine a simulation. None of what follows was actually run — it is a thought experiment, " +
  "and every number you are about to see was invented to tell the story.";

export const SPECULATIVE_CLOSER =
  "To be clear one last time: that was an imagined run, not an experiment. " +
  "If you want the real thing, the papers are in the description.";

/** Phrases that would turn an illustration into a false claim of measurement. */
export const REALITY_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bwe (?:ran|trained|measured|observed|tested)\b/i,
  /\bour (?:experiment|simulation|run|data|results|study)\b/i,
  /\bthe data (?:shows?|showed|proves?)\b/i,
  /\bactual results?\b/i,
  /\breal[- ]world (?:results?|measurements?)\b/i,
  /\bin (?:this|the) (?:actual|real) (?:run|experiment)\b/i,
  /\bstudies? (?:show|found|confirm)\b/i,
];

export const SIM_MIN_BEATS = 3;
export const SIM_MAX_BEATS = 8;
export const SIM_CURVE_STEPS = 60;

export interface SimBeat {
  /** Generation / tick number the beat happens at. */
  generation: number;
  /** Short on-screen caption. */
  caption: string;
  /** Spoken narration for this beat. */
  narration: string;
  /**
   * Where the curve goes at this beat, 0..1 of the axis. A dip is a dip.
   * Named `level` rather than "fitness" because the same shape drives
   * population, survival rate, score — whatever the episode is about.
   */
  level: number;
}

export interface SimNarrative {
  title: string;
  /** What is being (imaginarily) simulated, e.g. "creatures learning to walk". */
  premise: string;
  /** The measured-looking axis label, e.g. "Average fitness". */
  seriesLabel: string;
  /** The step axis label, e.g. "Generation". */
  stepLabel: string;
  beats: SimBeat[];
}

/** Clamp + sanity-bound whatever the model returned. Never throws. */
export function normalizeSimNarrative(raw: unknown, fallbackTopic: string): SimNarrative {
  const object = (raw ?? {}) as Record<string, unknown>;
  const rawBeats = Array.isArray(object["beats"]) ? object["beats"] : [];
  const beats: SimBeat[] = rawBeats
    .flatMap((entry) => {
      const beat = (entry ?? {}) as Record<string, unknown>;
      const generation = Math.round(Number(beat["generation"]));
      const caption = String(beat["caption"] ?? "").trim();
      const narration = String(beat["narration"] ?? "").trim();
      const level = Number(beat["level"]);
      if (!Number.isFinite(generation) || generation < 0) return [];
      if (caption.length === 0 || narration.length === 0) return [];
      return [
        {
          generation,
          caption: caption.slice(0, 90),
          narration: narration.slice(0, 900),
          level: Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0.5)),
        },
      ];
    })
    .sort((a, b) => a.generation - b.generation)
    .slice(0, SIM_MAX_BEATS);

  return {
    title: String(object["title"] ?? "").trim() || fallbackTopic,
    premise: String(object["premise"] ?? "").trim() || fallbackTopic,
    seriesLabel: String(object["seriesLabel"] ?? "").trim() || "Average fitness",
    stepLabel: String(object["stepLabel"] ?? "").trim() || "Generation",
    beats,
  };
}

/**
 * Build the curve the graph will draw. DETERMINISTIC: the model supplies only
 * anchor levels at its beat generations; every intermediate point is smoothly
 * interpolated here. That is why the graph moves exactly when the narration
 * does — the beats ARE the keyframes, not a separate invented series.
 */
export function curveFromBeats(beats: readonly SimBeat[], steps = SIM_CURVE_STEPS): { step: number; value: number }[] {
  if (beats.length === 0) return [];
  const first = beats[0].generation;
  const last = beats[beats.length - 1].generation;
  const span = Math.max(1, last - first);
  const out: { step: number; value: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const generation = first + (span * i) / (steps - 1);
    let before = beats[0];
    let after = beats[beats.length - 1];
    for (let b = 0; b < beats.length - 1; b++) {
      if (generation >= beats[b].generation && generation <= beats[b + 1].generation) {
        before = beats[b];
        after = beats[b + 1];
        break;
      }
    }
    const width = Math.max(1e-6, after.generation - before.generation);
    const t = Math.max(0, Math.min(1, (generation - before.generation) / width));
    // Smoothstep — a curve, not a polyline, so a "sudden leap" still reads as
    // an organic move rather than a chart glitch.
    const eased = t * t * (3 - 2 * t);
    const level = before.level + (after.level - before.level) * eased;
    out.push({ step: Math.round(generation), value: Math.round(level * 1000) / 10 });
  }
  return out;
}

/** Content-honesty gate over the finished narration. */
export function simNarrativeDefects(narrationText: string, narrative: SimNarrative): string[] {
  const defects: string[] = [];
  if (!narrationText.startsWith(SPECULATIVE_OPENER)) {
    defects.push("narration does not open on the mandatory speculative disclosure");
  }
  if (!narrationText.trimEnd().endsWith(SPECULATIVE_CLOSER)) {
    defects.push("narration does not close on the mandatory speculative disclosure");
  }
  for (const pattern of REALITY_CLAIM_PATTERNS) {
    // The opener/closer legitimately talk ABOUT running things ("none of what
    // follows was actually run"), so only the authored body is scanned.
    const body = narrationText
      .replace(SPECULATIVE_OPENER, "")
      .replace(SPECULATIVE_CLOSER, "");
    if (pattern.test(body)) {
      defects.push(`narration claims the run was real: ${pattern.source}`);
    }
  }
  if (narrative.beats.length < SIM_MIN_BEATS) {
    defects.push(`only ${narrative.beats.length} beats (need >= ${SIM_MIN_BEATS})`);
  }
  const generations = narrative.beats.map((b) => b.generation);
  if (new Set(generations).size !== generations.length) {
    defects.push("two beats share a generation number");
  }
  return defects;
}

/** Offline/no-key fallback so the block is exercisable without a provider. */
export function deterministicSimNarrative(topic: string): SimNarrative {
  return {
    title: topic,
    premise: topic,
    seriesLabel: "Average fitness",
    stepLabel: "Generation",
    beats: [
      { generation: 1, level: 0.05, caption: "random scatter", narration: "Generation one is pure noise. Nothing in the population is trying to do anything; the shapes twitch and fall over." },
      { generation: 40, level: 0.22, caption: "the first accident", narration: "By generation forty, one lineage stumbles into something that looks almost deliberate, and the average creeps upward." },
      { generation: 180, level: 0.55, caption: "the strategy spreads", narration: "Around generation one hundred and eighty the trick has spread through the whole population, and the curve climbs hard." },
      { generation: 240, level: 0.34, caption: "the wall arrives", narration: "Then the environment changes, the old trick stops working, and the line falls off a cliff." },
      { generation: 340, level: 0.78, caption: "a mutant learns to dodge", narration: "At generation three hundred and forty a single mutant learns to go around the barrier instead of through it, and everything recovers above where it started." },
      { generation: 500, level: 0.9, caption: "the plateau", narration: "By generation five hundred the population has settled into a plateau: efficient, boring, and very hard to improve on." },
    ],
  };
}

const RESPONSE_SHAPE =
  '{"title":"...","premise":"...","seriesLabel":"...","stepLabel":"Generation",' +
  '"beats":[{"generation":<int>,"level":<0..1>,"caption":"<=8 words on-screen>","narration":"2-4 spoken sentences"}]}';

export function simNarrativePrompt(args: { topic: string; beats: number; persona?: string }): string {
  return [
    `Write a DRAMATIZED, IMAGINARY simulation run about: ${args.topic}.`,
    "",
    "THIS IS EXPLICITLY A THOUGHT EXPERIMENT. You are inventing a story that is SHAPED like a",
    "simulation log, not reporting one. Never claim the run happened, never cite a paper, a dataset",
    "or a lab, and never use the words \"we ran\", \"our results\", \"the data shows\" or \"studies show\".",
    "Write in the present tense of an imagined observer watching a graph move.",
    "",
    `Produce EXACTLY ${args.beats} beats in ascending generation order. Beats are the STORY, and the`,
    "graph is keyed to them: `level` is where the curve sits at that moment on a 0..1 axis, so a",
    "setback MUST be a lower level than the beat before it. Give the arc real shape — an early",
    "plateau, a breakthrough, a collapse when conditions change, and a recovery that goes somewhere",
    "the earlier population could not.",
    "",
    args.persona ? `Narrate in this channel's voice: ${args.persona}` : "",
    "",
    `Output STRICT JSON only: ${RESPONSE_SHAPE}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSimChartSpec(args: {
  narrative: SimNarrative;
  secondsPerRow: number;
  outroSeconds: number;
}): ChartSpec {
  const series = curveFromBeats(args.narrative.beats);
  const beats: ChartBeat[] = args.narrative.beats.map((beat) => ({
    step: beat.generation,
    caption: beat.caption,
  }));
  return {
    version: CHART_SPEC_VERSION,
    mode: "line_series",
    title: args.narrative.title,
    subtitle: args.narrative.premise,
    unit: "%",
    stepLabel: args.narrative.stepLabel,
    rows: [
      {
        id: "sim-primary",
        label: args.narrative.seriesLabel,
        value: series.length ? series[series.length - 1].value : 0,
        series,
        // The ONLY provenance a speculative chart may carry. `chartSpecDefects`
        // rejects a citation on any of these rows.
        provenance: "speculative-illustrative",
      },
    ],
    beats,
    speculative: true,
    disclosure: SPECULATIVE_DISCLOSURE,
    secondsPerRow: args.secondsPerRow,
    outroSeconds: args.outroSeconds,
  };
}

export const simNarrative: Block = {
  id: "sim_narrative",
  consumes: ["topic"],
  produces: ["chartSpec", "chartBrief", "script", "narrationText"],
  paid: true,
  run: async (ctx) => {
    const topic = String(ctx.store["topic"] ?? "").trim();
    if (!topic) throw new Error("sim_narrative: no topic in the store");
    const beatCount = Math.max(
      SIM_MIN_BEATS,
      Math.min(SIM_MAX_BEATS, Math.round(Number(ctx.params["beats"] ?? 6))),
    );
    const secondsPerRow = Math.max(
      2,
      Math.min(20, Number(ctx.params["secondsPerRow"] ?? CHART_DEFAULT_SECONDS_PER_ROW)),
    );
    const outroSeconds = Math.max(
      0,
      Math.min(20, Number(ctx.params["outroSeconds"] ?? CHART_DEFAULT_OUTRO_SECONDS)),
    );
    const persona = typeof ctx.store["persona"] === "string" ? (ctx.store["persona"] as string) : undefined;

    // EXACTLY ONE model call. This is the whole "simulation".
    let modelCalls = 0;
    let narrative = deterministicSimNarrative(topic);
    if (hasGeminiKey()) {
      try {
        const raw = await geminiJson<unknown>({
          prompt: simNarrativePrompt({ topic, beats: beatCount, persona }),
          maxTokens: 2_200,
          temperature: 0.85,
        });
        modelCalls += 1;
        const parsed = normalizeSimNarrative(raw, topic);
        if (parsed.beats.length >= SIM_MIN_BEATS) narrative = parsed;
        else ctx.log(`sim_narrative: model returned ${parsed.beats.length} usable beats — using the deterministic arc`);
      } catch (e) {
        ctx.log(`sim_narrative: authoring call failed (${e instanceof Error ? e.message : e}) — using the deterministic arc`);
      }
    } else {
      ctx.log("sim_narrative: no GEMINI_API_KEY — using the deterministic arc");
    }

    // DISCLOSURE IS APPLIED IN CODE, NOT REQUESTED IN THE PROMPT. A model that
    // ignores the instruction cannot strip it, and `simNarrativeDefects` proves
    // it survived before anything downstream speaks a word of this.
    const body = narrative.beats.map((beat) => beat.narration).join("\n\n");
    const narrationText = [SPECULATIVE_OPENER, body, SPECULATIVE_CLOSER].join("\n\n");

    const defects = simNarrativeDefects(narrationText, narrative);
    if (defects.length) {
      throw new Error(`sim_narrative: honesty gate failed: ${defects.join("; ")}`);
    }

    const spec = buildSimChartSpec({ narrative, secondsPerRow, outroSeconds });
    assertChartSpecIntegrity(spec);

    const script = {
      title: narrative.title,
      sections: [
        { heading: "Disclosure", narration: SPECULATIVE_OPENER },
        ...narrative.beats.map((beat) => ({
          heading: `${narrative.stepLabel} ${beat.generation}`,
          narration: beat.narration,
        })),
        { heading: "Disclosure", narration: SPECULATIVE_CLOSER },
      ],
      narrationText,
    };

    const costUsd = modelCalls * PRICE.boundedTextPassUsd;
    ctx.log(
      `sim_narrative ✓ ${narrative.beats.length} beats, ${spec.rows[0].series?.length ?? 0} curve points, ` +
        `${modelCalls} text call(s), $${costUsd.toFixed(4)} — declared ILLUSTRATIVE`,
    );

    return {
      chartSpec: spec,
      chartBrief: chartNarrationBrief(spec),
      script,
      narrationText,
      [COST_PATCH_KEY]: costUsd,
    };
  },
};

export const simNarrativeBlocks: Block[] = [simNarrative];
