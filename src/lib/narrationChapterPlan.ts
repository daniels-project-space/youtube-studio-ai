import { boundNarrationChapterHeadings } from "@/lib/narrationBounds";
import { sanitizeSpoken } from "@/lib/scriptGen";
import { splitNarrationSentences } from "@/lib/narrationTimingPlan";
import { evaluateNarrationCadence, planNarrationCadence, type NarrationCadenceProfile } from "@/lib/narrationPerformance";

export type NarrationChapterItem = { kind: "narration" | "heading"; text: string; chapter?: number; sectionBoundaryAfter?: boolean };

export function narrationChapterItems(script: { hook?: string; sections: readonly { heading: string; narration: string }[] }): NarrationChapterItem[] {
  const items: NarrationChapterItem[] = [];
  if (script.hook) for (const text of splitNarrationSentences(sanitizeSpoken(script.hook))) items.push({ kind: "narration", text });
  const eligible = script.sections.map((section, index) => ({ heading: section.heading, index }))
    .filter(({ index }) => index !== script.sections.length - 1 && !(index === 0 && script.sections.length >= 3));
  const headings = boundNarrationChapterHeadings(eligible.map(({ heading }) => heading));
  const bySection = new Map<number, { heading: string; chapter: number }>();
  headings.forEach((heading, index) => { if (heading) bySection.set(eligible[index].index, { heading, chapter: bySection.size + 1 }); });
  const sections = script.sections.map(section => splitNarrationSentences(sanitizeSpoken(section.narration)));
  sections.forEach((sentences, index) => {
    const heading = bySection.get(index);
    if (heading) items.push({ kind: "heading", text: heading.heading, chapter: heading.chapter });
    const start = items.length;
    for (const text of sentences) items.push({ kind: "narration", text });
    if (items.length > start && sections.slice(index + 1).some(section => section.length > 0)) items[items.length - 1].sectionBoundaryAfter = true;
  });
  return items;
}

export function chapterItemSpeech(item: NarrationChapterItem): string {
  return item.kind === "heading" ? `Chapter ${item.chapter}: ${item.text.replace(/[.:;,\s]+$/, "")}.` : item.text;
}

export function narrationChapterCadence(args: { items: readonly NarrationChapterItem[]; baseGapSec: number; jitterSec: number;
  profile: NarrationCadenceProfile; restBudgetSec: number; preSec: number; postSec: number }) {
  if (!Number.isFinite(args.preSec) || args.preSec < 0 || !Number.isFinite(args.postSec) || args.postSec < 0) {
    throw new Error("chapter narration: pre/post timing must be finite and nonnegative");
  }
  if (args.profile === "quiet_listening" && args.preSec > 15) {
    throw new Error("chapter narration: pre-roll cannot exceed the minimum quiet rest");
  }
  const cadence = planNarrationCadence({ sentences: args.items.map(chapterItemSpeech), baseGapSec: args.baseGapSec,
    jitterSec: args.jitterSec, sectionBoundaryAfter: args.items.map(item => item.sectionBoundaryAfter === true),
    profile: args.profile, maxQuietRestBudgetSec: args.restBudgetSec });
  const gaps = args.items.map((item, index) => {
    if (index === args.items.length - 1) return 0;
    if (item.kind === "heading") return args.postSec;
    if (args.items[index + 1]?.kind === "heading") {
      const rest = cadence.purposes[index] === "section" ? cadence.gapsSec[index] : 0;
      return Math.max(args.preSec, rest);
    }
    return cadence.gapsSec[index];
  });
  return { ...cadence, gapsSec: gaps };
}

export function narrationChapterTimeline(items: readonly NarrationChapterItem[], durations: readonly number[], gaps: readonly number[], preSec: number, postSec: number) {
  if (items.length !== durations.length || items.length !== gaps.length || durations.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error("chapter narration: measured items do not match the plan");
  }
  const sentenceTimings: { text: string; start: number; end: number }[] = [];
  const itemTimings: { start: number; end: number }[] = [];
  const chapterPlan: { kind: "footage" | "card"; durSec: number; heading?: string }[] = [];
  let cursor = 0, footage = 0;
  const flush = () => { if (footage > 0.1) chapterPlan.push({ kind: "footage", durSec: footage }); footage = 0; };
  items.forEach((item, index) => {
    const duration = durations[index], gap = gaps[index];
    if (!Number.isFinite(gap) || gap < 0) throw new Error("chapter narration: invalid planned gap");
    itemTimings.push({ start: cursor, end: cursor + duration });
    if (item.kind === "heading") {
      flush();
      chapterPlan.push({ kind: "card", durSec: preSec + duration + postSec, heading: item.text });
    } else {
      sentenceTimings.push({ text: item.text, start: cursor, end: cursor + duration });
      footage += duration + (items[index + 1]?.kind === "heading" ? Math.max(0, gap - preSec) : gap);
    }
    cursor += duration + gap;
  });
  flush();
  evaluateNarrationCadence({ sentences: items.map(chapterItemSpeech), sentenceTimings: itemTimings,
    plan: { version: "narration-cadence-evidence/v1", gapsSec: [...gaps], purposes: items.map(() => "continuation") } });
  return { sentenceTimings, chapterPlan, durationSec: cursor };
}
