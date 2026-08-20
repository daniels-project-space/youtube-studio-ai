import { z } from "zod";

import { sha256Hex } from "@/lib/sha256";

import {
  evaluateDataStorySourceLedger,
} from "./dataStorySourceLedger";

/**
 * Reusable, editor-reviewed evidence core for factual explainer modules.
 *
 * This intentionally does not replace Casefile's source packet. Casefile has
 * additional claim grammar, source-use rights, reconstruction safety, and
 * claim-to-shot rules. This packet carries only the shared facts a factual
 * visual or narrated explainer needs: reviewed sources, approved claims, and
 * a fresh human-editorial signature over immutable source snapshots.
 */
export const EDITORIAL_EVIDENCE_PACKET_VERSION = "editorial-evidence-packet/v1" as const;
export const EDITORIAL_EVIDENCE_PACKET_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const identifier = z.string().trim().min(2).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const text = (maximum: number) => z.string().trim().min(2).max(maximum);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 hex digest");
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");

export const EditorialEvidenceSourceSchema = z.object({
  id: identifier,
  name: text(180),
  url: httpsUrl,
  /** Hash of the reviewed source snapshot, never a model summary. */
  snapshotSha256: sha256,
  kind: z.enum(["primary", "official", "dataset", "reference"]).default("primary"),
}).strict();
export type EditorialEvidenceSource = z.infer<typeof EditorialEvidenceSourceSchema>;

export const EditorialEvidenceClaimSchema = z.object({
  id: identifier,
  sourceIds: z.array(identifier).min(1).max(12),
  /** Exact bounded statement that may be used in a reviewed factual script. */
  approvedText: text(1_200),
  /** Optional literal numeric value; when present, it must be said exactly. */
  numericAnchor: z.string().trim().min(1).max(96).optional(),
  context: text(1_200),
}).strict();
export type EditorialEvidenceClaim = z.infer<typeof EditorialEvidenceClaimSchema>;

export const EditorialEvidenceReviewSchema = z.object({
  decision: z.literal("approved"),
  reviewerId: identifier,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
  reviewedPacketFingerprint: sha256,
}).strict();
export type EditorialEvidenceReview = z.infer<typeof EditorialEvidenceReviewSchema>;

export const EditorialEvidencePacketContentSchema = z.object({
  version: z.literal(EDITORIAL_EVIDENCE_PACKET_VERSION),
  subject: text(240),
  sources: z.array(EditorialEvidenceSourceSchema).min(1).max(48),
  claims: z.array(EditorialEvidenceClaimSchema).min(1).max(96),
}).strict();
export type EditorialEvidencePacketContent = z.infer<typeof EditorialEvidencePacketContentSchema>;

export const EditorialEvidencePacketSchema = EditorialEvidencePacketContentSchema.extend({
  contentFingerprint: sha256,
  review: EditorialEvidenceReviewSchema,
  /** Never grants automatic publishing or a generic factual-channel admission. */
  release: z.literal("private_human_editorial_review_only"),
  requiresHumanEditorialReview: z.literal(true),
}).strict();
export type EditorialEvidencePacket = z.infer<typeof EditorialEvidencePacketSchema>;

export type EditorialEvidencePacketIssueCode =
  | "malformed_packet"
  | "duplicate_source"
  | "duplicate_claim"
  | "unknown_claim_source"
  | "packet_fingerprint_mismatch"
  | "review_fingerprint_mismatch"
  | "review_future"
  | "review_stale";

