/**
 * Calibration harness for visual_inserts.
 *
 * A gate that drops everything and a gate that drops nothing are equally
 * broken, and a unit test written by the same person who wrote the gate cannot
 * tell them apart — it only ever contains cases that person thought of. This
 * runs the SHIPPING block against the real Insert Director and reports what the
 * gates actually did, so over-tightening shows up as a number rather than as a
 * surprise in production.
 *
 * What is real here and what is not, precisely:
 *   REAL  the channel (Investory, the only channel with visual_inserts enabled),
 *         its insertTypes/maxInserts/minGapSec params, its planned topics, the
 *         director prompt, and every integrity gate — visualInserts.run itself
 *         is executed, not a copy of its logic.
 *   NOT   the narration. A full synthScript run bills hookcraft and grounded
 *         fact-checks for text this harness only needs sentences from, so the
 *         narration is generated under the pipeline's OWN dataDiscipline clause
 *         instead. The sentence distribution is the pipeline's; the arc is not.
 *
 * Rendering is expected to fail here (no Remotion serve URL, no R2). That is
 * harmless and deliberate: every integrity decision is logged before the render
 * is attempted, so the gates are fully observable without paying to render.
 *
 * Usage:
 *   ai-vault anthropic ANTHROPIC_API_KEY=ANTHROPIC_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/insert-integrity-harness.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

import { claudeJson } from "@/lib/anthropic";
import { dataDiscipline } from "@/lib/scriptGen";
import {
  seriesWithinSpokenRange,
  unspokenRenderedField,
  visualInserts,
  type InsertPlanItem,
} from "@/trigger/blocks/insertBlocks";
import type { StageContext } from "@/engine/types";

const NARRATION_CACHE = "/tmp/insert-harness-narration.json";
const TOPICS_FILE = "/tmp/inv-topics.json";

/** Reading speed used to fake timings; only ordering and spacing matter here. */
const WORDS_PER_SEC = 2.6;

interface Narration { topic: string; sentences: string[] }

/**
 * Narration for one topic, written under the pipeline's own data-discipline
 * instruction so the numeric sentences look like the ones the director really
 * sees. Cached: the director is what is being measured, not the writer, and
 * re-rolling the narration between runs would make two runs incomparable.
 */
async function narrate(topic: string, persona: string, niche: string): Promise<Narration> {
  const out = await claudeJson<{ sentences?: string[] }>({
    prompt:
      `Write the numeric spine of a YouTube narration script about: "${topic}".\n` +
      `Channel voice: ${persona}\nNiche: ${niche}.\n` +
      dataDiscipline(true, false) +
      `\n\nReturn 14 consecutive narration sentences as they would be SPOKEN — plain prose, no ` +
      `markdown, no bullet points, no stage directions. At least 8 of them must state a concrete ` +
      `figure. Write them as a real script would: some numbers named plainly ("534,000"), some in ` +
      `magnitude words ("534 thousand", "1.2 million"), some as percentages and year ranges.\n` +
      `Reply with ONLY the JSON object {"sentences":[string]} and nothing else.`,
    maxTokens: 6000,
    temperature: 0.6,
  });
  return { topic, sentences: (out.sentences ?? []).filter((s) => typeof s === "string" && s.trim()) };
}

function timings(sentences: string[]): { text: string; start: number; end: number }[] {
  let t = 0;
  return sentences.map((text) => {
    const dur = Math.max(1.6, text.split(/\s+/).length / WORDS_PER_SEC);
    const entry = { text, start: t, end: t + dur };
    t += dur + 0.25;
    return entry;
  });
}

/** Classify a drop line by which gate produced it. */
function gateOf(line: string): string | null {
  if (!line.includes("DROPPED")) return null;
  if (line.includes("renders a number not spoken")) return "rendered-numeral (NEW)";
  if (line.includes("anchor numbers not spoken verbatim")) return "anchorsSpoken";
  if (line.includes("plotted curve leaves the range")) return "seriesRange (NEW)";
  if (line.includes("source not named in the sentence")) return "lower_third source";
  if (line.includes("strict data-story source missing")) return "strict data story";
  if (line.includes("reviewed chart manifest")) return "manifest missing";
  return "other";
}

