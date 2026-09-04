/**
 * visual_inserts — script-synced MOTION-GRAPHICS inserts (the per-channel
 * "data layer"). An Insert Director reads the narration sentences that contain
 * numbers and plans branded Remotion inserts (animated stat counters, draw-on
 * line charts, bar comparisons) timed to the exact sentence in which the
 * number is SPOKEN. ffmpeg composites them like quote cards.
 *
 * INTEGRITY RULE (the channel's trust promise): an insert may only visualize
 * numbers the narration actually speaks — every planned anchor value is
 * deterministically checked against the sentence text and violators are
 * dropped. The model styles the data; it never invents it.
 *
 * Which insert KINDS a channel uses is a design-time, identity-driven choice
 * (`insertTypes` param — finance gets charts, history gets big numbers, lofi
 * gets none). Empty/missing types → block no-ops.
 */
import type { Block } from "@/engine/types";
import {
  hasNamedSourceAttribution,
  hasSourceAttributedDataStoryParams,
} from "@/engine/dataStory";
import { assertDataStorySourceLedger } from "@/engine/dataStorySourceLedger";
import {
  assertEvidenceVisualManifestCollection,
  evidenceVisualManifestAllowsNumbers,
  evidenceVisualManifestBindsNarration,
  evidenceVisualManifestPrompt,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import { join } from "node:path";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { makeRunTempDir, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { renderDataInsert } from "@/lib/remotionRender";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";

const KINDS = ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"] as const;
type InsertKind = (typeof KINDS)[number];

export interface InsertPlanItem {
  sentenceIdx: number;
  /** Last sentence STILL discussing this data — the insert holds until then. */
  endSentenceIdx?: number;
  kind: InsertKind;
  title?: string;
  value?: string;
  label?: string;
  series?: number[];
  xLabels?: string[];
  bars?: { label: string; value: number; display?: string }[];
  /** annotated_line: labeled markers on the curve (idx into series). */
  events?: { idx: number; label: string }[];
  /** The spoken numbers this insert is built on (validated vs the sentence). */
  anchorValues?: (number | string)[];
  /** Required for factual chart data: selects a reviewed value/source manifest. */
  evidenceVisualId?: string;
}

/**
 * lower_third integrity: the cited source must actually be NAMED in the
 * sentence ("according to the Federal Reserve…") — attribution is a trust
 * device, never an invention. Every substantive word of the citation must
 * appear in the sentence.
 */
function sourceSpoken(citation: string, sentence: string): boolean {
  const s = sentence.toLowerCase();
  const words = citation
    .toLowerCase()
    .replace(/^source:?\s*/i, "")
    .split(/[^a-z0-9&]+/)
    .filter((w) => w.length > 3 && !/^(19|20)\d\d$/.test(w));
  if (words.length === 0) return false;
  return words.every((w) => s.includes(w));
}

/** All digit-groups in a text, normalized (commas/spaces stripped). */
function digitGroups(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/[,\s](?=\d)/g, "").matchAll(/\d+(?:\.\d+)?/g)) {
    out.add(m[0]);
    // also index the integer part so "534,000.50" anchors "534000"
    out.add(m[0].split(".")[0]);
  }
  return out;
}

/**
 * A plotted curve may not leave the range of the numbers actually spoken.
 *
 * anchorsSpoken proves the ANCHORS were said out loud, and the evidence-manifest
 * path checks every rendered numeral — but that path only runs when a reviewed
 * manifest exists. On the ordinary route nothing looked at `series` at all, so a
 * curve interpolated between two spoken anchors could peak anywhere: anchors of
 * 100 and 200 with a series topping 900 passed the gate and put a number on
 * screen that no one said, implying a magnitude the narration never claimed.
 *
 * Interpolation between anchors is legitimate — the shape of a decade of growth
 * is not itself a claim. Leaving the anchors' range is, because the highest
 * point of a chart reads as a figure. A small tolerance is allowed for a smooth
 * curve's overshoot at the endpoints; anything beyond that is invention.
 */