export interface EditorialEvidencePacketIssue {
  code: EditorialEvidencePacketIssueCode;
  message: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function editorialEvidencePacketContentFingerprint(
  value: EditorialEvidencePacketContent | Omit<EditorialEvidencePacket, "contentFingerprint" | "review" | "release" | "requiresHumanEditorialReview">,
): string {
  const content = EditorialEvidencePacketContentSchema.parse({
    version: value.version,
    subject: value.subject,
    sources: value.sources,
    claims: value.claims,
  });
  return sha256Hex(`editorial-evidence-packet\0${canonicalJson(content)}`);
}

export function evaluateEditorialEvidencePacket(
  value: unknown,
  now = Date.now(),
): { safe: boolean; issues: EditorialEvidencePacketIssue[]; packet?: EditorialEvidencePacket } {
  const parsed = EditorialEvidencePacketSchema.safeParse(value);
  if (!parsed.success) {
    return { safe: false, issues: [{ code: "malformed_packet", message: "editorial evidence packet is malformed" }] };
  }
  const packet = parsed.data;
  const issues: EditorialEvidencePacketIssue[] = [];
  const sourceIds = new Set<string>();
  const sourceNames = new Set<string>();
  for (const source of packet.sources) {
    if (sourceIds.has(source.id) || sourceNames.has(normalized(source.name))) {
      issues.push({ code: "duplicate_source", message: `duplicate editorial evidence source ${source.id}` });
    }
    sourceIds.add(source.id);
    sourceNames.add(normalized(source.name));
  }
  const claimIds = new Set<string>();
  for (const claim of packet.claims) {
    if (claimIds.has(claim.id)) {
      issues.push({ code: "duplicate_claim", message: `duplicate editorial evidence claim ${claim.id}` });
    }
    claimIds.add(claim.id);
    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        issues.push({ code: "unknown_claim_source", message: `claim ${claim.id} references unknown source ${sourceId}` });
      }
    }
  }
  const expectedFingerprint = editorialEvidencePacketContentFingerprint(packet);
  if (packet.contentFingerprint !== expectedFingerprint) {
    issues.push({ code: "packet_fingerprint_mismatch", message: "editorial evidence packet content fingerprint does not match its sources and claims" });
  }
  if (packet.review.reviewedPacketFingerprint !== packet.contentFingerprint) {
    issues.push({ code: "review_fingerprint_mismatch", message: "editorial review is not bound to this exact evidence packet" });
  }
  const reviewedAt = Date.parse(packet.review.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt > now + 5 * 60_000) {
    issues.push({ code: "review_future", message: "editorial evidence review timestamp is invalid or in the future" });
  } else if (now - reviewedAt > EDITORIAL_EVIDENCE_PACKET_REVIEW_MAX_AGE_MS) {
    issues.push({ code: "review_stale", message: "editorial evidence review is older than 30 days" });
  }
  return { safe: issues.length === 0, issues, packet };
}

export function assertEditorialEvidencePacket(value: unknown, now = Date.now()): EditorialEvidencePacket {
  const report = evaluateEditorialEvidencePacket(value, now);
  if (!report.safe || !report.packet) {
    throw new Error(`editorial evidence packet rejected: ${report.issues.map((issue) => issue.message).join("; ")}`);
  }
  return report.packet;
}

/**
 * Losslessly projects an already-reviewed numeric Data Story ledger into the
 * common factual-evidence shape. It does not upgrade the result to autonomous
 * production: the packet keeps the original human-review-only release rail.
 */
export function editorialEvidencePacketFromDataStoryLedger(
  value: unknown,
  now = Date.now(),
): EditorialEvidencePacket {
  const report = evaluateDataStorySourceLedger(value, undefined, now);
  if (!report.safe || !report.ledger) {
    throw new Error(`data-story ledger cannot adapt into editorial evidence: ${report.issues.map((issue) => issue.message).join("; ")}`);
  }
  const ledger = report.ledger;
  return createEditorialEvidencePacket({
    subject: ledger.topic,
    sources: ledger.sources.map((source) => ({ ...source, kind: "dataset" as const })),
    claims: ledger.claims.map((claim) => ({
      id: claim.id,
      sourceIds: [claim.sourceId],
      approvedText: claim.context,
      numericAnchor: claim.numericAnchor,
      context: claim.context,
    })),
    review: {
      reviewerId: ledger.review.reviewerId,
      reviewId: ledger.review.reviewId,
      reviewedAt: ledger.review.reviewedAt,
    },
    now,
  });
}

/** Build a self-validating packet only from a reviewer identity and approved content. */
export function createEditorialEvidencePacket(args: {
  subject: string;
  sources: EditorialEvidenceSource[];
  claims: EditorialEvidenceClaim[];
  review: Pick<EditorialEvidenceReview, "reviewerId" | "reviewId" | "reviewedAt">;
  now?: number;
}): EditorialEvidencePacket {
  const content = EditorialEvidencePacketContentSchema.parse({
    version: EDITORIAL_EVIDENCE_PACKET_VERSION,
    subject: args.subject,
    sources: args.sources,
    claims: args.claims,
  });
  const contentFingerprint = editorialEvidencePacketContentFingerprint(content);
  return assertEditorialEvidencePacket({
    ...content,
    contentFingerprint,
    review: {
      decision: "approved",
      ...args.review,
      reviewedPacketFingerprint: contentFingerprint,
    },
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  }, args.now);
}
