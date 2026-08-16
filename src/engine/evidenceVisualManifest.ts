/**
 * Provider-free provenance contract for factual charts and geo visuals.
 *
 * A source ledger can prove that narration may say a number, but it cannot
 * prove that every plotted point, coordinate, unit, or on-screen attribution
 * came from that source. This manifest is the renderer-facing proof layer:
 * factual pixels may use only its reviewed values. It deliberately contains no
 * planner, provider, renderer, or admission decision.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const EVIDENCE_VISUAL_MANIFEST_VERSION = "evidence-visual-manifest/v1" as const;
export const EVIDENCE_VISUAL_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const identifier = z.string().trim().min(2).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const sentenceId = z.string().trim().min(2).max(160).regex(/^sentence-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sceneId = z.string().trim().min(2).max(160).regex(/^scene-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (maximum: number) => z.string().trim().min(2).max(maximum);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 hex digest");
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "expected an https URL");

export const EvidenceVisualKindSchema = z.enum(["chart", "geo_map"]);
export type EvidenceVisualKind = z.infer<typeof EvidenceVisualKindSchema>;

/** Explicit marker required before a renderer treats a chart/map as factual. */
export const EvidenceVisualIntentSchema = z.enum(["factual_chart", "factual_geo"]);
export type EvidenceVisualIntent = z.infer<typeof EvidenceVisualIntentSchema>;

export const EvidenceVisualSurfaceSchema = z.enum(["scene_compiler", "data_insert"]);
export type EvidenceVisualSurface = z.infer<typeof EvidenceVisualSurfaceSchema>;

export const EvidenceVisualSourceSchema = z.object({
  id: identifier,
  name: text(180),
  url: httpsUrl,
  /** Hash of the reviewed/downloaded original, never a model summary. */
  snapshotSha256: sha256,
}).strict();
export type EvidenceVisualSource = z.infer<typeof EvidenceVisualSourceSchema>;

export const EvidenceVisualNarrationAnchorSchema = z.object({
  id: identifier,
  sentenceId,
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().positive(),
  /** Exact reviewed sentence or bounded spoken excerpt. */
  spokenText: text(1_200),
  /** The source wording which must be visibly and audibly attributed. */
  requiredAttribution: text(240),
  sourceIds: z.array(identifier).min(1).max(12),
}).strict().refine((anchor) => anchor.endSec > anchor.startSec, "narration anchor end must follow start");
export type EvidenceVisualNarrationAnchor = z.infer<typeof EvidenceVisualNarrationAnchorSchema>;

export const EvidenceVisualValueSchema = z.object({
  id: identifier,
  sourceId: identifier,
  narrationAnchorId: identifier,
  /** Semantic role prevents latitude/longitude or chart series points being swapped. */
  role: z.enum(["x", "y", "series", "metric", "latitude", "longitude"]),
  value: z.number().finite(),
  /** Never infer units from a bare numeric value. */
  unit: text(64),
  /** Exact human-readable form that must occur in the approved spoken anchor. */
  display: text(96),
  label: text(160).optional(),
}).strict();
export type EvidenceVisualValue = z.infer<typeof EvidenceVisualValueSchema>;

export const EvidenceVisualAttributionSchema = z.object({
  /** The renderer must display this verbatim while the visual is on screen. */
  visibleText: text(300),
  sourceIds: z.array(identifier).min(1).max(24),
}).strict();
export type EvidenceVisualAttribution = z.infer<typeof EvidenceVisualAttributionSchema>;

export const EvidenceVisualReviewSchema = z.object({
  decision: z.literal("approved"),
  reviewerId: identifier,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
  reviewedManifestFingerprint: sha256,
}).strict();
export type EvidenceVisualReview = z.infer<typeof EvidenceVisualReviewSchema>;

