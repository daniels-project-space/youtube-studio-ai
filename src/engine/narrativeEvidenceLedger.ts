import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Provider-free narrative semantics for already-reviewed factual evidence.
 *
 * This contract deliberately extends, rather than replaces, Editorial Evidence
 * Packets and Casefile source packets. Its evidence rails are immutable
 * references to those upstream packets; callers must still validate the
 * referenced packet and retain its source-use rights, safety, and claim rules.
 *
 * The ledger does not write a script, select footage, admit a channel, render,
 * publish, or turn factual work into an autonomous flow. It makes the editorial
 * judgement a downstream module needs explicit and reviewable: what is known,
 * what remains uncertain, what conflicts, what causal meaning may be stated,
 * and how a claim may (or may not) be visually presented.
 */
export const NARRATIVE_EVIDENCE_LEDGER_VERSION = "narrative-evidence-ledger/v1" as const;
export const NARRATIVE_EVIDENCE_LEDGER_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const identifier = z.string().trim().min(2).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const text = (maximum: number) => z.string().trim().min(2).max(maximum);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 hex digest");

/** The only upstream rail types this ledger can reference. */
export const NarrativeEvidenceRailKindSchema = z.enum([
  "editorial_evidence_packet",
  "casefile_source_packet",
]);
export type NarrativeEvidenceRailKind = z.infer<typeof NarrativeEvidenceRailKindSchema>;

/**
 * A compact, immutable reference to a previously reviewed evidence packet.
 * Source and claim IDs are repeated so a consumer can prove every narrative
 * support edge without attempting to reinterpret either upstream schema.
 */
export const NarrativeEvidenceRailSchema = z.object({
  id: identifier,
  kind: NarrativeEvidenceRailKindSchema,
  packetFingerprint: sha256,
  sourceIds: z.array(identifier).min(1).max(96),
  upstreamClaimIds: z.array(identifier).min(1).max(192),
}).strict();
export type NarrativeEvidenceRail = z.infer<typeof NarrativeEvidenceRailSchema>;

export const NarrativeEvidenceSupportSchema = z.object({
  railId: identifier,
  sourceIds: z.array(identifier).min(1).max(24),
  upstreamClaimIds: z.array(identifier).min(1).max(48),
}).strict();
export type NarrativeEvidenceSupport = z.infer<typeof NarrativeEvidenceSupportSchema>;

export const NarrativeEvidenceConfidenceSchema = z.enum(["high", "moderate", "limited"]);
export type NarrativeEvidenceConfidence = z.infer<typeof NarrativeEvidenceConfidenceSchema>;

export const NarrativeEvidenceUncertaintySchema = z.object({
  level: z.enum(["none", "qualified", "material", "unresolved"]),
  /** A concise statement of the remaining limit, not a hidden prompt. */
  summary: text(900),
}).strict();
export type NarrativeEvidenceUncertainty = z.infer<typeof NarrativeEvidenceUncertaintySchema>;

/** The narrative assertion state is distinct from confidence. */
export const NarrativeEvidenceAssertionStateSchema = z.enum([
  "established",
  "qualified",
  "contested",
  "unresolved",
]);
export type NarrativeEvidenceAssertionState = z.infer<typeof NarrativeEvidenceAssertionStateSchema>;

/** Closed causal vocabulary prevents a renderer from inferring stronger causation. */
export const NarrativeEvidenceCausalRoleSchema = z.enum([
  "context",
  "condition",
  "contributor",
  "direct_cause",
  "decision",
  "mechanism",
  "consequence",
  "correlation_only",
]);
export type NarrativeEvidenceCausalRole = z.infer<typeof NarrativeEvidenceCausalRoleSchema>;

/**
 * Each permitted treatment carries its safety/citation conditions. This is an
 * allow-list for later modules, not a selected render instruction.
 */
export const NarrativeEvidenceVisualTreatmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("source_proof"),
    onScreenCitation: z.literal(true),
    exactSourceAssetRequired: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("neutral_reenactment"),
    /** Must be presented as a reconstruction, never as observed fact. */
    visiblyLabeled: z.literal(true),
    disclosureText: text(180),
    anonymousDepictionOnly: z.literal(true),
    doesNotClaimDirectObservation: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("data_diagram"),
    onScreenCitation: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("map_timeline"),
    onScreenCitation: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("document_abstraction"),
    onScreenCitation: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal("ambient_context"),
    doesNotDepictClaimAsObserved: z.literal(true),
  }).strict(),
]);
export type NarrativeEvidenceVisualTreatment = z.infer<typeof NarrativeEvidenceVisualTreatmentSchema>;