const SERIES_OVERSHOOT_TOLERANCE = 0.02;

export function seriesWithinSpokenRange(item: InsertPlanItem): boolean {
  const series = item.series ?? [];
  if (!series.length) return true;
  const anchors = (item.anchorValues ?? [])
    .flatMap((a) => Array.from(String(a).replace(/[,\s]/g, "").matchAll(/\d+(?:\.\d+)?/g)))
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n));
  // With fewer than two anchors there is no range to stay inside; anchorsSpoken
  // already refuses an insert with no spoken anchor at all.
  if (anchors.length < 2) return true;
  const low = Math.min(...anchors);
  const high = Math.max(...anchors);
  const span = Math.max(Math.abs(high), 1) * SERIES_OVERSHOOT_TOLERANCE;
  return series.every((value) =>
    Number.isFinite(value) && value >= low - span && value <= high + span,
  );
}

/**
 * Every numeral that will be DRAWN must have been spoken.
 *
 * anchorsSpoken checks `anchorValues` — the numbers the director declares the
 * insert is built on. But anchorValues is not what reaches the screen. The
 * Remotion component draws `title`, `value`, `label`, the first and last
 * `xLabels`, each bar's `label` and `display`, and each event's `label`. Only
 * the evidence-manifest path ever looked at those, via numericPlanValues, and
 * that path runs solely when a reviewed manifest exists.
 *
 * So on the ordinary route a director could declare truthful anchors and still
 * render a different figure: anchors ["534000"] with value "$1.2 million" put a
 * hero number on screen that nobody said, past a gate that reported success.
 * That is the module's central promise — "the model styles the data; it never
 * invents it" — failing silently on its main path.
 *
 * Bars are checked on `value` as well as `display`, because value drives bar
 * HEIGHT. Two bars displaying 100 and 200 but valued 100 and 900 read as a
 * ninefold gap; the geometry is a claim even when the captions are honest.
 *
 * `series` is deliberately excluded — its points are interpolated between the
 * anchors by design, and seriesWithinSpokenRange bounds them instead.
 */
const MAGNITUDES: [RegExp, number][] = [
  [/^(k|thousand)$/, 1e3],
  [/^(m|mm|mn|million)$/, 1e6],
  [/^(b|bn|billion)$/, 1e9],
  [/^(t|tn|trillion)$/, 1e12],
];

function magnitudeOf(word: string | undefined): number | undefined {
  if (!word) return undefined;
  const lower = word.toLowerCase();
  return MAGNITUDES.find(([re]) => re.test(lower))?.[1];
}

/**
 * The numbers a sentence speaks, including magnitude-WORD expansions: narration
 * says "534 thousand" far more often than "534,000", and a chart that renders
 * the full figure for it is formatting, not invention.
 */
function spokenNumberSet(sentence: string): Set<string> {
  const spoken = digitGroups(sentence);
  for (const m of sentence.replace(/[,\s](?=\d)/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g)) {
    const scale = magnitudeOf(m[2]);
    if (scale === undefined) continue;
    const scaled = Number(m[1]) * scale;
    if (Number.isFinite(scaled)) {
      spoken.add(String(scaled));
      spoken.add(String(Math.round(scaled)));
    }
  }
  return spoken;
}

/** True when every digit-group in a to-be-rendered string was spoken. */
function numbersSpokenIn(text: string, spoken: Set<string>): boolean {
  for (const m of text.replace(/[,\s](?=\d)/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([a-zA-Z]*)/g)) {
    const raw = m[1];
    if (spoken.has(raw) || spoken.has(raw.split(".")[0])) continue;
    const scale = magnitudeOf(m[2]);
    if (scale !== undefined) {
      const scaled = Number(raw) * scale;
      if (spoken.has(String(scaled)) || spoken.has(String(Math.round(scaled)))) continue;
    }
    return false;
  }
  return true;
}