export const EvidenceVisualManifestSchema = z.object({
  version: z.literal(EVIDENCE_VISUAL_MANIFEST_VERSION),
  id: identifier,
  visualKind: EvidenceVisualKindSchema,
  surface: EvidenceVisualSurfaceSchema,
  /** `scene_compiler` uses the stable scene id; data inserts bind by narration anchors. */
  targetSceneId: sceneId.optional(),
  sources: z.array(EvidenceVisualSourceSchema).min(1).max(24),
  narrationAnchors: z.array(EvidenceVisualNarrationAnchorSchema).min(1).max(48),
  values: z.array(EvidenceVisualValueSchema).min(1).max(256),
  attribution: EvidenceVisualAttributionSchema,
  review: EvidenceVisualReviewSchema,
}).strict();
export type EvidenceVisualManifest = z.infer<typeof EvidenceVisualManifestSchema>;

export interface EvidenceVisualReceipt {
  version: "evidence-visual-receipt/v1";
  manifestId: string;
  manifestFingerprint: string;
  visualKind: EvidenceVisualKind;
  surface: EvidenceVisualSurface;
  targetSceneId?: string;
  sourceIds: string[];
  sourceSnapshotSha256: Record<string, string>;
  narrationAnchorIds: string[];
  requiredAttribution: string;
  valueIds: string[];
  reviewedAt: string;
}

export type EvidenceVisualIssueCode =
  | "malformed_manifest"
  | "duplicate_source"
  | "duplicate_anchor"
  | "duplicate_value"
  | "unknown_source"
  | "unknown_anchor"
  | "anchor_source_mismatch"
  | "missing_unit"
  | "value_not_spoken"
  | "missing_required_attribution"
  | "attribution_source_mismatch"
  | "chart_shape_invalid"
  | "geo_shape_invalid"
  | "scene_target_missing"
  | "scene_target_mismatch"
  | "scene_anchor_mismatch"
  | "review_fingerprint_mismatch"
  | "review_stale"
  | "review_future";

export interface EvidenceVisualIssue {
  code: EvidenceVisualIssueCode;
  message: string;
}

