import { createHash } from "node:crypto";

import { z } from "zod";

import {
  assertCasefilePacket,
  CasePacketSchema,
  CasefileRightsProvenanceSchema,
  casefileFingerprint,
  compileCasefileEvidenceGrammar,
  type CasePacket,
  type CasefileEvidenceGrammar,
} from "./casefile";

/**
 * Provider-free admission for source-first documentary work.
 *
 * `casefile_source_packet` is deliberately narrower than a channel family: it
 * converts an operator-supplied Case Packet into a renderer-safe receipt only
 * after every claim has a primary-source route, every source's intended media
 * use is declared, and a fresh human editorial decision is pinned to the
 * packet fingerprint. Future source-first documentary lanes can reuse the
 * receipt without inheriting a crime-specific renderer or planner.
 */
export const CASEFILE_SOURCE_PACKET_VERSION = "casefile-source-packet/v1" as const;
export const CASEFILE_SOURCE_ADMISSION_VERSION = "casefile-source-admission/v1" as const;
export const CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS = 30;
const CASEFILE_EDITORIAL_REVIEW_MAX_AGE_MS =
  CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_REVIEW_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const identifier = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`), `expected ${prefix}- prefixed identifier`);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");

/** Only these Casefile source kinds are treated as primary evidence. */
export const CasefilePrimarySourceProvenanceSchema = z.enum([
  "official_record",
  "court_record",
  "company_filing",
  "academic_research",
]);

const CasefileClaimPrimarySourceSchema = z
  .object({
    claimId: identifier("claim"),
    sourceId: identifier("source"),
    /** Must exactly equal the audited source ledger locator. */
    primarySourceUrl: httpsUrl,
    /** Must exactly equal the linked Casefile source kind. */
    provenance: CasefilePrimarySourceProvenanceSchema,
  })
  .strict();

const CasefileSourceUsageSchema = z
  .object({
    sourceId: identifier("source"),
    /** Citation-only sources cannot silently become visual media downstream. */
    usage: z.enum(["citation_only", "visual_media"]),
    /** Required only when the source is actually used as visual media. */
    assetId: identifier("asset").optional(),
    /**
     * Must be the source ledger's rights evidence. It is mandatory for a
     * non-public-domain visual asset, even where its source record otherwise
     * looks rights-cleared.
     */
    rightsEvidenceLocator: httpsUrl.optional(),
  })
  .strict();

/** A real, packet-bound editorial decision — intentionally not a boolean. */
const CasefileEditorialReviewSchema = z
  .object({
    id: identifier("editorial-review"),
    decision: z.literal("approved"),
    reviewerId: identifier("reviewer"),
    reviewedAt: z.string().datetime({ offset: true }),
    reviewedPacketFingerprint: sha256,
    /** Binds the primary-source and source-use declarations, not just the Case Packet. */
    reviewedSourcePacketFingerprint: sha256,
  })
  .strict();

export const CasefileSourcePacketSchema = z
  .object({
    version: z.literal(CASEFILE_SOURCE_PACKET_VERSION),
    /** Explicit duplicate of Case Packet id prevents accidental cross-case reuse. */
    caseId: identifier("case"),
    casePacket: CasePacketSchema,
    /** At least one auditable primary source must support every narrated claim. */
    claimPrimarySources: z.array(CasefileClaimPrimarySourceSchema).min(1).max(500),
    /** Exhaustive source-use ledger: no source can be used visually by implication. */
    sourceUsage: z.array(CasefileSourceUsageSchema).min(1).max(500),
    editorialReview: CasefileEditorialReviewSchema,
  })
  .strict();

/** The editorial review is intentionally excluded from its own signed content. */
export const CasefileSourcePacketContentSchema = CasefileSourcePacketSchema
  .omit({ editorialReview: true })
  .strict();

export type CasefileSourcePacket = z.infer<typeof CasefileSourcePacketSchema>;
export type CasefileClaimPrimarySource = z.infer<typeof CasefileClaimPrimarySourceSchema>;
export type CasefileSourceUsage = z.infer<typeof CasefileSourceUsageSchema>;
export type CasefileEditorialReview = z.infer<typeof CasefileEditorialReviewSchema>;

const CasefileSourceAdmissionIssueCodeSchema = z.enum([
  "case_identifier_missing",
  "case_packet_invalid",
  "case_packet_safety_blocked",
  "claim_primary_source_missing",
  "claim_primary_source_invalid",
  "source_usage_missing",
  "source_usage_invalid",
  "asset_rights_evidence_missing",
  "editorial_review_missing",
  "editorial_review_packet_mismatch",
  "editorial_review_source_packet_mismatch",
  "editorial_review_stale",
]);

export type CasefileSourceAdmissionIssueCode = z.infer<typeof CasefileSourceAdmissionIssueCodeSchema>;

export interface CasefileSourceAdmissionIssue {
  code: CasefileSourceAdmissionIssueCode;
  message: string;
  remediation: string;
}

export interface CasefileSourceAdmissionReport {
  safe: boolean;
  issues: CasefileSourceAdmissionIssue[];
}

export const CasefileSourceAdmissionReceiptSchema = z
  .object({
    version: z.literal(CASEFILE_SOURCE_ADMISSION_VERSION),
    caseId: identifier("case"),
    casePacketFingerprint: sha256,
    sourcePacketFingerprint: sha256,
    evidenceGrammarFingerprint: sha256,
    claimPrimarySourceCount: z.number().int().positive(),
    sourceUsageCount: z.number().int().positive(),
    editorialReview: CasefileEditorialReviewSchema,
    /** This module can only make a private, human-reviewed documentary draft. */
    release: z.literal("private_human_editorial_review_only"),
    requiresHumanEditorialReview: z.literal(true),
  })
  .strict();

export type CasefileSourceAdmissionReceipt = z.infer<typeof CasefileSourceAdmissionReceiptSchema>;

export interface AdmittedCasefileSourcePacket {
  packet: CasefileSourcePacket;
  casePacket: CasePacket;
  evidenceGrammar: CasefileEvidenceGrammar;
  receipt: CasefileSourceAdmissionReceipt;
}

function issue(
  code: CasefileSourceAdmissionIssueCode,
  message: string,
  remediation: string,
): CasefileSourceAdmissionIssue {
  return { code, message, remediation };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Stable editor-review target. It deliberately excludes editorialReview so a
 * reviewer can sign the payload without creating a self-referential hash, but
 * includes every operator-controlled declaration that changes what may be
 * narrated or shown.
 */
export function casefileSourcePacketContentFingerprint(
  value: Pick<
    CasefileSourcePacket,
    "version" | "caseId" | "casePacket" | "claimPrimarySources" | "sourceUsage"
  >,
): string {
  const packet = CasefileSourcePacketContentSchema.parse({
    version: value.version,
    caseId: value.caseId,
    casePacket: value.casePacket,
    claimPrimarySources: value.claimPrimarySources,
    sourceUsage: value.sourceUsage,
  });
  return fingerprint({
    version: packet.version,
    caseId: packet.caseId,
    casePacketFingerprint: casefileFingerprint(packet.casePacket),
    claimPrimarySources: [...packet.claimPrimarySources].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    ),
    sourceUsage: [...packet.sourceUsage].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    ),
  });
}

function schemaIssues(value: unknown): CasefileSourceAdmissionIssue[] {
  const parsed = CasefileSourcePacketSchema.safeParse(value);
  if (parsed.success) return [];
  const paths = parsed.error.issues.map((entry) => entry.path.map(String));
  const includesPath = (field: string) => paths.some((path) => path.includes(field));
  const issues: CasefileSourceAdmissionIssue[] = [];
  if (includesPath("caseId") || includesPath("casePacket")) {
    issues.push(
      issue(
        "case_identifier_missing",
        "The source packet must contain a valid caseId and a valid Case Packet.",
        "Supply a case- prefixed identifier and the complete casePacket it names.",
      ),
    );
  }
  if (includesPath("claimPrimarySources")) {
    issues.push(
      issue(
        "claim_primary_source_missing",
        "Every claim needs a claim-level primary-source URL and provenance record.",
        "Add one linked official/court/filing/research source record for every claim.",
      ),
    );
  }
  if (includesPath("sourceUsage")) {
    issues.push(
      issue(
        "source_usage_missing",
        "Every source must declare whether it is citation-only or visual media.",
        "Add one sourceUsage record for every source in the Case Packet ledger.",
      ),
    );
  }
  if (includesPath("editorialReview")) {
    issues.push(
      issue(
        "editorial_review_missing",
        "A structured human editorial approval receipt is required.",
        "Provide approved review id, reviewer id, reviewedAt, and the reviewed Case Packet fingerprint.",
      ),
    );
  }
  if (!issues.length) {
    issues.push(
      issue(
        "case_packet_invalid",
        "The source packet does not conform to the source-first documentary schema.",
        "Correct the packet schema errors before retrying source admission.",
      ),
    );
  }
  return issues;
}

function parseReviewedAt(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function uniqueIssues(issues: readonly CasefileSourceAdmissionIssue[]): CasefileSourceAdmissionIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Evaluate without side effects. This is intentionally available to UIs and
 * channel creation surfaces so they can show specific operator remediation
 * before a pipeline ever starts.
 */
export function evaluateCasefileSourcePacket(
  value: unknown,
  options: { now?: Date } = {},
): CasefileSourceAdmissionReport {
  const schema = CasefileSourcePacketSchema.safeParse(value);
  if (!schema.success) {
    const issues = schemaIssues(value);
    return { safe: false, issues };
  }

  const packet = schema.data;
  const issues: CasefileSourceAdmissionIssue[] = [];
  let casePacket: CasePacket | undefined;
  try {
    casePacket = assertCasefilePacket(packet.casePacket);
  } catch (error) {
    issues.push(
      issue(
        "case_packet_safety_blocked",
        error instanceof Error ? error.message : "The Case Packet did not pass its safety gate.",
        "Resolve every Case Packet safety issue before requesting documentary source admission.",
      ),
    );
  }
  if (!casePacket) return { safe: false, issues: uniqueIssues(issues) };

  if (packet.caseId !== casePacket.id) {
    issues.push(
      issue(
        "case_identifier_missing",
        `Source packet caseId ${packet.caseId} does not match Case Packet ${casePacket.id}.`,
        "Use the exact Case Packet id so evidence and review cannot cross cases.",
      ),
    );
  }

  const sourcesById = new Map(casePacket.sourceLedger.map((source) => [source.id, source]));
  const claimsById = new Map(casePacket.claims.map((claim) => [claim.id, claim]));
  const primaryByClaim = new Map<string, number>();
  const primaryPairs = new Set<string>();
  for (const primary of packet.claimPrimarySources) {
    const pair = `${primary.claimId}:${primary.sourceId}`;
    if (primaryPairs.has(pair)) {
      issues.push(
        issue(
          "claim_primary_source_invalid",
          `Claim ${primary.claimId} repeats primary source ${primary.sourceId}.`,
          "Keep each claim/source primary-evidence link unique.",
        ),
      );
      continue;
    }
    primaryPairs.add(pair);
    const claim = claimsById.get(primary.claimId);
    const source = sourcesById.get(primary.sourceId);
    if (!claim || !source) {
      issues.push(
        issue(
          "claim_primary_source_invalid",
          `Primary evidence links unknown claim/source pair ${primary.claimId}/${primary.sourceId}.`,
          "Reference only claim and source ids present in this Case Packet.",
        ),
      );
      continue;
    }
    if (!claim.sourceIds.includes(source.id)) {
      issues.push(
        issue(
          "claim_primary_source_invalid",
          `Primary source ${source.id} is not in claim ${claim.id}'s evidence ledger.`,
          "Add the source to the claim's sourceIds before approving it as primary evidence.",
        ),
      );
    }
    if (!CasefilePrimarySourceProvenanceSchema.options.includes(source.kind as never)) {
      issues.push(
        issue(
          "claim_primary_source_invalid",
          `Source ${source.id} is ${source.kind}, not an allowed primary-source provenance type.`,
          "Use an official record, court record, company filing, or academic research source for this claim.",
        ),
      );
    }
    if (primary.provenance !== source.kind || primary.primarySourceUrl !== source.locator) {
      issues.push(
        issue(
          "claim_primary_source_invalid",
          `Claim ${claim.id}'s primary-source URL/provenance does not match source ${source.id}.`,
          "Copy the exact locator and provenance from the Case Packet source ledger.",
        ),
      );
    }
    primaryByClaim.set(claim.id, (primaryByClaim.get(claim.id) ?? 0) + 1);
  }
  for (const claim of casePacket.claims) {
    if (!primaryByClaim.has(claim.id)) {
      issues.push(
        issue(
          "claim_primary_source_missing",
          `Claim ${claim.id} has no primary-source URL/provenance record.`,
          "Add at least one primary source linked to this exact claim.",
        ),
      );
    }
  }

  const usageBySource = new Map<string, CasefileSourceUsage>();
  for (const usage of packet.sourceUsage) {
    if (usageBySource.has(usage.sourceId)) {
      issues.push(
        issue(
          "source_usage_invalid",
          `Source ${usage.sourceId} has more than one usage declaration.`,
          "Declare one explicit use per Case Packet source; split sources before adding multiple assets.",
        ),
      );
      continue;
    }
    usageBySource.set(usage.sourceId, usage);
    const source = sourcesById.get(usage.sourceId);
    if (!source) {
      issues.push(
        issue(
          "source_usage_invalid",
          `Usage declaration references unknown source ${usage.sourceId}.`,
          "Reference only sources in this Case Packet ledger.",
        ),
      );
      continue;
    }
    if (usage.usage === "visual_media") {
      if (!usage.assetId) {
        issues.push(
          issue(
            "source_usage_invalid",
            `Visual source ${source.id} has no stable asset id.`,
            "Assign a stable asset- id before a renderer can consume the source visually.",
          ),
        );
      }
      if (source.rights.visualUse !== "visual_clearance_confirmed") {
        issues.push(
          issue(
            "source_usage_invalid",
            `Citation-only source ${source.id} cannot be promoted to visual media.`,
            "Keep it citation-only or attach confirmed visual clearance in the Case Packet.",
          ),
        );
      }
      const nonPublicDomain = source.rights.provenance !== "public_domain";
      if (
        source.rights.provenance === "unknown" ||
        (nonPublicDomain && (!usage.rightsEvidenceLocator || !source.rights.evidenceLocator))
      ) {
        issues.push(
          issue(
            "asset_rights_evidence_missing",
            `Non-public-domain visual source ${source.id} lacks a bound rights/usage evidence record.`,
            "Attach the source's rights evidence URL and repeat it in this sourceUsage declaration, or keep the source citation-only.",
          ),
        );
      }
      if (
        usage.rightsEvidenceLocator &&
        usage.rightsEvidenceLocator !== source.rights.evidenceLocator
      ) {
        issues.push(
          issue(
            "asset_rights_evidence_missing",
            `Visual source ${source.id} uses rights evidence that does not match its Case Packet ledger.`,
            "Use the exact evidenceLocator from the source's rights record.",
          ),
        );
      }
    } else if (usage.assetId || usage.rightsEvidenceLocator) {
      issues.push(
        issue(
          "source_usage_invalid",
          `Citation-only source ${source.id} may not declare a visual asset or visual-rights evidence.`,
          "Remove visual fields or change the source to a properly rights-cleared visual-media use.",
        ),
      );
    }
  }
  for (const source of casePacket.sourceLedger) {
    if (!usageBySource.has(source.id)) {
      issues.push(
        issue(
          "source_usage_missing",
          `Source ${source.id} has no explicit citation/visual usage declaration.`,
          "Add a sourceUsage entry for every Case Packet source.",
        ),
      );
    }
  }

  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(packet.editorialReview.reviewedAt);
  const packetFingerprint = casefileFingerprint(casePacket);
  const sourcePacketFingerprint = casefileSourcePacketContentFingerprint(packet);
  if (packet.editorialReview.reviewedPacketFingerprint !== packetFingerprint) {
    issues.push(
      issue(
        "editorial_review_packet_mismatch",
        "The editorial approval was not issued for this exact Case Packet fingerprint.",
        "Have an editor review this precise packet again after every evidence, rights, or claim change.",
      ),
    );
  }
  if (packet.editorialReview.reviewedSourcePacketFingerprint !== sourcePacketFingerprint) {
    issues.push(
      issue(
        "editorial_review_source_packet_mismatch",
        "The editorial approval was not issued for this exact primary-source and source-usage declaration set.",
        "Have an editor review this precise source-admission content again after every primary-source or source-usage change.",
      ),
    );
  }
  if (
    !reviewedAt ||
    reviewedAt.getTime() > now.getTime() + FUTURE_REVIEW_CLOCK_SKEW_MS ||
    now.getTime() - reviewedAt.getTime() > CASEFILE_EDITORIAL_REVIEW_MAX_AGE_MS
  ) {
    issues.push(
      issue(
        "editorial_review_stale",
        `Editorial approval must be a valid, non-future review no older than ${CASEFILE_EDITORIAL_REVIEW_MAX_AGE_DAYS} days.`,
        "Obtain a fresh human editorial review bound to this unchanged Case Packet.",
      ),
    );
  }

  return { safe: issues.length === 0, issues: uniqueIssues(issues) };
}