/** Returns the first field carrying an unspoken numeral, or null when clean. */
export function unspokenRenderedField(item: InsertPlanItem, sentence: string): string | null {
  const spoken = spokenNumberSet(sentence);
  const fields: [string, unknown][] = [
    ["title", item.title],
    ["value", item.value],
    ["label", item.label],
    ...(item.xLabels ?? []).map((x, i) => [`xLabels[${i}]`, x] as [string, unknown]),
    ...(item.bars ?? []).flatMap((b, i) => [
      [`bars[${i}].label`, b.label],
      [`bars[${i}].value`, b.value],
      [`bars[${i}].display`, b.display],
    ] as [string, unknown][]),
    ...(item.events ?? []).map((e, i) => [`events[${i}].label`, e.label] as [string, unknown]),
  ];
  for (const [name, value] of fields) {
    if (value === undefined || value === null) continue;
    if (!numbersSpokenIn(String(value), spoken)) return name;
  }
  return null;
}

/** Every anchor's digits must appear verbatim in the sentence. */
function anchorsSpoken(item: InsertPlanItem, sentence: string): boolean {
  const spoken = digitGroups(sentence);
  if (spoken.size === 0) return false;
  const anchors = (item.anchorValues ?? [])
    .map((a) => String(a).replace(/[,\s]/g, ""))
    .flatMap((a) => Array.from(a.matchAll(/\d+(?:\.\d+)?/g)).map((m) => m[0]));
  if (anchors.length === 0) return false;
  return anchors.every((a) => spoken.has(a) || spoken.has(a.split(".")[0]));
}

/** Every numeral rendered anywhere in a factual insert must be reviewed. */
function numericPlanValues(item: InsertPlanItem): number[] {
  const values: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push(value);
      return;
    }
    if (typeof value === "string") {
      for (const match of value.replace(/[,_\s](?=\d)/g, "").matchAll(/\d+(?:\.\d+)?/g)) values.push(Number(match[0]));
    }
  };
  collect(item.title);
  collect(item.value);
  collect(item.label);
  for (const value of item.anchorValues ?? []) collect(value);
  for (const value of item.series ?? []) collect(value);
  for (const label of item.xLabels ?? []) collect(label);
  for (const bar of item.bars ?? []) {
    collect(bar.label);
    collect(bar.value);
    collect(bar.display);
  }
  for (const event of item.events ?? []) collect(event.label);
  return values;
}