export interface EvidenceVisualValidationContext {
  sceneId?: string;
  narrationSentenceIds?: readonly string[];
  now?: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function containsVerbatim(haystack: string, needle: string): boolean {
  return compact(haystack).includes(compact(needle));
}

export function evidenceVisualManifestFingerprint(
  manifest: Omit<EvidenceVisualManifest, "review"> | EvidenceVisualManifest,
): string {
  const { version, id, visualKind, surface, targetSceneId, sources, narrationAnchors, values, attribution } = manifest;
  return createHash("sha256")
    .update(`evidence-visual-manifest\0${canonical({ version, id, visualKind, surface, targetSceneId, sources, narrationAnchors, values, attribution })}`)
    .digest("hex");
}

export function factualVisualKindForIntent(intent: EvidenceVisualIntent): EvidenceVisualKind {
  return intent === "factual_chart" ? "chart" : "geo_map";
}

export function evaluateEvidenceVisualManifest(
  value: unknown,
  context: EvidenceVisualValidationContext = {},
): { safe: boolean; issues: EvidenceVisualIssue[]; manifest?: EvidenceVisualManifest; receipt?: EvidenceVisualReceipt } {
  const parsed = EvidenceVisualManifestSchema.safeParse(value);
  if (!parsed.success) {
    return { safe: false, issues: [{ code: "malformed_manifest", message: "evidence visual manifest is malformed" }] };
  }
  const manifest = parsed.data;
  const issues: EvidenceVisualIssue[] = [];
  const sourceIds = new Set<string>();
  const anchorsById = new Map<string, EvidenceVisualNarrationAnchor>();
  const valueIds = new Set<string>();

  for (const source of manifest.sources) {
    if (sourceIds.has(source.id)) issues.push({ code: "duplicate_source", message: `duplicate source ${source.id}` });
    sourceIds.add(source.id);
  }
  for (const anchor of manifest.narrationAnchors) {
    if (anchorsById.has(anchor.id)) issues.push({ code: "duplicate_anchor", message: `duplicate narration anchor ${anchor.id}` });
    anchorsById.set(anchor.id, anchor);
    for (const sourceId of anchor.sourceIds) {
      if (!sourceIds.has(sourceId)) issues.push({ code: "unknown_source", message: `anchor ${anchor.id} references unknown source ${sourceId}` });
    }
    if (!containsVerbatim(anchor.spokenText, anchor.requiredAttribution)) {
      issues.push({ code: "missing_required_attribution", message: `anchor ${anchor.id} does not contain its required attribution` });
    }
  }
  for (const visualValue of manifest.values) {
    if (valueIds.has(visualValue.id)) issues.push({ code: "duplicate_value", message: `duplicate value ${visualValue.id}` });
    valueIds.add(visualValue.id);
    if (!sourceIds.has(visualValue.sourceId)) {
      issues.push({ code: "unknown_source", message: `value ${visualValue.id} references unknown source ${visualValue.sourceId}` });
    }
    const anchor = anchorsById.get(visualValue.narrationAnchorId);
    if (!anchor) {
      issues.push({ code: "unknown_anchor", message: `value ${visualValue.id} references unknown narration anchor ${visualValue.narrationAnchorId}` });
      continue;
    }
    if (!anchor.sourceIds.includes(visualValue.sourceId)) {
      issues.push({ code: "anchor_source_mismatch", message: `value ${visualValue.id} source is not approved by anchor ${anchor.id}` });
    }
    if (!visualValue.unit.trim()) {
      issues.push({ code: "missing_unit", message: `value ${visualValue.id} has no explicit unit` });
    }
    if (!containsVerbatim(anchor.spokenText, visualValue.display)) {
      issues.push({ code: "value_not_spoken", message: `value ${visualValue.id} display is absent from its narration anchor` });
    }
  }

  const attributionSources = new Set(manifest.attribution.sourceIds);
  for (const sourceId of attributionSources) {
    if (!sourceIds.has(sourceId)) issues.push({ code: "unknown_source", message: `attribution references unknown source ${sourceId}` });
  }
  for (const source of manifest.sources.filter((candidate) => attributionSources.has(candidate.id))) {
    if (!containsVerbatim(manifest.attribution.visibleText, source.name)) {
      issues.push({ code: "attribution_source_mismatch", message: `visible attribution omits source ${source.id}` });
    }
  }
  for (const anchor of manifest.narrationAnchors) {
    for (const sourceId of anchor.sourceIds) {
      if (!attributionSources.has(sourceId)) {
        issues.push({ code: "attribution_source_mismatch", message: `visible attribution omits anchor source ${sourceId}` });
      }
    }
    if (!containsVerbatim(manifest.attribution.visibleText, anchor.requiredAttribution)) {
      issues.push({ code: "missing_required_attribution", message: `visible attribution omits anchor attribution ${anchor.id}` });
    }
  }

  if (manifest.visualKind === "chart" && manifest.values.filter((item) => item.role === "series" || item.role === "y" || item.role === "metric").length < 2) {
    issues.push({ code: "chart_shape_invalid", message: "factual chart needs at least two reviewed plotted values" });
  }
  if (manifest.visualKind === "geo_map") {
    const latitude = manifest.values.filter((item) => item.role === "latitude").length;
    const longitude = manifest.values.filter((item) => item.role === "longitude").length;
    if (latitude === 0 || latitude !== longitude) {
      issues.push({ code: "geo_shape_invalid", message: "factual geo map needs paired reviewed latitude and longitude values" });
    }
  }

  if (manifest.surface === "scene_compiler" && !manifest.targetSceneId) {
    issues.push({ code: "scene_target_missing", message: "scene compiler evidence visual needs a targetSceneId" });
  }
  if (context.sceneId) {
    if (manifest.surface !== "scene_compiler" || manifest.targetSceneId !== context.sceneId) {
      issues.push({ code: "scene_target_mismatch", message: `manifest ${manifest.id} is not bound to scene ${context.sceneId}` });
    }
    const allowedSentenceIds = new Set(context.narrationSentenceIds ?? []);
    if (allowedSentenceIds.size === 0 || manifest.narrationAnchors.some((anchor) => !allowedSentenceIds.has(anchor.sentenceId))) {
      issues.push({ code: "scene_anchor_mismatch", message: `manifest ${manifest.id} narration anchors are not bound to the scene's timed sentences` });
    }
  }

  const now = context.now ?? Date.now();
  const reviewedAt = Date.parse(manifest.review.reviewedAt);
  if (manifest.review.reviewedManifestFingerprint !== evidenceVisualManifestFingerprint(manifest)) {
    issues.push({ code: "review_fingerprint_mismatch", message: "review approval is not bound to this exact evidence visual manifest" });
  }
  if (!Number.isFinite(reviewedAt) || reviewedAt > now + 5 * 60_000) {
    issues.push({ code: "review_future", message: "review timestamp is invalid or in the future" });
  } else if (now - reviewedAt > EVIDENCE_VISUAL_REVIEW_MAX_AGE_MS) {
    issues.push({ code: "review_stale", message: "evidence visual review is older than 30 days" });
  }

  if (issues.length > 0) return { safe: false, issues, manifest };
  const receipt: EvidenceVisualReceipt = {
    version: "evidence-visual-receipt/v1",
    manifestId: manifest.id,
    manifestFingerprint: evidenceVisualManifestFingerprint(manifest),
    visualKind: manifest.visualKind,
    surface: manifest.surface,
    ...(manifest.targetSceneId ? { targetSceneId: manifest.targetSceneId } : {}),
    sourceIds: [...sourceIds].sort(),
    sourceSnapshotSha256: Object.fromEntries(manifest.sources.map((source) => [source.id, source.snapshotSha256])),
    narrationAnchorIds: manifest.narrationAnchors.map((anchor) => anchor.id).sort(),
    requiredAttribution: manifest.attribution.visibleText,
    valueIds: manifest.values.map((item) => item.id).sort(),
    reviewedAt: manifest.review.reviewedAt,
  };
  return { safe: true, issues, manifest, receipt };
}

export function assertEvidenceVisualManifest(
  value: unknown,
  context: EvidenceVisualValidationContext = {},
): EvidenceVisualManifest {
  const report = evaluateEvidenceVisualManifest(value, context);
  if (!report.safe || !report.manifest) {
    throw new Error(`evidence visual manifest rejected: ${report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
  }
  return report.manifest;
}

/** A small, strict collection helper for data-insert planning boundaries. */
export function assertEvidenceVisualManifestCollection(value: unknown): EvidenceVisualManifest[] {
  const manifests = z.array(EvidenceVisualManifestSchema).max(48).parse(value);
  const ids = new Set<string>();
  return manifests.map((manifest) => {
    if (ids.has(manifest.id)) throw new Error(`evidence visual manifest collection repeats ${manifest.id}`);
    ids.add(manifest.id);
    return assertEvidenceVisualManifest(manifest);
  });
}

/** Safe planner material: facts are data, not instructions. */
export function evidenceVisualManifestPrompt(manifest: EvidenceVisualManifest): string {
  return [
    `- ${manifest.id} (${manifest.visualKind}, ${manifest.surface})`,
    `  attribution: ${manifest.attribution.visibleText}`,
    ...manifest.narrationAnchors.map((anchor) => `  anchor ${anchor.id}: ${anchor.spokenText}`),
    ...manifest.values.map((item) => `  value ${item.id}: ${item.display} (${item.unit}; ${item.role})`),
  ].join("\n");
}

/** A data insert may attach only to an exact approved narration anchor. */
export function evidenceVisualManifestBindsNarration(manifest: EvidenceVisualManifest, sentence: string): boolean {
  return manifest.narrationAnchors.some((anchor) =>
    containsVerbatim(sentence, anchor.spokenText) || containsVerbatim(anchor.spokenText, sentence),
  );
}

/**
 * Reject generated interpolation: every numeric mark or label a planner asks
 * to render must occur in the reviewed value set. A small relative tolerance
 * avoids harmless floating-point representation noise, never rounding.
 */
export function evidenceVisualManifestAllowsNumbers(
  manifest: EvidenceVisualManifest,
  values: readonly number[],
): boolean {
  if (values.length === 0) return false;
  return values.every((candidate) => manifest.values.some((approved) => {
    const scale = Math.max(1, Math.abs(candidate), Math.abs(approved.value));
    return Math.abs(candidate - approved.value) <= scale * 1e-12;
  }));
}
