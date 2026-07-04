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
import { join } from "node:path";
import { makeRunTempDir, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { renderDataInsert } from "@/lib/remotionRender";

const KINDS = ["big_stat", "line_chart", "bar_compare", "annotated_line", "lower_third"] as const;
type InsertKind = (typeof KINDS)[number];

interface InsertPlanItem {
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
    if (!hasGeminiKey() || timings.length === 0) {
      ctx.log("visual_inserts: no Gemini key or no timings — skipping");
      return { insertOverlays: [] };
    }

    // Candidate sentences = the ones that actually SPEAK numbers.
    const candidates = timings
      .map((t, i) => ({ i, text: t.text }))
      .filter((c) => /\d/.test(c.text));
    if (candidates.length === 0) {
      ctx.log("visual_inserts: narration speaks no numbers — nothing to visualize");
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
    const palette =
      dna?.palette?.length ? dna.palette : ((ctx.store["palette"] as string[] | undefined) ?? []);
    const accent = palette.length >= 2 ? palette[palette.length - 2] : undefined;

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
      const raw = await geminiJson<{ inserts?: InsertPlanItem[] }>({
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
          `HARD RULES:\n` +
          `- anchorValues: list the EXACT numbers from the chosen sentence that the insert visualizes. ` +
          `You may NOT use numbers that are not spoken in that sentence (inserts are fact-checked against the script).\n` +
          `- title: <=8 words, no clickbait.\n` +
          `- One insert per sentence; spread them across the video.\n` +
          `Return STRICT JSON {"inserts":[{"sentenceIdx":number,"endSentenceIdx":number,"kind":string,"title":string,"value"?:string,` +
          `"label"?:string,"series"?:number[],"xLabels"?:string[],"bars"?:[{"label":string,"value":number,"display"?:string}],` +
          `"anchorValues":number[]|string[]}]}.`,
        maxTokens: 1800,
        temperature: 0.4,
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
      if (!anchorsSpoken(it, t.text)) {
        ctx.log(`visual_inserts: DROPPED ${it.kind}@${it.sentenceIdx} — anchor numbers not spoken verbatim ("${t.text.slice(0, 60)}…")`);
        continue;
      }
      if (it.kind === "big_stat" && !(it.value && /\d/.test(it.value))) continue;
      if ((it.kind === "line_chart" || it.kind === "annotated_line") && !(Array.isArray(it.series) && it.series.length >= 2)) continue;
      if (it.kind === "bar_compare" && !(Array.isArray(it.bars) && it.bars.length >= 2)) continue;
      valid.push(it);
    }

    // ---- Timing + spacing (sentence-synced; never collide with quote cards) ----
    const introSec = Number(ctx.store["introSec"] ?? 0);
    const quoteWindows = (
      (ctx.store["quoteOverlays"] as { startSec: number; durSec: number }[] | undefined) ?? []
    ).map((q) => [q.startSec - 2, q.startSec + q.durSec + 2] as [number, number]);
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
      const durSec = Math.min(caps[it.kind], Math.max(floors[it.kind], spanSec));
      const startSec = Math.max(introSec + 1, introSec + t.start - 0.2);
      if (startSec < lastEnd + minGapSec) continue;
      if (quoteWindows.some(([a, b]) => startSec < b && startSec + durSec > a)) {
        ctx.log(`visual_inserts: ${it.kind}@${startSec.toFixed(0)}s clashes with a quote card — skipped`);
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