export const visualInserts: Block = {
  id: "visual_inserts",
  consumes: ["sentenceTimings"],
  produces: ["insertOverlays"],
  run: async (ctx) => {
    const timings =
      (ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    const enabled = ((ctx.params["insertTypes"] as string[] | undefined) ?? []).filter((k): k is InsertKind =>
      (KINDS as readonly string[]).includes(k),
    );
    if (!enabled.length) {
      ctx.log("visual_inserts: no insertTypes enabled for this channel — skipping");
      return { insertOverlays: [] };
    }
    if (timings.length === 0) {
      ctx.log("visual_inserts: no timings — skipping");
      return { insertOverlays: [] };
    }

    // Candidate sentences = the ones that actually SPEAK numbers.
    const strictDataStory = hasSourceAttributedDataStoryParams(ctx.params);
    const numericCandidates = timings
      .map((t, i) => ({ i, text: t.text }))
      .filter((c) => /\d/.test(c.text));
    const candidates = strictDataStory
      ? numericCandidates.filter((candidate) => hasNamedSourceAttribution(candidate.text))
      : numericCandidates;
    if (candidates.length === 0) {
      ctx.log(strictDataStory
        ? "visual_inserts: source-attributed data story has no eligible named-source numeric sentence — nothing to visualize"
        : "visual_inserts: narration speaks no numbers — nothing to visualize");
      return { insertOverlays: [] };
    }
    // A named source in the prose is not enough. Before Claude can select a
    // chart, prove every source/number pairing against the reviewed ledger.
    // This is intentionally fail-closed: a source-attributed data story must
    // never silently degrade into an unreviewed data visual.
    if (strictDataStory) {
      assertDataStorySourceLedger(
        ctx.store["dataStorySourceLedger"],
        timings.map((timing) => timing.text).join(" "),
      );
    }
    // A ledger proves spoken claims; it does not prove every plotted series
    // point. Charts consequently require their own review-bound value
    // manifest. No manifest means a citation badge may still render, but no
    // factual graphic can silently interpolate or invent data.
    let evidenceVisualManifests: EvidenceVisualManifest[] = [];
    if (strictDataStory && ctx.store["evidenceVisualManifests"] !== undefined) {
      evidenceVisualManifests = assertEvidenceVisualManifestCollection(ctx.store["evidenceVisualManifests"]);
    }
    const evidenceVisualById = new Map(evidenceVisualManifests.map((manifest) => [manifest.id, manifest]));
    // Keep evidence eligibility ahead of the planner/provider boundary. A
    // missing permitted planner is a no-op, never a fallback to Gemini.
    if (!hasAnthropicKey()) {
      ctx.log("visual_inserts: no permitted planner key — skipping");
      return { insertOverlays: [] };
    }

    const narrationSec = timings[timings.length - 1]?.end ?? 0;
    const maxInserts = Math.max(
      1,
      Math.min(8, Number(ctx.params["maxInserts"] ?? Math.ceil(narrationSec / 180))),
    );
    const minGapSec = Number(ctx.params["minGapSec"] ?? 20);
    const topic = (ctx.store["topic"] as string | undefined) ?? "";
    const niche = (ctx.store["niche"] as string | undefined) ?? "";
    const dna = ctx.store["styleDNA"] as { palette?: string[] } | null;
    const studioMotionGraphicsRecipe = studioPostproductionRecipeProjectionFromUnknown(
      ctx.store["studioMotionGraphicsRecipeProjection"],
      "motion_graphics_template",
    );
    const studioPresentationDirection = studioMotionGraphicsRecipe.promptAddenda.length
      ? `\nAPPROVED STUDIO PRESENTATION DIRECTION (appearance only; do not alter facts, values, source attribution, visual type, or timing): ${studioMotionGraphicsRecipe.promptAddenda.join(" ")}\n`
      : "";
    const palette =
      dna?.palette?.length ? dna.palette : ((ctx.store["palette"] as string[] | undefined) ?? []);
    const accent = palette.length >= 2 ? palette[palette.length - 2] : undefined;
    const factualManifestDocs = strictDataStory
      ? (evidenceVisualManifests.length
        ? `\nREVIEWED FACTUAL VISUAL MANIFESTS — use only one of these for a chart/bar/line and return its evidenceVisualId. Every rendered number, unit-bearing point, and numeric label must be copied from that manifest; do not interpolate a series.\n${evidenceVisualManifests.map(evidenceVisualManifestPrompt).join("\n")}`
        : "\nNO REVIEWED FACTUAL VISUAL MANIFESTS are available. You may plan only lower_third source badges; do not plan charts, bars, lines, or big-stat graphics.")
      : "";

    // ---- Insert Director: plan which numbers become which visual ----
    const kindDocs = [
      enabled.includes("big_stat")
        ? `"big_stat": one hero number counting up. Fields: value (the display string EXACTLY as meaningful, e.g. "$534,000" or "87%"), label (<=8 words).`
        : "",
      enabled.includes("line_chart")
        ? `"line_chart": an animated curve between TWO SPOKEN anchor values (growth/decline over time). Fields: series (8-16 numbers, a faithful smooth shape from the first spoken anchor to the last — compounding curves bow upward), xLabels ([startLabel, endLabel], e.g. ["2016","2026"]), title.`
        : "",
      enabled.includes("bar_compare")
        ? `"bar_compare": 2-4 labeled bars comparing SPOKEN quantities. Fields: bars [{label, value, display?}].`
        : "",
      enabled.includes("annotated_line")
        ? `"annotated_line": a line_chart with up to 4 labeled EVENT markers (crashes, policy moments) — only for sentences narrating a historical arc. Fields: series, xLabels, title, events [{idx (index into series), label (<=4 words)}]. Event labels must reference things the sentence actually says.`
        : "",
      enabled.includes("lower_third")
        ? `"lower_third": a small SOURCE-CITATION badge (no chart) shown while a stat is attributed. ONLY when the sentence NAMES the source ("according to the Federal Reserve…"). Fields: value = the citation line exactly as spoken-ish, e.g. "Federal Reserve, 2023"; title = "Source". The named institution MUST appear verbatim in the sentence.`
        : "",
    ].filter(Boolean).join("\n");

    let plan: InsertPlanItem[] = [];
    try {
      const raw = await claudeJson<{ inserts?: InsertPlanItem[] }>({
        prompt:
          `You are the channel's MOTION-GRAPHICS DIRECTOR for a ${niche || "YouTube"} video: "${topic}".\n` +
          `These narration sentences speak numbers (sentenceIdx: text):\n` +
          candidates.slice(0, 60).map((c) => `${c.i}: ${c.text}`).join("\n") +
          `\n\nPlan AT MOST ${maxInserts} on-screen data inserts that make the strongest spoken numbers VISUAL. ` +
          `STRATEGY: place inserts at the moments of maximal persuasion — the thesis-proof number, the comparison ` +
          `that decides the argument, the payoff figure — never at passing mentions. Fewer great inserts beat many ` +
          `weak ones; if the script is data-light, plan fewer or none.\n` +
          `RELEVANCY WINDOW: for each insert also return endSentenceIdx — the LAST sentence still discussing that ` +
          `data (same as sentenceIdx if one sentence; at most sentenceIdx+4). The visual HOLDS on screen for that ` +
          `whole span so the viewer can actually read it while it is being talked about.\n` +
          `Available kinds:\n${kindDocs}\n\n` +
          factualManifestDocs +
          studioPresentationDirection +
          `HARD RULES:\n` +
          `- anchorValues: list the EXACT numbers from the chosen sentence that the insert visualizes. ` +
          `You may NOT use numbers that are not spoken in that sentence (inserts are fact-checked against the script).\n` +
          `- title: <=8 words, no clickbait.\n` +
          `- One insert per sentence; spread them across the video.\n` +
          `Return STRICT JSON {"inserts":[{"sentenceIdx":number,"endSentenceIdx":number,"kind":string,"title":string,"value"?:string,` +
          `"label"?:string,"series"?:number[],"xLabels"?:string[],"bars"?:[{"label":string,"value":number,"display"?:string}],` +
          `"anchorValues":number[]|string[],"evidenceVisualId"?:string}]}.`,
        maxTokens: 1800,
        temperature: 0.4,
        log: ctx.log,
      });
      plan = Array.isArray(raw.inserts) ? raw.inserts : [];
    } catch (e) {
      ctx.log(`visual_inserts: director failed (skipping inserts): ${e instanceof Error ? e.message : e}`);
      return { insertOverlays: [] };
    }

    // ---- Deterministic integrity + shape validation ----
    const valid: InsertPlanItem[] = [];
    for (const it of plan) {
      const t = timings[it.sentenceIdx];
      if (!t) continue;
      if (!enabled.includes(it.kind)) continue;
      if (strictDataStory && !hasNamedSourceAttribution(t.text)) {
        ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — strict data-story source missing ("${t.text.slice(0, 60)}…")`);
        continue;
      }
      // lower_third has its own integrity gate (the SOURCE must be named in
      // the sentence); everything else fact-checks the anchor NUMBERS.
      if (it.kind === "lower_third") {
        if (!it.value || !sourceSpoken(it.value, t.text)) {
          ctx.log(`visual_inserts: DROPPED lower_third@${it.sentenceIdx} — source not named in the sentence ("${t.text.slice(0, 60)}…")`);
          continue;
        }
        valid.push(it);
        continue;
      }
      if (strictDataStory) {
        const evidenceManifest = it.evidenceVisualId ? evidenceVisualById.get(it.evidenceVisualId) : undefined;
        if (!evidenceManifest || evidenceManifest.surface !== "data_insert" || evidenceManifest.visualKind !== "chart") {
          ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — factual data visual has no reviewed chart manifest`);
          continue;
        }
        if (!evidenceVisualManifestBindsNarration(evidenceManifest, t.text)) {
          ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — selected manifest is not bound to this narration anchor`);
          continue;
        }
        if (!evidenceVisualManifestAllowsNumbers(evidenceManifest, numericPlanValues(it))) {
          ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — rendered numbers are not all present in the reviewed manifest`);
          continue;
        }
      }
      if (!seriesWithinSpokenRange(it)) {
        ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — plotted curve leaves the range of its spoken anchors`);
        continue;
      }
      const unspoken = unspokenRenderedField(it, t.text);
      if (unspoken !== null) {
        ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — ${unspoken} renders a number not spoken in the sentence ("${t.text.slice(0, 60)}…")`);
        continue;
      }
      if (!anchorsSpoken(it, t.text)) {
        ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — anchor numbers not spoken verbatim ("${t.text.slice(0, 60)}…")`);
        continue;
      }
      if (it.kind === "big_stat" && !(it.value && /\d/.test(it.value))) continue;
      if ((it.kind === "line_chart" || it.kind === "annotated_line") && !(Array.isArray(it.series) && it.series.length >= 2)) continue;
      if (it.kind === "bar_compare" && !(Array.isArray(it.bars) && it.bars.length >= 2)) continue;
      valid.push(it);
    }

    // ---- Timing + spacing (sentence-synced; never collide with quote cards,
    // chapter heading cards, or the outro card in the tail) ----
    const introSec = Number(ctx.store["introSec"] ?? 0);
    const quoteWindows = (
      (ctx.store["quoteOverlays"] as { startSec: number; durSec: number }[] | undefined) ?? []
    ).map((q) => [q.startSec - 2, q.startSec + q.durSec + 2] as [number, number]);
    // Chapter-card windows (chapterPlan runs in body time; body starts after the
    // intro) — an insert blurring over a chapter heading is the same defect the
    // quote block already guards against.
    const chapterWindows: [number, number][] = [];
    {
      const plan = ctx.store["chapterPlan"] as { kind: string; durSec: number }[] | undefined;
      let tAbs = introSec;
      for (const w of plan ?? []) {
        if (w.kind === "card") chapterWindows.push([tAbs - 2, tAbs + w.durSec + 2]);
        tAbs += w.durSec;
      }
    }
    // Inserts must never spill past the narration into the tail — overlays
    // composite AFTER the outro card is placed, so a long hold would blur/cover it.
    const narrationEndAbs = introSec + (timings[timings.length - 1]?.end ?? 0);
    const portrait = (ctx.params["aspect"] as string | undefined) === "9:16";
    const W = portrait ? 1080 : 1920;
    const H = portrait ? 1920 : 1080;

    valid.sort((a, b) => a.sentenceIdx - b.sentenceIdx);
    const tmp = await makeRunTempDir(ctx.runId);
    const out: {
      path: string; key?: string; startSec: number; durSec: number; text: string;
      highlights: string[]; width: number; height: number; noBlur?: boolean;
    }[] = [];
    let lastEnd = -Infinity;
    for (const it of valid) {
      if (out.length >= maxInserts) break;
      const t = timings[it.sentenceIdx];
      // NARRATED-RELEVANCY DURATION: hold while the script is still talking
      // about this data (+1s to land), with per-kind read-time floors —
      // a chart that flashes for 5s was never actually read.
      const endIdx = Math.min(
        timings.length - 1,
        Math.max(it.sentenceIdx, Math.min(Number(it.endSentenceIdx ?? it.sentenceIdx), it.sentenceIdx + 4)),
      );
      const spanSec = Math.max(0, timings[endIdx].end - t.start) + 1.0;
      const floors = { lower_third: 4.5, big_stat: 6, line_chart: 8, annotated_line: 9, bar_compare: 8 } as const;
      const caps = { lower_third: 9, big_stat: 14, line_chart: 18, annotated_line: 18, bar_compare: 16 } as const;
      let durSec = Math.min(caps[it.kind], Math.max(floors[it.kind], spanSec));
      const startSec = Math.max(introSec + 1, introSec + t.start - 0.2);
      // Tail clamp: end by narration end (+0.5s grace) — never over the outro.
      durSec = Math.min(durSec, Math.max(0, narrationEndAbs + 0.5 - startSec));
      if (durSec < 3.5) {
        ctx.log(`visual_inserts: ${it.kind}@${startSec.toFixed(0)}s would spill into the tail — skipped`);
        continue;
      }
      if (startSec < lastEnd + minGapSec) continue;
      if (quoteWindows.some(([a, b]) => startSec < b && startSec + durSec > a)) {
        ctx.log(`visual_inserts: ${it.kind}@${startSec.toFixed(0)}s clashes with a quote card — skipped`);
        continue;
      }
      if (chapterWindows.some(([a, b]) => startSec < b && startSec + durSec > a)) {
        ctx.log(`visual_inserts: ${it.kind}@${startSec.toFixed(0)}s clashes with a chapter card — skipped`);
        continue;
      }
      try {
        const path = join(tmp, `insert_${it.sentenceIdx}.webm`);
        await renderDataInsert({
          kind: it.kind,
          title: it.title,
          value: it.value,
          label: it.label,
          series: it.series,
          xLabels: it.xLabels,
          bars: it.bars,
          events: it.events,
          palette,
          accent,
          presentation: studioMotionGraphicsRecipe.dataInsertPreset ?? undefined,
          outPath: path,
          durationSec: durSec,
          width: W,
          height: H,
        });
        // RENDER-SPLIT CONTRACT: timeline_assemble runs on a SEPARATE worker —
        // R2-back the webm and carry the key so the compose pass can restore it
        // (a local-only path made every insert silently uncompositable there,
        // which then tripped the "inserts missing" QA gate and a heal treadmill).
        const key = `${ctx.keyPrefix}runs/${ctx.runId}/insert_${out.length}.webm`;
        await putObject(key, await readBytes(path), { contentType: "video/webm" });
        // lower thirds composite WITHOUT the blur-under treatment (small badge,
        // footage stays fully visible behind it).
        out.push({ path, key, startSec, durSec, text: it.title ?? it.kind, highlights: [], width: W, height: H, noBlur: it.kind === "lower_third" });
        lastEnd = startSec + durSec;
        ctx.log(`visual_inserts: ${it.kind} "${(it.title ?? "").slice(0, 40)}" @ ${startSec.toFixed(1)}s (${durSec}s)`);
      } catch (e) {
        ctx.log(`visual_inserts: render failed for ${it.kind}@${it.sentenceIdx} (skipped): ${e instanceof Error ? e.message : e}`);
      }
    }

    ctx.log(`visual_inserts: ${out.length} insert(s) planned+rendered from ${candidates.length} numeric sentences`);
    return { insertOverlays: out };
  },
};

export const insertBlocks: Block[] = [visualInserts];
