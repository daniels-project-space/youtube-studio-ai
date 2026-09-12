import { z } from "zod";
import type { EvidenceVisualManifest, EvidenceVisualValue } from "./evidenceVisualManifest";
import { numericMentions } from "@/lib/numericClaims";

/** The director selects reviewed facts; it does not transcribe them again. */
export const DataInsertEvidenceBindingsSchema = z.object({
  anchorId: z.string().min(2),
  valueIds: z.array(z.string().min(2)).min(1).max(256),
  xValueIds: z.array(z.string().min(2)).min(2).max(256).optional(),
}).strict();
export type DataInsertEvidenceBindings = z.infer<typeof DataInsertEvidenceBindingsSchema>;

interface PlannedEvidenceInsert {
  kind: string;
  title?: string;
  evidenceBindings?: DataInsertEvidenceBindings;
  value?: string;
  label?: string;
  series?: number[];
  xLabels?: string[];
  bars?: { label: string; value: number; display?: string }[];
  events?: { idx: number; label: string }[];
}

const PlannedEvidenceFieldsSchema = z.object({
  kind: z.string(),
  title: z.string().optional(),
  evidenceBindings: DataInsertEvidenceBindingsSchema,
  value: z.string().optional(),
  label: z.string().optional(),
  series: z.array(z.number().finite()).optional(),
  xLabels: z.array(z.string()).optional(),
  bars: z.array(z.object({ label: z.string(), value: z.number().finite(), display: z.string().optional() })).optional(),
  events: z.array(z.object({ idx: z.number().int().nonnegative(), label: z.string() })).optional(),
});

export interface BoundDataInsertPresentation {
  value?: string;
  label?: string;
  series?: number[];
  seriesX?: number[];
  xLabels?: string[];
  bars?: { label: string; value: number; display: string }[];
  seriesDisplays?: string[];
  seriesUnit?: string;
  sourceAttribution: string;
  anchorValues: string[];
}

const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const sameText = (a: string, b: string) => normalized(a) === normalized(b);
const escapedLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function reviewedDisplayPattern(value: EvidenceVisualValue): string {
  const display = normalized(value.display);
  // SI symbols are case-sensitive (mW != MW). Only a full natural-language
  // unit recognized by the runtime's CLDR formatter can change title casing.
  // Unsupported unit names retain exact matching; no guessed unit conversion.
  let naturalUnit: string | undefined;
  try {
    naturalUnit = new Intl.NumberFormat('en', { style: 'unit', unit: value.unit.replace(/s$/, ''), unitDisplay: 'long' })
      .formatToParts(value.value).find((part) => part.type === 'unit')?.value;
  } catch { /* Exact display matching still applies to non-CLDR units. */ }
  if (!naturalUnit || !display.endsWith(naturalUnit)) return escapedLiteral(display);
  const unitPattern = [...naturalUnit].map((char) => /[a-z]/.test(char) ? `[${char}${char.toUpperCase()}]` : escapedLiteral(char)).join('');
  return escapedLiteral(display.slice(0, -naturalUnit.length)) + unitPattern;
}