export const NarrativeEvidenceClaimSchema = z.object({
  id: identifier,
  /** Exact reviewed sentence; a downstream writer may not broaden it. */
  approvedText: text(1_400),
  assertionState: NarrativeEvidenceAssertionStateSchema,
  confidence: NarrativeEvidenceConfidenceSchema,
  uncertainty: NarrativeEvidenceUncertaintySchema,
  causalRole: NarrativeEvidenceCausalRoleSchema,
  supports: z.array(NarrativeEvidenceSupportSchema).min(1).max(24),
  allowedVisualTreatments: z.array(NarrativeEvidenceVisualTreatmentSchema).min(1).max(8),
}).strict();
export type NarrativeEvidenceClaim = z.infer<typeof NarrativeEvidenceClaimSchema>;

/** Explicit links preserve competing accounts rather than flattening one away. */
export const NarrativeEvidenceClaimRelationSchema = z.object({
  id: identifier,
  kind: z.enum(["contradicts", "counterclaim", "qualifies"]),
  fromClaimId: identifier,
  toClaimId: identifier,
  explanation: text(900),
}).strict();
export type NarrativeEvidenceClaimRelation = z.infer<typeof NarrativeEvidenceClaimRelationSchema>;

export const NarrativeEvidenceLedgerReviewSchema = z.object({
  decision: z.literal("approved"),
  reviewerId: identifier,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
  reviewedLedgerFingerprint: sha256,
}).strict();
export type NarrativeEvidenceLedgerReview = z.infer<typeof NarrativeEvidenceLedgerReviewSchema>;

export const NarrativeEvidenceLedgerContentSchema = z.object({
  version: z.literal(NARRATIVE_EVIDENCE_LEDGER_VERSION),
  subject: text(240),
  evidenceRails: z.array(NarrativeEvidenceRailSchema).min(1).max(24),
  claims: z.array(NarrativeEvidenceClaimSchema).min(1).max(192),
  relations: z.array(NarrativeEvidenceClaimRelationSchema).max(384),
}).strict();
export type NarrativeEvidenceLedgerContent = z.infer<typeof NarrativeEvidenceLedgerContentSchema>;

export const NarrativeEvidenceLedgerSchema = NarrativeEvidenceLedgerContentSchema.extend({
  contentFingerprint: sha256,
  editorialReview: NarrativeEvidenceLedgerReviewSchema,
  /** This contract does not itself grant automatic admission or publishing. */
  release: z.literal("private_human_editorial_review_only"),
  requiresHumanEditorialReview: z.literal(true),
}).strict();
export type NarrativeEvidenceLedger = z.infer<typeof NarrativeEvidenceLedgerSchema>;

export type NarrativeEvidenceLedgerIssueCode =
  | "malformed_ledger"
  | "duplicate_rail"
  | "duplicate_rail_member"
  | "duplicate_claim"
  | "duplicate_support"
  | "unknown_support_rail"
  | "unknown_support_member"
  | "duplicate_visual_treatment"
  | "uncertainty_inconsistent"
  | "neutral_reenactment_blocked"
  | "duplicate_relation"
  | "unknown_relation_claim"
  | "self_relation"
  | "conflict_state_inconsistent"
  | "ledger_fingerprint_mismatch"
  | "review_fingerprint_mismatch"
  | "review_future"
  | "review_stale";