async function main(): Promise<void> {
  const topics: string[] = JSON.parse(readFileSync(TOPICS_FILE, "utf8"));
  const channel = JSON.parse(readFileSync("/tmp/investory.json", "utf8"));
  const persona: string = channel.identity?.persona ?? "";
  const niche: string = channel.identity?.niche ?? "Finance";

  let narrations: Narration[];
  if (existsSync(NARRATION_CACHE)) {
    narrations = JSON.parse(readFileSync(NARRATION_CACHE, "utf8"));
    console.log(`narration: reusing ${narrations.length} cached scripts (comparability between runs)`);
  } else {
    narrations = [];
    for (const topic of topics) {
      const n = await narrate(topic, persona, niche);
      console.log(`narration: "${topic.slice(0, 55)}…" -> ${n.sentences.length} sentences`);
      narrations.push(n);
    }
    writeFileSync(NARRATION_CACHE, JSON.stringify(narrations, null, 2));
  }

  const dropsByGate = new Map<string, string[]>();
  let planned = 0;
  let survived = 0;

  for (const n of narrations) {
    const sentenceTimings = timings(n.sentences);
    const numericSentences = sentenceTimings.filter((s) => /\d/.test(s.text)).length;
    const logs: string[] = [];
    const ctx = {
      ownerId: "harness",
      runId: "harness-run",
      channelId: channel.id,
      keyPrefix: "harness/",
      params: channel.insertParams ?? {},
      store: { sentenceTimings, topic: n.topic, niche },
      budgetUsd: 0,
      log: (m: string) => logs.push(m),
    } as unknown as StageContext;

    await visualInserts.run(ctx);

    const drops = logs.filter((l) => l.includes("DROPPED"));
    const skips = logs.filter((l) => l.includes("— skipped"));
    // The director's own count, not a count inferred from outcomes. Inferring it
    // silently undercounted: an insert lost to a shape check or the spacing rule
    // left no trace at all, so a module that rejected everything and a module
    // that planned nothing produced identical output.
    const declared = Number(/director planned (\d+) insert/.exec(logs.join("\n"))?.[1] ?? 0);
    const rendered = logs.filter((l) => /^visual_inserts: (big_stat|line_chart|bar_compare|annotated_line|lower_third) "/.test(l));
    const renderFailed = logs.filter((l) => l.includes("render failed")).length;
    planned += declared;
    survived += rendered.length + renderFailed;

    for (const d of drops) {
      const gate = gateOf(d) ?? "other";
      if (!dropsByGate.has(gate)) dropsByGate.set(gate, []);
      dropsByGate.get(gate)!.push(d.replace("visual_inserts: DROPPED ", ""));
    }
    console.log(
      `\n=== ${n.topic.slice(0, 62)}…\n    ${n.sentences.length} sentences (${numericSentences} numeric), ` +
      `director planned ${declared}, ${drops.length} dropped by a gate, ${skips.length} skipped on timing, ` +
      `${rendered.length + renderFailed} reached render`,
    );
    for (const d of drops) console.log(`    DROP  ${d.replace("visual_inserts: DROPPED ", "").slice(0, 155)}`);
    for (const k of skips) console.log(`    SKIP  ${k.replace("visual_inserts: ", "").slice(0, 155)}`);
    // Anything that is neither a drop, a skip nor a render line is the module
    // explaining itself — a failed director, a missing key, an early return.
    for (const l of logs) {
      if (l.includes("DROPPED") || l.includes("— skipped") || /^visual_inserts: (big_stat|line_chart|bar_compare|annotated_line|lower_third) "/.test(l)) continue;
      console.log(`    LOG   ${l.replace("visual_inserts: ", "").slice(0, 200)}`);
    }
  }

  // ---- adversarial sweep --------------------------------------------------
  // Zero drops above is ambiguous on its own: it reads the same whether the
  // director behaved or the gates have quietly gone permissive. So the same
  // REAL sentences are replayed with deliberately corrupted plans, and every
  // one must be caught. This is the harness checking itself.
  let caught = 0;
  let missed = 0;
  for (const n of narrations) {
    const narration = n.sentences.join(" ");
    for (const sentence of n.sentences.filter((x) => /\d/.test(x))) {
      const digits = Array.from(sentence.matchAll(/\d+(?:\.\d+)?/g)).map((m) => Number(m[0]));
      // A figure that appears nowhere in the entire script.
      const invented = String(Math.max(...digits, 1) * 7919 + 13);
      const attacks: [string, () => boolean][] = [
        ["hero number nobody said", () =>
          unspokenRenderedField({ kind: "big_stat", sentenceIdx: 0, value: `$${invented}` } as InsertPlanItem, sentence, narration) !== null],
        ["bar height contradicting its caption", () =>
          unspokenRenderedField({
            kind: "bar_compare", sentenceIdx: 0,
            bars: [{ label: "A", value: Number(invented), display: String(digits[0] ?? 1) }],
          } as InsertPlanItem, sentence, narration) !== null],
        ["frame citing a figure absent from the script", () =>
          unspokenRenderedField({ kind: "line_chart", sentenceIdx: 0, title: `The ${invented} Threshold` } as InsertPlanItem, sentence, narration) !== null],
      ];
      if (digits.length >= 2) {
        const low = Math.min(...digits);
        const high = Math.max(...digits);
        attacks.push(["curve peaking outside its spoken anchors", () =>
          !seriesWithinSpokenRange({
            kind: "line_chart", sentenceIdx: 0,
            anchorValues: [String(low), String(high)],
            series: [low, high * 9 + 1000, high],
          } as InsertPlanItem)]);
      }
      for (const [name, holds] of attacks) {
        if (holds()) caught++;
        else { missed++; console.log(`    MISSED  ${name} — on "${sentence.slice(0, 70)}…"`); }
      }
    }
  }
  console.log(`\nadversarial sweep over the same real sentences: ${caught} caught, ${missed} missed`);
  if (missed > 0) console.log("  A MISS means a gate has gone permissive — the clean run above proves nothing.");

  console.log(`\n\n===== GATE SUMMARY =====`);
  console.log(`planned by the director: ${planned}`);
  console.log(`survived every gate:     ${survived}`);
  for (const [gate, lines] of [...dropsByGate.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(lines.length).padStart(3)}  ${gate}`);
  }
  const mine = (dropsByGate.get("rendered-numeral (NEW)") ?? []).length + (dropsByGate.get("seriesRange (NEW)") ?? []).length;
  console.log(`\nattributable to the two new gates: ${mine} of ${planned}`);
  console.log(
    `\nEach line above is to be READ, not just counted: a drop naming an invented\n` +
    `figure is the gate working; a drop naming a legitimate reformatting of a\n` +
    `spoken number is the gate being too strict, and is a bug in the gate.`,
  );
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
