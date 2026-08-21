import { sha256Hex } from "@/lib/sha256";

/**
 * A deliberately local, lexical self-deduplication record for narration.
 *
 * This is not an embedding, semantic-similarity, or visual-originality
 * assessment. It only compares deterministic word shingles retained by this
 * channel's own R2 corpus. That narrower claim is intentional: a successful
 * check means the script was measured against the retained lexical corpus,
 * not that the finished video is universally "original".
 */
export const LOCAL_SCRIPT_SELF_DEDUP_RECEIPT_VERSION = "local-script-self-dedup/v1" as const;
export const LOCAL_SCRIPT_SELF_DEDUP_INDEX_VERSION = "local-script-self-dedup-index/v1" as const;
export const LOCAL_SCRIPT_LEXICAL_CORPUS_ENTRY_VERSION = "local-script-lexical-corpus/v1" as const;
export const LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE = 5;
export const DEFAULT_LOCAL_SCRIPT_SELF_DEDUP_THRESHOLD = 0.92;

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export type ScriptSelfDedupCorpusSource =
  | "empty"
  | "local_script_index"
  | "legacy_embedding_index";

export interface LocalScriptLexicalCorpusEntry {
  kind: "local_script_lexical";
  version: typeof LOCAL_SCRIPT_LEXICAL_CORPUS_ENTRY_VERSION;
  canonicalScriptSha256: string;
  lexicalShingleHashes: string[];
  shingleSize: typeof LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE;
  runId: string;
  topic: string;
  recordedAtMs: number;
}

/** The retired embedding-index shape is retained but never compared. */
export interface LegacyEmbeddingCorpusEntry {
  ts?: number;
  runId?: string;
  topic?: string;
  vector: number[];
  [key: string]: unknown;
}

export interface LegacyUnmeasuredCorpusEntry {
  kind: "legacy_embedding_vector_unmeasured";
  raw: LegacyEmbeddingCorpusEntry;
}

export type ScriptSelfDedupCorpusEntry =
  | LocalScriptLexicalCorpusEntry
  | LegacyUnmeasuredCorpusEntry;

export interface ParsedScriptSelfDedupCorpus {
  entries: ScriptSelfDedupCorpusEntry[];
  comparableEntries: LocalScriptLexicalCorpusEntry[];
  legacyUnmeasuredEntries: LegacyUnmeasuredCorpusEntry[];
}

export interface LocalScriptSelfDedupReceipt {
  version: typeof LOCAL_SCRIPT_SELF_DEDUP_RECEIPT_VERSION;
  checkStatus: "measured";
  comparisonMethod: "lexical-shingle-jaccard/v1";
  corpusSource: ScriptSelfDedupCorpusSource;
  canonicalScriptSha256: string;
  lexicalTokenCount: number;
  shingleSize: typeof LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE;
  candidateLexicalShingleCount: number;
  comparableCorpusEntries: number;
  legacyUnmeasuredCorpusEntries: number;
  highestLexicalShingleSimilarity: number;
  nearestComparable: {
    canonicalScriptSha256: string;
    runId: string;
    topic: string;
    lexicalShingleSimilarity: number;
  } | null;
  threshold: number;
  passesLexicalSelfDedup: boolean;
}

