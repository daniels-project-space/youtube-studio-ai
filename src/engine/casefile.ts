import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * A provider-independent, source-first contract for a factual Casefile episode.
 *
 * This deliberately stops before script generation or rendering. It is the
 * admission layer for a future documentary pipeline: every public-facing claim
 * has a ledger entry, visual rights are explicit, and sensitive material fails
 * closed before an editor can turn it into narration or a scene.
 */
export const CASEFILE_VERSION = "casefile/v1" as const;
export const CASEFILE_EVIDENCE_GRAMMAR_VERSION = "casefile-evidence-grammar/v1" as const;

/** Exact, visible wording required whenever an episode uses a reconstruction. */
export const RECONSTRUCTION_DISCLOSURE = "Dramatized reconstruction based on cited sources.";

const identifier = (prefix: string) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,95}$`), `expected ${prefix}-prefixed stable id`);

const text = (max: number) => z.string().trim().min(1).max(max);
const httpsLocator = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "expected an http(s) URL");

export const CasefileKindSchema = z.enum([
  "historical_heist",
  "systems_failure",
  "financial_fraud",
  "historical_crime",
  "disaster_investigation",
  "company_scandal",
]);
export type CasefileKind = z.infer<typeof CasefileKindSchema>;

export const CasefileStatusSchema = z.enum([
  "historical_closed",
  "historical_unresolved",
  "active_investigation",
  "allegations_pending",
]);
export type CasefileStatus = z.infer<typeof CasefileStatusSchema>;

export const CasefileSourceKindSchema = z.enum([
  "official_record",
  "court_record",
  "company_filing",
  "academic_research",
  "archival_news",
  "book",
  "interview",
  "rights_cleared_media",
]);
export type CasefileSourceKind = z.infer<typeof CasefileSourceKindSchema>;

/** Where the right to put source media on screen was established. */
export const CasefileRightsProvenanceSchema = z.enum([
  "public_domain",
  "creative_commons",
  "licensed",
  "permission_granted",
  "owned",
  "fair_use_reviewed",
  "unknown",
]);
export type CasefileRightsProvenance = z.infer<typeof CasefileRightsProvenanceSchema>;

/** Citation-only sources may support a claim, but must never be shown as media. */
export const CasefileVisualUseSchema = z.enum(["citation_only", "visual_clearance_confirmed"]);
export type CasefileVisualUse = z.infer<typeof CasefileVisualUseSchema>;

export const CasefileRightsSchema = z
  .object({
    provenance: CasefileRightsProvenanceSchema,
    visualUse: CasefileVisualUseSchema,
    /** URL to a licence, archive terms page, permission record, or fair-use memo. */
    evidenceLocator: httpsLocator.optional(),
  })
  .strict();
export type CasefileRights = z.infer<typeof CasefileRightsSchema>;

/**
 * The source ledger intentionally includes a quote/excerpt. A URL alone is not
 * enough to demonstrate that a claim is actually supported by that source.
 */
export const CasefileSourceSchema = z
  .object({
    id: identifier("source"),
    kind: CasefileSourceKindSchema,
    title: text(280),
    publisher: text(180),
    locator: httpsLocator,
    excerpt: text(2_000),
    rights: CasefileRightsSchema,
  })
  .strict();
export type CasefileSource = z.infer<typeof CasefileSourceSchema>;

/** Claim state is explicit so a pipeline cannot silently narrate an allegation as fact. */
export const CasefileClaimStateSchema = z.enum([
  "established",
  "contested",
  "alleged",
  "disputed",
  "exonerated",
]);
export type CasefileClaimState = z.infer<typeof CasefileClaimStateSchema>;

export const CasefileOperationalRiskSchema = z.enum(["none", "contextual", "actionable"]);
export type CasefileOperationalRisk = z.infer<typeof CasefileOperationalRiskSchema>;

export const CasefileClaimSchema = z
  .object({
    id: identifier("claim"),
    /** Stable chronology/causality ordering supplied by the editor. */
    order: z.number().int().min(0).max(10_000),
    text: text(800),
    state: CasefileClaimStateSchema,
    sourceIds: z.array(identifier("source")).min(1).max(12),
    /** Blocks a how-to reconstruction of a crime, exploit, or evasion. */
    operationalRisk: CasefileOperationalRiskSchema,
  })
  .strict();
export type CasefileClaim = z.infer<typeof CasefileClaimSchema>;

export const CasefileSensitivitySchema = z
  .object({
    activeAllegations: z.boolean(),
    involvesMinors: z.boolean(),
    includesGraphicDetail: z.boolean(),
    actionableWrongdoing: z.boolean(),
  })
  .strict();
export type CasefileSensitivity = z.infer<typeof CasefileSensitivitySchema>;

export const CasefileReconstructionModeSchema = z.enum([
  "none",
  "illustrated_reconstruction",
  "dramatized_reconstruction",
]);
export type CasefileReconstructionMode = z.infer<typeof CasefileReconstructionModeSchema>;

export const CasefileReconstructionSchema = z
  .object({
    mode: CasefileReconstructionModeSchema,
    /** Must equal RECONSTRUCTION_DISCLOSURE for either reconstruction mode. */
    disclosureText: text(180).optional(),
  })
  .strict();
export type CasefileReconstruction = z.infer<typeof CasefileReconstructionSchema>;

/** Optional presentation profile; it changes framing, never the evidence bar. */
export const CinemaScopeProfileSchema = z
  .object({
    aspectRatio: z.enum(["2.00:1", "2.35:1"]),
    frameRate: z.union([z.literal(24), z.literal(25), z.literal(30)]),
    titleSafeMarginPct: z.number().min(0.04).max(0.2),
    captionSafeMarginPct: z.number().min(0.08).max(0.25),
  })
  .strict();
export type CinemaScopeProfile = z.infer<typeof CinemaScopeProfileSchema>;

export const DEFAULT_CINEMA_SCOPE_PROFILE: CinemaScopeProfile = {
  aspectRatio: "2.35:1",
  frameRate: 25,
  titleSafeMarginPct: 0.1,
  captionSafeMarginPct: 0.14,
};

export const CasePacketSchema = z
  .object({
    version: z.literal(CASEFILE_VERSION),
    id: identifier("case"),
    title: text(180),
    kind: CasefileKindSchema,
    status: CasefileStatusSchema,
    /** The source-first ledger; claims reference these stable source IDs. */
    sourceLedger: z.array(CasefileSourceSchema).min(1).max(100),
    claims: z.array(CasefileClaimSchema).min(1).max(120),
    sensitivity: CasefileSensitivitySchema,
    reconstruction: CasefileReconstructionSchema,
    cinemaScope: CinemaScopeProfileSchema.optional(),
  })
  .strict();
export type CasePacket = z.infer<typeof CasePacketSchema>;

export const CasefileSafetyCodeSchema = z.enum([
  "active_case",
  "active_allegation",
  "minor_involved",
  "graphic_detail",
  "actionable_wrongdoing",
  "unsupported_claim",
  "unresolved_claim_state",
  "duplicate_source_id",
  "invalid_visual_rights",
  "reconstruction_disclosure_missing",
]);
export type CasefileSafetyCode = z.infer<typeof CasefileSafetyCodeSchema>;

export const CasefileSafetyIssueSchema = z
  .object({
    code: CasefileSafetyCodeSchema,
    message: text(500),
    sourceId: identifier("source").optional(),
    claimId: identifier("claim").optional(),
  })
  .strict();
export type CasefileSafetyIssue = z.infer<typeof CasefileSafetyIssueSchema>;

export const CasefileSafetyReportSchema = z
  .object({
    safe: z.boolean(),
    requiresHumanEditorialReview: z.boolean(),
    issues: z.array(CasefileSafetyIssueSchema),
  })
  .strict();
export type CasefileSafetyReport = z.infer<typeof CasefileSafetyReportSchema>;

export const CasefileEvidencePurposeSchema = z.enum([
  "context",
  "causal_evidence",
  "outcome",
]);
export type CasefileEvidencePurpose = z.infer<typeof CasefileEvidencePurposeSchema>;

/** A treatment has an explicit distinction between source media and original explanation. */
export const CasefileEvidenceTreatmentSchema = z.enum([
  "source_document",
  "source_archival_media",
  "timeline",
  "map",
  "diagram",
  "data_card",
  "original_illustration",
  "dramatized_reconstruction",
]);
export type CasefileEvidenceTreatment = z.infer<typeof CasefileEvidenceTreatmentSchema>;

export const CasefileEvidenceSceneSchema = z
  .object({
    id: identifier("evidence-scene"),
    order: z.number().int().min(0),
    purpose: CasefileEvidencePurposeSchema,
    claimId: identifier("claim"),
    sourceId: identifier("source"),
    treatment: CasefileEvidenceTreatmentSchema,
    /** A casefile scene is never allowed to hide its supporting source. */
    onScreenCitation: z.literal(true),
    citation: z
      .object({
        sourceId: identifier("source"),
        label: text(480),
        locator: httpsLocator,
      })
      .strict(),
    /** Exact disclosure wording is required for dramatized_reconstruction. */
    reconstructionDisclosure: text(180).optional(),
  })
  .strict();
export type CasefileEvidenceScene = z.infer<typeof CasefileEvidenceSceneSchema>;

export const CasefileEvidenceGrammarSchema = z
  .object({
    version: z.literal(CASEFILE_EVIDENCE_GRAMMAR_VERSION),
    caseId: identifier("case"),
    packetFingerprint: z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint"),
    cinemaScope: CinemaScopeProfileSchema.optional(),
    scenes: z.array(CasefileEvidenceSceneSchema).min(1),
  })
  .strict();
export type CasefileEvidenceGrammar = z.infer<typeof CasefileEvidenceGrammarSchema>;

function issue(
  code: CasefileSafetyCode,
  message: string,
  refs: Pick<CasefileSafetyIssue, "sourceId" | "claimId"> = {},
): CasefileSafetyIssue {
  return CasefileSafetyIssueSchema.parse({ code, message, ...refs });
}

function safetyForPacket(packet: CasePacket): CasefileSafetyReport {
  const issues: CasefileSafetyIssue[] = [];
  const sourcesById = new Map<string, CasefileSource>();

  for (const source of packet.sourceLedger) {
    if (sourcesById.has(source.id)) {
      issues.push(issue("duplicate_source_id", `Source ledger contains duplicate source id ${source.id}.`, { sourceId: source.id }));
      continue;
    }
    sourcesById.set(source.id, source);

    if (
      source.rights.visualUse === "visual_clearance_confirmed" &&
      (source.rights.provenance === "unknown" || !source.rights.evidenceLocator)
    ) {
      issues.push(
        issue(
          "invalid_visual_rights",
          `Source ${source.id} claims visual clearance without auditable rights provenance and evidence.`,
          { sourceId: source.id },
        ),
      );
    }
  }

  if (packet.status === "active_investigation" || packet.status === "allegations_pending") {
    issues.push(issue("active_case", "Active investigations and pending allegations are not eligible for automated casefile production."));
  }
  if (packet.sensitivity.activeAllegations) {
    issues.push(issue("active_allegation", "The packet contains active allegations and must not enter the automated documentary lane."));
  }
  if (packet.sensitivity.involvesMinors) {
    issues.push(issue("minor_involved", "Cases involving minors require a separate human-led process and are blocked here."));
  }
  if (packet.sensitivity.includesGraphicDetail) {
    issues.push(issue("graphic_detail", "Graphic detail is blocked from the automated casefile lane."));
  }
  if (packet.sensitivity.actionableWrongdoing) {
    issues.push(issue("actionable_wrongdoing", "Actionable wrongdoing detail is blocked from the automated casefile lane."));
  }

  for (const claim of packet.claims) {
    if (claim.state !== "established") {
      issues.push(
        issue(
          "unresolved_claim_state",
          `Claim ${claim.id} is ${claim.state}; only established claims are eligible for automated narration.`,
          { claimId: claim.id },
        ),
      );
    }
    if (claim.operationalRisk === "actionable") {
      issues.push(
        issue(
          "actionable_wrongdoing",
          `Claim ${claim.id} carries actionable operational detail and cannot be rendered automatically.`,
          { claimId: claim.id },
        ),
      );
    }
    for (const sourceId of new Set(claim.sourceIds)) {
      if (!sourcesById.has(sourceId)) {
        issues.push(
          issue(
            "unsupported_claim",
            `Claim ${claim.id} references source ${sourceId}, which is absent from the source ledger.`,
            { claimId: claim.id, sourceId },
          ),
        );
      }
    }
  }

  if (
    packet.reconstruction.mode !== "none" &&
    packet.reconstruction.disclosureText !== RECONSTRUCTION_DISCLOSURE
  ) {
    issues.push(
      issue(
        "reconstruction_disclosure_missing",
        "Every reconstruction must carry the exact visible reconstruction disclosure before scene planning.",
      ),
    );
  }

  return CasefileSafetyReportSchema.parse({
    safe: issues.length === 0,
    requiresHumanEditorialReview:
      issues.length > 0 || packet.status === "historical_unresolved" || packet.reconstruction.mode !== "none",
    issues,
  });
}

/** Structural parse only; use assertCasefilePacket before automation or rendering. */
export function parseCasePacket(value: unknown): CasePacket {
  return CasePacketSchema.parse(value);
}

/** Deterministic safety admission report. It performs no network or provider work. */
export function evaluateCasefileSafety(value: unknown): CasefileSafetyReport {
  return safetyForPacket(parseCasePacket(value));
}

/**
 * Contextual validation: claims must resolve to ledger sources and sensitive
 * material must fail closed. This is the required admission function for a
 * downstream script, scene, or upload module.
 */
export function assertCasefilePacket(value: unknown): CasePacket {
  const packet = parseCasePacket(value);
  const report = safetyForPacket(packet);
  if (!report.safe) {
    throw new Error(
      `casefile safety gate blocked: ${report.issues.map((item) => `${item.code}: ${item.message}`).join(" | ")}`,
    );
  }
  return packet;
}

function normalizedPacketForFingerprint(packet: CasePacket) {
  return {
    version: packet.version,
    id: packet.id,
    title: packet.title,
    kind: packet.kind,
    status: packet.status,
    sourceLedger: [...packet.sourceLedger]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((source) => ({
        id: source.id,
        kind: source.kind,
        title: source.title,
        publisher: source.publisher,
        locator: source.locator,
        excerpt: source.excerpt,
        rights: {
          provenance: source.rights.provenance,
          visualUse: source.rights.visualUse,
          ...(source.rights.evidenceLocator ? { evidenceLocator: source.rights.evidenceLocator } : {}),
        },
      })),
    claims: [...packet.claims]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((claim) => ({ ...claim, sourceIds: [...claim.sourceIds].sort() })),
    sensitivity: packet.sensitivity,
    reconstruction: packet.reconstruction,
    ...(packet.cinemaScope ? { cinemaScope: packet.cinemaScope } : {}),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Content-addresses the normalized ledger so a later scene plan is traceable to its facts. */
export function casefileFingerprint(value: unknown): string {
  const packet = parseCasePacket(value);
  return createHash("sha256").update(canonicalJson(normalizedPacketForFingerprint(packet))).digest("hex");
}

function isSourceMediaTreatment(treatment: CasefileEvidenceTreatment): boolean {
  return treatment === "source_document" || treatment === "source_archival_media";
}

function defaultTreatment(source: CasefileSource): CasefileEvidenceTreatment {
  if (source.rights.visualUse !== "visual_clearance_confirmed") return "timeline";
  return source.kind === "rights_cleared_media" || source.kind === "archival_news"
    ? "source_archival_media"
    : "source_document";
}

function purposeFor(index: number, count: number): CasefileEvidencePurpose {
  if (index === 0) return "context";
  if (index === count - 1) return "outcome";
  return "causal_evidence";
}

/**
 * Compiles a conservative evidence grammar: one cited source-to-scene mapping
 * for every established claim. It never invents a reenactment or reuses a
 * citation-only source as media.
 */
export function compileCasefileEvidenceGrammar(value: unknown): CasefileEvidenceGrammar {
  const packet = assertCasefilePacket(value);
  const sourcesById = new Map(packet.sourceLedger.map((source) => [source.id, source]));
  const claims = [...packet.claims].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  const grammar = CasefileEvidenceGrammarSchema.parse({
    version: CASEFILE_EVIDENCE_GRAMMAR_VERSION,
    caseId: packet.id,
    packetFingerprint: casefileFingerprint(packet),
    ...(packet.cinemaScope ? { cinemaScope: packet.cinemaScope } : {}),
    scenes: claims.map((claim, index) => {
      const source = [...claim.sourceIds]
        .map((sourceId) => sourcesById.get(sourceId))
        .filter((candidate): candidate is CasefileSource => Boolean(candidate))
        .sort(
          (left, right) =>
            Number(right.rights.visualUse === "visual_clearance_confirmed") -
              Number(left.rights.visualUse === "visual_clearance_confirmed") ||
            left.id.localeCompare(right.id),
        )[0];
      if (!source) {
        // assertCasefilePacket already closes this path; keep the compiler total.
        throw new Error(`casefile compiler could not resolve a source for ${claim.id}`);
      }
      return {
        id: `evidence-scene-${claim.id.slice("claim-".length)}`,
        order: index,
        purpose: purposeFor(index, claims.length),
        claimId: claim.id,
        sourceId: source.id,
        treatment: defaultTreatment(source),
        onScreenCitation: true as const,
        citation: {
          sourceId: source.id,
          label: `${source.publisher}: ${source.title}`,
          locator: source.locator,
        },
      };
    }),
  });

  return assertCasefileEvidenceGrammar(packet, grammar);
}

/**
 * Ensures a supplied scene grammar stays attached to the exact CasePacket and
 * cannot turn citation-only research into visual media or hide a reconstruction.
 */
export function assertCasefileEvidenceGrammar(
  packetValue: unknown,
  grammarValue: unknown,
): CasefileEvidenceGrammar {
  const packet = assertCasefilePacket(packetValue);
  const grammar = CasefileEvidenceGrammarSchema.parse(grammarValue);
  if (grammar.caseId !== packet.id) {
    throw new Error(`casefile evidence grammar caseId ${grammar.caseId} does not match packet ${packet.id}`);
  }
  if (grammar.packetFingerprint !== casefileFingerprint(packet)) {
    throw new Error("casefile evidence grammar fingerprint does not match its source packet");
  }
  if (JSON.stringify(grammar.cinemaScope) !== JSON.stringify(packet.cinemaScope)) {
    throw new Error("casefile evidence grammar cinemaScope profile does not match its source packet");
  }

  const sourcesById = new Map(packet.sourceLedger.map((source) => [source.id, source]));
  const claimsById = new Map(packet.claims.map((claim) => [claim.id, claim]));
  const sceneIds = new Set<string>();
  const coveredClaims = new Set<string>();

  for (const scene of grammar.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`casefile evidence grammar has duplicate scene ${scene.id}`);
    sceneIds.add(scene.id);
    if (coveredClaims.has(scene.claimId)) throw new Error(`casefile evidence grammar covers claim ${scene.claimId} more than once`);
    coveredClaims.add(scene.claimId);

    const claim = claimsById.get(scene.claimId);
    if (!claim) throw new Error(`casefile evidence grammar references unknown claim ${scene.claimId}`);
    if (!claim.sourceIds.includes(scene.sourceId)) {
      throw new Error(`scene ${scene.id} maps claim ${scene.claimId} to a source outside its ledger evidence`);
    }
    const source = sourcesById.get(scene.sourceId);
    if (!source) throw new Error(`scene ${scene.id} references unknown source ${scene.sourceId}`);
    if (
      scene.citation.sourceId !== source.id ||
      scene.citation.locator !== source.locator ||
      scene.citation.label !== `${source.publisher}: ${source.title}`
    ) {
      throw new Error(`scene ${scene.id} has a citation that does not match source ${source.id}`);
    }
    if (isSourceMediaTreatment(scene.treatment) && source.rights.visualUse !== "visual_clearance_confirmed") {
      throw new Error(`scene ${scene.id} cannot use citation-only source ${source.id} as visual media`);
    }
    if (scene.treatment === "dramatized_reconstruction") {
      if (packet.reconstruction.mode === "none" || packet.reconstruction.disclosureText !== RECONSTRUCTION_DISCLOSURE) {
        throw new Error(`scene ${scene.id} requires an approved reconstruction policy and disclosure`);
      }
      if (scene.reconstructionDisclosure !== RECONSTRUCTION_DISCLOSURE) {
        throw new Error(`scene ${scene.id} is missing the required visible reconstruction disclosure`);
      }
    } else if (scene.reconstructionDisclosure) {
      throw new Error(`scene ${scene.id} declares a reconstruction disclosure without a reconstruction treatment`);
    }
  }

  for (const claim of packet.claims) {
    if (!coveredClaims.has(claim.id)) {
      throw new Error(`casefile evidence grammar leaves claim ${claim.id} without a source-to-scene mapping`);
    }
  }
  return grammar;
}