/** Called only after the manifest's review fingerprint and source graph pass. */
export function bindDataInsertEvidence(
  manifest: EvidenceVisualManifest,
  rawItem: PlannedEvidenceInsert,
  sentence: { text: string; start: number; end: number },
): { ok: true; presentation: BoundDataInsertPresentation } | { ok: false; issue: string } {
  const refuse = (issue: string) => ({ ok: false as const, issue });
  const parsed = PlannedEvidenceFieldsSchema.safeParse(rawItem);
  if (!parsed.success) return refuse("missing or malformed evidenceBindings");
  if (manifest.surface !== "data_insert" || manifest.visualKind !== "chart") return refuse("not a data-insert chart manifest");
  const item = parsed.data;
  const bindings = item.evidenceBindings;
  const anchor = manifest.narrationAnchors.find((candidate) => candidate.id === bindings.anchorId);
  if (!anchor || !normalized(sentence.text).includes(normalized(anchor.spokenText)) ||
      !Number.isFinite(sentence.start) || !Number.isFinite(sentence.end) || sentence.end <= sentence.start ||
      sentence.end <= anchor.startSec || sentence.start >= anchor.endSec) {
    return refuse("selected anchor does not match this spoken sentence and time");
  }
  // Numeric title phrases must retain an approved display, not just reuse its
  // number with another unit. Remove complete reviewed phrases, then refuse
  // any remaining numeric claim. This is not general causal entailment.
  let remainingTitle = normalized(item.title ?? "");
  const displays = manifest.values.filter((value) => value.narrationAnchorId === anchor.id)
    .sort((a, b) => b.display.length - a.display.length);
  for (const value of displays) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{Sc}%+−-])${reviewedDisplayPattern(value)}(?![\\p{L}\\p{N}\\p{Sc}%]|[.,:/]\\d)`, "gu");
    remainingTitle = remainingTitle.replace(pattern, (match, offset: number, input: string) => {
      const suffix = input.slice(offset + match.length).trimStart().match(/^\p{L}+/u)?.[0];
      // A scale placed after the copied display changes its quantity too.
      if (suffix && numericMentions(`1 ${suffix}`).some((mention) => mention.plotValue !== null && mention.plotValue > 1)) return match;
      return " ";
    });
  }
  if (numericMentions(remainingTitle).length) return refuse("title changes a reviewed numeric display or introduces another quantity");
  const byId = new Map(manifest.values.map((value) => [value.id, value]));
  const allIds = [...bindings.valueIds, ...(bindings.xValueIds ?? [])];
  if (new Set(allIds).size !== allIds.length) return refuse("a reviewed value was bound more than once");
  const selected: EvidenceVisualValue[] = [];
  for (const id of allIds) {
    const value = byId.get(id);
    if (!value || value.narrationAnchorId !== anchor.id || !anchor.sourceIds.includes(value.sourceId) ||
        !manifest.attribution.sourceIds.includes(value.sourceId)) return refuse(`value ${id} is not bound to this anchor and visible source`);
    selected.push(value);
  }
  const values = selected.slice(0, bindings.valueIds.length);
  let xValues = selected.slice(bindings.valueIds.length);
  if (values.some((value) => !["metric", "y", "series"].includes(value.role)) ||
      xValues.some((value) => value.role !== "x")) return refuse("reviewed value role does not match its chart slot");
  if (values.some((value) => !sameText(value.unit, values[0].unit))) return refuse("a shared chart scale cannot mix reviewed units");
  const presentation: BoundDataInsertPresentation = {
    sourceAttribution: manifest.attribution.visibleText,
    anchorValues: values.map((value) => value.display),
  };
  if (item.kind === "big_stat") {
    if (values.length !== 1 || xValues.length || item.series || item.bars || item.xLabels || item.events) return refuse("stat requires exactly one metric and no chart fields");
    presentation.value = values[0].display;
    presentation.label = values[0].label ?? values[0].unit;
  } else if (item.kind === "bar_compare") {
    if (values.length < 2 || values.length > 4 || xValues.length || item.value || item.label || item.series || item.xLabels || item.events) return refuse("bar comparison requires two to four labeled metrics only");
    if (values.some((value) => !value.label)) return refuse("bar category has no reviewed label");
    presentation.bars = values.map((value) => ({ label: value.label!, value: value.value, display: value.display }));
  } else if (item.kind === "line_chart" || item.kind === "annotated_line") {
    if (values.length < 2 || item.value || item.label || item.bars) return refuse("line requires at least two reviewed points and no stat/bar fields");
    if (values.some((value) => !["y", "series"].includes(value.role))) return refuse("line points require a reviewed series or y role");
    // Preserve reviewed observation order; selecting IDs must not fabricate a
    // different trend by shuffling the same numbers.
    const ordered = manifest.values.filter((value) => bindings.valueIds.includes(value.id));
    if (ordered.some((value, index) => value.id !== values[index].id)) return refuse("series order differs from reviewed observation order");
    if (xValues.length || values.some((value) => value.xValueId)) {
      const linked: EvidenceVisualValue[] = [];
      for (const value of values) {
        const x = value.xValueId ? byId.get(value.xValueId) : undefined;
        if (!x || x.role !== "x" || x.sourceId !== value.sourceId || x.narrationAnchorId !== anchor.id) return refuse("x axis has no reviewed observation link for each point");
        linked.push(x);
      }
      const expectedX = xValues.length === 2 ? [linked[0], linked[linked.length - 1]] : linked;
      if (xValues.length && (xValues.length !== expectedX.length || xValues.some((x, i) => x.id !== expectedX[i].id))) return refuse("x labels are paired with different reviewed observations");
      xValues = linked;
      if (xValues.some((value) => !sameText(value.unit, xValues[0].unit))) return refuse("x axis cannot mix reviewed units");
      const direction = Math.sign(xValues[1].value - xValues[0].value);
      if (!direction || xValues.slice(1).some((x, i) => Math.sign(x.value - xValues[i].value) !== direction)) return refuse("x observations must be distinct and monotonic for a line");
      presentation.seriesX = xValues.map((value) => value.value);
    }
    presentation.series = values.map((value) => value.value);
    presentation.seriesDisplays = values.map((value) => value.display);
    presentation.seriesUnit = values[0].unit;
    if (xValues.length) presentation.xLabels = xValues.map((value) => value.display);
    if ((item.events ?? []).some((event) => !Number.isInteger(event.idx) || !values[event.idx]?.label || !sameText(event.label, values[event.idx].label!))) return refuse("event is not the reviewed label for its point");
  } else return refuse("unsupported factual insert kind");

  // Old/over-specified planner output must not be silently corrected. Reject
  // contradictory text or geometry before either the renderer or storage runs.
  for (const field of ["value", "label"] as const) {
    if (item[field] !== undefined && (!presentation[field] || !sameText(item[field]!, presentation[field]!))) return refuse(`${field} differs from the reviewed display`);
  }
  if (item.series !== undefined && (item.series.length !== presentation.series?.length || item.series.some((value, i) => value !== presentation.series![i]))) return refuse("series differs from reviewed geometry");
  if (item.xLabels !== undefined && (item.xLabels.length !== presentation.xLabels?.length || item.xLabels.some((value, i) => !sameText(value, presentation.xLabels![i])))) return refuse("x labels differ from reviewed displays");
  if (item.bars !== undefined && (item.bars.length !== presentation.bars?.length || item.bars.some((bar, i) => {
    const approved = presentation.bars![i];
    return bar.value !== approved.value || !sameText(bar.label, approved.label) || (bar.display !== undefined && !sameText(bar.display, approved.display));
  }))) return refuse("bar category, display or geometry differs from reviewed value");
  return { ok: true, presentation };
}