export interface LocalScriptSelfDedupEvaluation {
  receipt: LocalScriptSelfDedupReceipt;
  candidate: {
    canonicalScriptSha256: string;
    lexicalShingleHashes: string[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function uniqueSortedHashes(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isSha256)) return undefined;
  return [...new Set(value.map((hash) => hash.toLowerCase()))].sort();
}

function parseLocalEntry(value: unknown): LocalScriptLexicalCorpusEntry | undefined {
  if (!isRecord(value) || value.kind !== "local_script_lexical") return undefined;
  const hashes = uniqueSortedHashes(value.lexicalShingleHashes);
  if (
    value.version !== LOCAL_SCRIPT_LEXICAL_CORPUS_ENTRY_VERSION
    || !isSha256(value.canonicalScriptSha256)
    || !hashes
    || value.shingleSize !== LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE
    || typeof value.runId !== "string"
    || typeof value.topic !== "string"
    || !isFiniteNumber(value.recordedAtMs)
    || value.recordedAtMs < 0
  ) {
    throw new Error("local script self-dedup corpus contains an invalid lexical entry");
  }
  return {
    kind: "local_script_lexical",
    version: LOCAL_SCRIPT_LEXICAL_CORPUS_ENTRY_VERSION,
    canonicalScriptSha256: value.canonicalScriptSha256.toLowerCase(),
    lexicalShingleHashes: hashes,
    shingleSize: LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE,
    runId: value.runId,
    topic: value.topic,
    recordedAtMs: value.recordedAtMs,
  };
}

function parseLegacyEmbeddingEntry(value: unknown): LegacyEmbeddingCorpusEntry | undefined {
  if (!isRecord(value) || !Array.isArray(value.vector) || !value.vector.every(isFiniteNumber)) return undefined;
  return value as LegacyEmbeddingCorpusEntry;
}

function partitionCorpus(entries: ScriptSelfDedupCorpusEntry[]): ParsedScriptSelfDedupCorpus {
  const comparableEntries = entries.filter(
    (entry): entry is LocalScriptLexicalCorpusEntry => entry.kind === "local_script_lexical",
  );
  const legacyUnmeasuredEntries = entries.filter(
    (entry): entry is LegacyUnmeasuredCorpusEntry => entry.kind === "legacy_embedding_vector_unmeasured",
  );
  return { entries, comparableEntries, legacyUnmeasuredEntries };
}

/**
 * Parses the versioned local corpus document and the retired array-only
 * embedding index. Legacy vectors are deliberately carried forward as opaque,
 * unmeasured entries: they must never be mistaken for lexical evidence.
 */
export function parseScriptSelfDedupCorpusDocument(document: unknown): ParsedScriptSelfDedupCorpus {
  const rawEntries = Array.isArray(document)
    ? document
    : isRecord(document)
      && document.version === LOCAL_SCRIPT_SELF_DEDUP_INDEX_VERSION
      && Array.isArray(document.entries)
      ? document.entries
      : undefined;
  if (!rawEntries) {
    throw new Error("local script self-dedup corpus has an unsupported document shape");
  }

  const entries = rawEntries.map((entry) => {
    const local = parseLocalEntry(entry);
    if (local) return local;
    const legacy = parseLegacyEmbeddingEntry(entry);
    if (legacy) return { kind: "legacy_embedding_vector_unmeasured", raw: legacy } as const;
    throw new Error("local script self-dedup corpus contains an unsupported entry");
  });
  return partitionCorpus(entries);
}

/** Serialize the corpus without transforming its legacy raw entries. */
export function serializeScriptSelfDedupCorpus(corpus: ParsedScriptSelfDedupCorpus): string {
  return JSON.stringify({
    version: LOCAL_SCRIPT_SELF_DEDUP_INDEX_VERSION,
    entries: corpus.entries.map((entry) => (
      entry.kind === "local_script_lexical" ? entry : entry.raw
    )),
  });
}

export function canonicalizeScriptForSelfDedup(script: string): string {
  if (typeof script !== "string") throw new Error("local script self-dedup requires text");
  return script
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

function lexicalTokens(canonicalScript: string): string[] {
  return canonicalScript.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function lexicalShingleHashes(tokens: readonly string[]): string[] {
  const shingles: string[] = [];
  if (tokens.length <= LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE) {
    shingles.push(tokens.join(" "));
  } else {
    for (let index = 0; index <= tokens.length - LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE; index += 1) {
      shingles.push(tokens.slice(index, index + LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE).join(" "));
    }
  }
  return [...new Set(shingles.map(sha256Hex))].sort();
}

function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function roundedSimilarity(value: number): number {
  return Number(value.toFixed(6));
}

function assertThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error("local script self-dedup threshold must be a number in (0, 1]");
  }
}

/**
 * Runs a real, deterministic local comparison. An empty corpus is still a
 * measurement: the candidate's canonical hash and shingles were computed and
 * compared against zero retained lexical entries.
 */
export function evaluateLocalScriptSelfDedup(args: {
  script: string;
  corpus: ParsedScriptSelfDedupCorpus;
  corpusSource: ScriptSelfDedupCorpusSource;
  threshold?: number;
}): LocalScriptSelfDedupEvaluation {
  const threshold = args.threshold ?? DEFAULT_LOCAL_SCRIPT_SELF_DEDUP_THRESHOLD;
  assertThreshold(threshold);
  const canonicalScript = canonicalizeScriptForSelfDedup(args.script);
  const tokens = lexicalTokens(canonicalScript);
  if (!tokens.length) throw new Error("local script self-dedup requires at least one lexical token");
  const candidate = {
    canonicalScriptSha256: sha256Hex(canonicalScript),
    lexicalShingleHashes: lexicalShingleHashes(tokens),
  };

  let highestLexicalShingleSimilarity = 0;
  let nearestComparable: LocalScriptSelfDedupReceipt["nearestComparable"] = null;
  for (const entry of args.corpus.comparableEntries) {
    const similarity = roundedSimilarity(jaccardSimilarity(candidate.lexicalShingleHashes, entry.lexicalShingleHashes));
    const candidateNearest = {
      canonicalScriptSha256: entry.canonicalScriptSha256,
      runId: entry.runId,
      topic: entry.topic,
      lexicalShingleSimilarity: similarity,
    };
    if (
      similarity > highestLexicalShingleSimilarity
      || (similarity === highestLexicalShingleSimilarity
        && similarity > 0
        && (!nearestComparable
          || `${candidateNearest.canonicalScriptSha256}:${candidateNearest.runId}`
            < `${nearestComparable.canonicalScriptSha256}:${nearestComparable.runId}`))
    ) {
      highestLexicalShingleSimilarity = similarity;
      nearestComparable = candidateNearest;
    }
  }

  const receipt: LocalScriptSelfDedupReceipt = {
    version: LOCAL_SCRIPT_SELF_DEDUP_RECEIPT_VERSION,
    checkStatus: "measured",
    comparisonMethod: "lexical-shingle-jaccard/v1",
    corpusSource: args.corpusSource,
    canonicalScriptSha256: candidate.canonicalScriptSha256,
    lexicalTokenCount: tokens.length,
    shingleSize: LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE,
    candidateLexicalShingleCount: candidate.lexicalShingleHashes.length,
    comparableCorpusEntries: args.corpus.comparableEntries.length,
    legacyUnmeasuredCorpusEntries: args.corpus.legacyUnmeasuredEntries.length,
    highestLexicalShingleSimilarity,
    nearestComparable,
    threshold,
    passesLexicalSelfDedup: highestLexicalShingleSimilarity < threshold,
  };
  return { receipt, candidate };
}

export function createLocalScriptLexicalCorpusEntry(args: {
  candidate: LocalScriptSelfDedupEvaluation["candidate"];
  runId: string;
  topic: string;
  recordedAtMs: number;
}): LocalScriptLexicalCorpusEntry {
  if (!args.runId) throw new Error("local script self-dedup corpus entry requires runId");
  if (!Number.isFinite(args.recordedAtMs) || args.recordedAtMs < 0) {
    throw new Error("local script self-dedup corpus entry requires a finite recordedAtMs");
  }
  return {
    kind: "local_script_lexical",
    version: LOCAL_SCRIPT_LEXICAL_CORPUS_ENTRY_VERSION,
    canonicalScriptSha256: args.candidate.canonicalScriptSha256,
    lexicalShingleHashes: args.candidate.lexicalShingleHashes,
    shingleSize: LOCAL_SCRIPT_LEXICAL_SHINGLE_SIZE,
    runId: args.runId,
    topic: args.topic,
    recordedAtMs: args.recordedAtMs,
  };
}

export function appendScriptSelfDedupCorpusEntry(
  corpus: ParsedScriptSelfDedupCorpus,
  entry: LocalScriptLexicalCorpusEntry,
  maxEntries = 200,
): ParsedScriptSelfDedupCorpus {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("local script self-dedup corpus maxEntries must be a positive integer");
  }
  // Keep vector-only history intact during migration. It is explicitly
  // non-comparable, but dropping it on the first local write would erase the
  // audit trail that explains why older uploads were not compared.
  const retainedLexicalEntries = [...corpus.comparableEntries, entry].slice(-maxEntries);
  return partitionCorpus([...corpus.legacyUnmeasuredEntries, ...retainedLexicalEntries]);
}

export function assertLocalScriptSelfDedupPass(receipt: LocalScriptSelfDedupReceipt): void {
  if (receipt.passesLexicalSelfDedup) return;
  const nearest = receipt.nearestComparable;
  const prior = nearest
    ? `run ${nearest.runId || "unknown"}${nearest.topic ? ` (${nearest.topic})` : ""}`
    : "the retained lexical corpus";
  throw new Error(
    `originality_gate FAILED: local lexical script self-dedup measured ${(receipt.highestLexicalShingleSimilarity * 100).toFixed(1)}% overlap with ${prior} (threshold ${(receipt.threshold * 100).toFixed(1)}%). Revise the literal wording or structure before continuing.`,
  );
}
