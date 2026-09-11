/** Read-only presentation of a saved model review, never a release/quality gate.
 * Deliberately independent of metacraft's server-only provider and crypto code.
 * The pipeline validates the complete receipt; this reader handles legacy,
 * malformed and slim browser data while verifying the receipt's content
 * fingerprint. A valid fingerprint proves integrity, not factual truth or
 * measured audience performance.
 */
import { isTitleDecisionFingerprint, titleDecisionFingerprint } from "@/lib/titleDecisionFingerprint";

export type TitleReviewOption = {
  title: string;
  reason: string;
  grounding: "supported" | "contradicted" | "insufficient";
  pull: number;
  clarity: number;
  identity: number;
  selected: boolean;
  alternate: boolean;
};
export type TitleReviewPresentation =
  | { state: "unavailable" }
  | {
      state: "recorded" | "title_changed";
      selected: TitleReviewOption;
      options: TitleReviewOption[];
      source: "Full narration" | "Script excerpt" | "Topic only";
      attempts: number;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10;
}
function index(value: unknown, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}

export function readTitleReview(outputs: unknown): TitleReviewPresentation | null {
  const out = record(outputs);
  if (!out || out["titleDecision"] === undefined) return null;
  const unavailable: TitleReviewPresentation = { state: "unavailable" };
  const receipt = record(out["titleDecision"]);
  if (!receipt || receipt.version !== "title-decision/v1" || receipt.judged !== true ||
      !isTitleDecisionFingerprint(receipt.fingerprint) ||
      !text(receipt.title, 100) || !Array.isArray(receipt.candidates) ||
      receipt.candidates.length < 1 || receipt.candidates.length > 16 ||
      !Array.isArray(receipt.rankings) || receipt.rankings.length !== receipt.candidates.length ||
      !index(receipt.winnerIndex, receipt.candidates.length) ||
      !(receipt.alternateIndex === null || index(receipt.alternateIndex, receipt.candidates.length)) ||
      receipt.alternateIndex === receipt.winnerIndex ||
      ![1, 2].includes(receipt.attempts as number)) return unavailable;
  if (receipt.fingerprint !== titleDecisionFingerprint(receipt)) return unavailable;
  const coverage = record(receipt.sourceCoverage);
  if (!coverage || !Number.isSafeInteger(coverage.providedChars) || Number(coverage.providedChars) < 0 ||
      !(coverage.totalChars === null || (Number.isSafeInteger(coverage.totalChars) &&
        Number(coverage.totalChars) >= Number(coverage.providedChars)))) return unavailable;
  const source = coverage.kind === "full_narration" && coverage.totalChars === coverage.providedChars
    ? "Full narration" : coverage.kind === "script_excerpt" ? "Script excerpt"
    : coverage.kind === "topic_only" && coverage.providedChars === 0 ? "Topic only" : null;
  if (!source) return unavailable;

  const rankings = new Map<number, Record<string, unknown>>();
  for (const raw of receipt.rankings) {
    const row = record(raw);
    if (!row || !index(row.idx, receipt.candidates.length) || rankings.has(row.idx) ||
        !score(row.clickScore) || !score(row.direct) || !score(row.identityFit) ||
        !["supported", "contradicted", "insufficient"].includes(String(row.grounding)) ||
        !text(row.reason, 2100)) return unavailable;
    rankings.set(row.idx, row);
  }
  const options: TitleReviewOption[] = [];
  for (const [idx, raw] of receipt.candidates.entries()) {
    const candidate = record(raw), ranking = rankings.get(idx)!;
    if (!candidate || !text(candidate.title, 100)) return unavailable;
    options.push({ title: candidate.title, reason: ranking.reason as string,
      grounding: ranking.grounding as TitleReviewOption["grounding"],
      pull: ranking.clickScore as number, clarity: ranking.direct as number, identity: ranking.identityFit as number,
      selected: idx === receipt.winnerIndex, alternate: idx === receipt.alternateIndex });
  }
  const selected = options[receipt.winnerIndex];
  if (selected.title !== receipt.title || selected.pull !== receipt.clickScore ||
      selected.clarity !== receipt.directness ||
      (options.find((option) => option.alternate)?.title ?? "") !== receipt.titleAlternate) return unavailable;
  return { state: out.title === selected.title ? "recorded" : "title_changed",
    selected, options, source, attempts: receipt.attempts as number };
}