/** Throws a remediation-rich error and returns only a fully bound draft receipt. */
export function assertCasefileSourcePacket(
  value: unknown,
  options: { now?: Date } = {},
): AdmittedCasefileSourcePacket {
  const report = evaluateCasefileSourcePacket(value, options);
  if (!report.safe) {
    throw new Error(
      `casefile source packet admission blocked: ${report.issues
        .map((entry) => `${entry.code}: ${entry.message} Remediation: ${entry.remediation}`)
        .join(" | ")}`,
    );
  }
  const packet = CasefileSourcePacketSchema.parse(value);
  const casePacket = assertCasefilePacket(packet.casePacket);
  const evidenceGrammar = compileCasefileEvidenceGrammar(casePacket);
  const receipt = CasefileSourceAdmissionReceiptSchema.parse({
    version: CASEFILE_SOURCE_ADMISSION_VERSION,
    caseId: casePacket.id,
    casePacketFingerprint: casefileFingerprint(casePacket),
    sourcePacketFingerprint: casefileSourcePacketContentFingerprint(packet),
    evidenceGrammarFingerprint: fingerprint(evidenceGrammar),
    claimPrimarySourceCount: packet.claimPrimarySources.length,
    sourceUsageCount: packet.sourceUsage.length,
    editorialReview: packet.editorialReview,
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  });
  return { packet, casePacket, evidenceGrammar, receipt };
}
