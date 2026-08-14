import { createHash } from "node:crypto";
import { z } from "zod";

export const DATA_STORY_SOURCE_LEDGER_VERSION = "data-story-source-ledger/v1" as const;
const REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const identifier = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const text = z.string().trim().min(2).max(1_200);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 hex digest");

export const DataStoryLedgerSourceSchema = z.object({
  id: identifier,
  /** Exact spoken name, e.g. "U.S. Bureau of Labor Statistics". */
  name: z.string().trim().min(3).max(160),
  url: httpsUrl,
  /** Hash of the reviewed/downloaded source snapshot, never a model summary. */
  snapshotSha256: sha256,
});

export const DataStoryLedgerClaimSchema = z.object({
  id: identifier,
  sourceId: identifier,
  /** The approved, verbatim numeric value that may be spoken and rendered. */
  numericAnchor: z.string().trim().min(1).max(80).refine((value) => /\d/.test(value), "expected a numeric anchor"),
  context: text,
});

export const DataStoryLedgerReviewSchema = z.object({
  decision: z.literal("approved"),
  reviewerId: identifier,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
  reviewedLedgerFingerprint: sha256,
});

export const DataStorySourceLedgerSchema = z.object({
  version: z.literal(DATA_STORY_SOURCE_LEDGER_VERSION),
  topic: text,
  sources: z.array(DataStoryLedgerSourceSchema).min(1).max(24),
  claims: z.array(DataStoryLedgerClaimSchema).min(3).max(48),
  review: DataStoryLedgerReviewSchema,
});

export type DataStorySourceLedger = z.infer<typeof DataStorySourceLedgerSchema>;

export interface DataStoryLedgerIssue {
  code:
    | "malformed_ledger"
    | "duplicate_source"
    | "duplicate_claim"
    | "unknown_source"
    | "review_fingerprint_mismatch"
    | "review_stale"
    | "review_future"
    | "missing_numeric_source_sentence"
    | "unknown_spoken_source"
    | "unapproved_spoken_number";
  message: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function dataStorySourceLedgerFingerprint(ledger: Omit<DataStorySourceLedger, "review"> | DataStorySourceLedger): string {
  const { version, topic, sources, claims } = ledger;
  return createHash("sha256")
    .update(`data-story-source-ledger\0${canonical({ version, topic, sources, claims })}`)
    .digest("hex");
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sentenceList(narration: string): string[] {
  return narration.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

export function evaluateDataStorySourceLedger(
  value: unknown,
  narration?: string,
  now = Date.now(),
): { safe: boolean; issues: DataStoryLedgerIssue[]; ledger?: DataStorySourceLedger } {
  const parsed = DataStorySourceLedgerSchema.safeParse(value);
  if (!parsed.success) {
    return { safe: false, issues: [{ code: "malformed_ledger", message: "data-story source ledger is malformed" }] };
  }
  const ledger = parsed.data;
  const issues: DataStoryLedgerIssue[] = [];
  const sourceIds = new Set<string>();
  const sourceNames = new Set<string>();
  for (const source of ledger.sources) {
    if (sourceIds.has(source.id) || sourceNames.has(normalized(source.name))) {
      issues.push({ code: "duplicate_source", message: `duplicate source ${source.id}` });
    }
    sourceIds.add(source.id);
    sourceNames.add(normalized(source.name));
  }
  const claimIds = new Set<string>();
  for (const claim of ledger.claims) {
    if (claimIds.has(claim.id)) issues.push({ code: "duplicate_claim", message: `duplicate claim ${claim.id}` });
    claimIds.add(claim.id);
    if (!sourceIds.has(claim.sourceId)) {
      issues.push({ code: "unknown_source", message: `claim ${claim.id} references unknown source ${claim.sourceId}` });
    }
  }
  const reviewedAt = Date.parse(ledger.review.reviewedAt);
  if (ledger.review.reviewedLedgerFingerprint !== dataStorySourceLedgerFingerprint(ledger)) {
    issues.push({ code: "review_fingerprint_mismatch", message: "editorial approval is not bound to this exact source ledger" });
  }
  if (!Number.isFinite(reviewedAt) || reviewedAt > now + 5 * 60_000) {
    issues.push({ code: "review_future", message: "editorial approval timestamp is invalid or in the future" });
  } else if (now - reviewedAt > REVIEW_MAX_AGE_MS) {
    issues.push({ code: "review_stale", message: "editorial approval is older than 30 days" });
  }

  if (narration !== undefined) {
    const sentences = sentenceList(narration).filter((sentence) => /\d/.test(sentence));
    const approvedSources = ledger.sources.map((source) => ({ source, normalizedName: normalized(source.name) }));
    const approvedClaims = ledger.claims.map((claim) => ({ claim, normalizedAnchor: normalized(claim.numericAnchor) }));
    let approvedSentences = 0;
    for (const sentence of sentences) {
      const normalizedSentence = normalized(sentence);
      const namedSource = approvedSources.find(({ normalizedName }) => normalizedName && normalizedSentence.includes(normalizedName));
      if (!namedSource) {
        if (/\b(?:according to|data from|figures from)\b/i.test(sentence)) {
          issues.push({ code: "unknown_spoken_source", message: `narration names a source not present in the reviewed ledger: ${sentence.slice(0, 180)}` });
        }
        continue;
      }
      const matchingClaim = approvedClaims.find(({ claim, normalizedAnchor }) =>
        claim.sourceId === namedSource.source.id && normalizedAnchor && normalizedSentence.includes(normalizedAnchor),
      );
      if (!matchingClaim) {
        issues.push({ code: "unapproved_spoken_number", message: `narration uses an unapproved numeric anchor for ${namedSource.source.name}: ${sentence.slice(0, 180)}` });
        continue;
      }
      approvedSentences++;
    }
    if (approvedSentences < 3) {
      issues.push({ code: "missing_numeric_source_sentence", message: `narration has ${approvedSentences} reviewed source-bound numeric sentences; at least 3 are required` });
    }
  }
  return { safe: issues.length === 0, issues, ledger };
}

export function assertDataStorySourceLedger(value: unknown, narration?: string): DataStorySourceLedger {
  const report = evaluateDataStorySourceLedger(value, narration);
  if (!report.safe || !report.ledger) {
    throw new Error(`data-story source ledger rejected: ${report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
  }
  return report.ledger;
}

export function dataStorySourceLedgerPrompt(ledger: DataStorySourceLedger): string {
  return [
    "REVIEWED SOURCE LEDGER — factual narration may use ONLY these source-bound numeric anchors. Do not invent or paraphrase a number, source, quote, date, or causal claim outside this ledger.",
    ...ledger.claims.map((claim) => {
      const source = ledger.sources.find((candidate) => candidate.id === claim.sourceId)!;
      return `- ${claim.id}: say exactly \"${claim.numericAnchor}\" only when naming ${source.name}; approved context: ${claim.context}`;
    }),
  ].join("\n");
}