export interface NarrativeEvidenceLedgerIssue {
  code: NarrativeEvidenceLedgerIssueCode;
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

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function visualTreatmentKey(value: NarrativeEvidenceVisualTreatment): string {
  return value.kind;
}

/**
 * Order-insensitive canonical content. Editorially meaningful order belongs in
 * a downstream reviewed story plan, not this evidence ledger.
 */
export function canonicalNarrativeEvidenceLedgerContent(
  value: NarrativeEvidenceLedgerContent | Omit<NarrativeEvidenceLedger, "contentFingerprint" | "editorialReview" | "release" | "requiresHumanEditorialReview">,
): NarrativeEvidenceLedgerContent {
  const content = NarrativeEvidenceLedgerContentSchema.parse({
    version: value.version,
    subject: value.subject,
    evidenceRails: value.evidenceRails,
    claims: value.claims,
    relations: value.relations,
  });
  return {
    ...content,
    evidenceRails: content.evidenceRails
      .map((rail) => ({ ...rail, sourceIds: sorted(rail.sourceIds), upstreamClaimIds: sorted(rail.upstreamClaimIds) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    claims: content.claims
      .map((claim) => ({
        ...claim,
        supports: claim.supports
          .map((support) => ({ ...support, sourceIds: sorted(support.sourceIds), upstreamClaimIds: sorted(support.upstreamClaimIds) }))
          .sort((left, right) => left.railId.localeCompare(right.railId)),
        allowedVisualTreatments: [...claim.allowedVisualTreatments]
          .sort((left, right) => visualTreatmentKey(left).localeCompare(visualTreatmentKey(right))),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    relations: [...content.relations].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function narrativeEvidenceLedgerContentFingerprint(
  value: NarrativeEvidenceLedgerContent | Omit<NarrativeEvidenceLedger, "contentFingerprint" | "editorialReview" | "release" | "requiresHumanEditorialReview">,
): string {
  return createHash("sha256")
    .update(`narrative-evidence-ledger\0${canonicalJson(canonicalNarrativeEvidenceLedgerContent(value))}`)
    .digest("hex");
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function relationPairKey(relation: NarrativeEvidenceClaimRelation): string {
  if (relation.kind === "contradicts") {
    return `${relation.kind}:${sorted([relation.fromClaimId, relation.toClaimId]).join(":")}`;
  }
  return `${relation.kind}:${relation.fromClaimId}:${relation.toClaimId}`;
}

function isConflictRelation(relation: NarrativeEvidenceClaimRelation): boolean {
  return relation.kind === "contradicts" || relation.kind === "counterclaim";
}

function isNeutralReenactmentAllowed(
  claim: NarrativeEvidenceClaim,
  isConflicted: boolean,
): boolean {
  return claim.assertionState === "established"
    && claim.confidence !== "limited"
    && (claim.uncertainty.level === "none" || claim.uncertainty.level === "qualified")
    && claim.causalRole !== "correlation_only"
    && !isConflicted;
}

export function evaluateNarrativeEvidenceLedger(
  value: unknown,
  now = Date.now(),
): { safe: boolean; issues: NarrativeEvidenceLedgerIssue[]; ledger?: NarrativeEvidenceLedger } {
  const parsed = NarrativeEvidenceLedgerSchema.safeParse(value);
  if (!parsed.success) {
    return { safe: false, issues: [{ code: "malformed_ledger", message: "narrative evidence ledger is malformed" }] };
  }
  const ledger = parsed.data;
  const issues: NarrativeEvidenceLedgerIssue[] = [];
  const railsById = new Map<string, NarrativeEvidenceRail>();
  for (const rail of ledger.evidenceRails) {
    if (railsById.has(rail.id)) {
      issues.push({ code: "duplicate_rail", message: `duplicate evidence rail ${rail.id}` });
    }
    if (hasDuplicates(rail.sourceIds) || hasDuplicates(rail.upstreamClaimIds)) {
      issues.push({ code: "duplicate_rail_member", message: `evidence rail ${rail.id} repeats a source or upstream claim id` });
    }
    railsById.set(rail.id, rail);
  }

  const claimsById = new Map<string, NarrativeEvidenceClaim>();
  const conflictClaimIds = new Set<string>();
  const relationIds = new Set<string>();
  const relationPairs = new Set<string>();
  for (const relation of ledger.relations) {
    if (relationIds.has(relation.id) || relationPairs.has(relationPairKey(relation))) {
      issues.push({ code: "duplicate_relation", message: `duplicate narrative relation ${relation.id}` });
    }
    relationIds.add(relation.id);
    relationPairs.add(relationPairKey(relation));
  }
  for (const claim of ledger.claims) {
    if (claimsById.has(claim.id)) {
      issues.push({ code: "duplicate_claim", message: `duplicate narrative evidence claim ${claim.id}` });
    }
    claimsById.set(claim.id, claim);
  }
  for (const relation of ledger.relations) {
    const from = claimsById.get(relation.fromClaimId);
    const to = claimsById.get(relation.toClaimId);
    if (!from || !to) {
      issues.push({ code: "unknown_relation_claim", message: `relation ${relation.id} references an unknown claim` });
      continue;
    }
    if (relation.fromClaimId === relation.toClaimId) {
      issues.push({ code: "self_relation", message: `relation ${relation.id} cannot point a claim at itself` });
    }
    if (isConflictRelation(relation)) {
      conflictClaimIds.add(from.id);
      conflictClaimIds.add(to.id);
      if (from.assertionState === "established" && to.assertionState === "established") {
        issues.push({ code: "conflict_state_inconsistent", message: `conflicting relation ${relation.id} leaves both claims established` });
      }
    }
  }

  for (const claim of ledger.claims) {
    if ((claim.confidence === "high" && (claim.uncertainty.level === "material" || claim.uncertainty.level === "unresolved"))
      || (claim.confidence === "limited" && (claim.uncertainty.level === "none" || claim.uncertainty.level === "qualified"))
      || (claim.assertionState === "established" && claim.uncertainty.level === "unresolved")) {
      issues.push({ code: "uncertainty_inconsistent", message: `claim ${claim.id} has inconsistent confidence, assertion state, and uncertainty` });
    }
    const supportRailIds = claim.supports.map((support) => support.railId);
    if (hasDuplicates(supportRailIds)) {
      issues.push({ code: "duplicate_support", message: `claim ${claim.id} repeats an evidence rail support` });
    }
    for (const support of claim.supports) {
      const rail = railsById.get(support.railId);
      if (!rail) {
        issues.push({ code: "unknown_support_rail", message: `claim ${claim.id} references unknown evidence rail ${support.railId}` });
        continue;
      }
      if (hasDuplicates(support.sourceIds) || hasDuplicates(support.upstreamClaimIds)
        || support.sourceIds.some((id) => !rail.sourceIds.includes(id))
        || support.upstreamClaimIds.some((id) => !rail.upstreamClaimIds.includes(id))) {
        issues.push({ code: "unknown_support_member", message: `claim ${claim.id} has a source or upstream claim outside evidence rail ${rail.id}` });
      }
    }
    const treatmentKinds = claim.allowedVisualTreatments.map(visualTreatmentKey);
    if (hasDuplicates(treatmentKinds)) {
      issues.push({ code: "duplicate_visual_treatment", message: `claim ${claim.id} repeats an allowed visual treatment` });
    }
    if (claim.allowedVisualTreatments.some((treatment) => treatment.kind === "neutral_reenactment")
      && !isNeutralReenactmentAllowed(claim, conflictClaimIds.has(claim.id))) {
      issues.push({
        code: "neutral_reenactment_blocked",
        message: `claim ${claim.id} may use labeled neutral reenactment only when it is established, sufficiently certain, non-conflicted, and not correlation-only`,
      });
    }
  }

  const expectedFingerprint = narrativeEvidenceLedgerContentFingerprint(ledger);
  if (ledger.contentFingerprint !== expectedFingerprint) {
    issues.push({ code: "ledger_fingerprint_mismatch", message: "narrative evidence ledger content fingerprint does not match its content" });
  }
  if (ledger.editorialReview.reviewedLedgerFingerprint !== ledger.contentFingerprint) {
    issues.push({ code: "review_fingerprint_mismatch", message: "editorial review is not bound to this exact narrative evidence ledger" });
  }
  const reviewedAt = Date.parse(ledger.editorialReview.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt > now + 5 * 60_000) {
    issues.push({ code: "review_future", message: "narrative evidence review timestamp is invalid or in the future" });
  } else if (now - reviewedAt > NARRATIVE_EVIDENCE_LEDGER_REVIEW_MAX_AGE_MS) {
    issues.push({ code: "review_stale", message: "narrative evidence review is older than 30 days" });
  }
  return { safe: issues.length === 0, issues, ledger };
}

export function assertNarrativeEvidenceLedger(value: unknown, now = Date.now()): NarrativeEvidenceLedger {
  const report = evaluateNarrativeEvidenceLedger(value, now);
  if (!report.safe || !report.ledger) {
    throw new Error(`narrative evidence ledger rejected: ${report.issues.map((issue) => issue.message).join("; ")}`);
  }
  return report.ledger;
}

/** Build a self-validating, still-private ledger from editor-reviewed content. */
export function createNarrativeEvidenceLedger(args: {
  subject: string;
  evidenceRails: NarrativeEvidenceRail[];
  claims: NarrativeEvidenceClaim[];
  relations?: NarrativeEvidenceClaimRelation[];
  editorialReview: Pick<NarrativeEvidenceLedgerReview, "reviewerId" | "reviewId" | "reviewedAt">;
  now?: number;
}): NarrativeEvidenceLedger {
  const content = canonicalNarrativeEvidenceLedgerContent({
    version: NARRATIVE_EVIDENCE_LEDGER_VERSION,
    subject: args.subject,
    evidenceRails: args.evidenceRails,
    claims: args.claims,
    relations: args.relations ?? [],
  });
  const contentFingerprint = narrativeEvidenceLedgerContentFingerprint(content);
  return assertNarrativeEvidenceLedger({
    ...content,
    contentFingerprint,
    editorialReview: {
      decision: "approved",
      ...args.editorialReview,
      reviewedLedgerFingerprint: contentFingerprint,
    },
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  }, args.now);
}
