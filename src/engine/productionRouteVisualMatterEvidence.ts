import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { assertProductionRouteQualificationBinding } from "./productionRouteQualificationBinding";
import { VisualMatterManifestSchema, visualMatterDirectiveForShot, visualMatterReferenceAssetsForShot } from "./visualMatter";

export const PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION = "production-route-visual-matter-evidence/v1" as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256 fingerprint");
const shortIdentifier = z.string().trim().min(1).max(160);
const sortedUniqueStrings = (values: readonly string[]): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index]);
function fingerprint(value: unknown): string { return sha256Hex(canonicalJson(value)); }
function fingerprintWithout(value: object, field: string): string { const body = { ...(value as Record<string, unknown>) }; delete body[field]; return fingerprint(body); }

const VisualMatterControlSchema = z.object({
  shotId: shortIdentifier,
  directiveFingerprint: sha256,
  referenceAssetIds: z.array(shortIdentifier),
}).strict();

const VisualMatterEvidenceBodySchema = z.object({
  version: z.literal(PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION),
  bindingFingerprint: sha256,
  required: z.boolean(),
  requiresAnchoredReferenceAssets: z.boolean(),
  status: z.enum(["not_required", "planned_controls", "anchored_controls"]),
  manifestRevision: sha256.optional(),
  referencePackFingerprint: sha256.optional(),
  controls: z.array(VisualMatterControlSchema),
  controlsReady: z.boolean(),
}).strict();

export type ProductionRouteVisualMatterEvidenceBody = z.infer<typeof VisualMatterEvidenceBodySchema>;

export function productionRouteVisualMatterEvidenceFingerprint(
  value: ProductionRouteVisualMatterEvidenceBody,
): string {
  return fingerprintWithout(value, "evidenceFingerprint");
}

export const ProductionRouteVisualMatterEvidenceSchema = VisualMatterEvidenceBodySchema.extend({
  evidenceFingerprint: sha256,
}).strict().superRefine((value, context) => {
  const shotIds = value.controls.map((control) => control.shotId);
  const normalizedShotIds = sortedUniqueStrings(shotIds);
  if (!sameStrings(shotIds, normalizedShotIds)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["controls"],
      message: "Visual Matter control shot ids must be sorted and unique",
    });
  }
  for (const [index, control] of value.controls.entries()) {
    const normalizedAssets = sortedUniqueStrings(control.referenceAssetIds);
    if (!sameStrings(control.referenceAssetIds, normalizedAssets)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controls", index, "referenceAssetIds"],
        message: "Visual Matter reference asset ids must be sorted and unique",
      });
    }
  }
  if (value.status === "not_required") {
    if (value.required || value.requiresAnchoredReferenceAssets || value.manifestRevision || value.referencePackFingerprint || value.controls.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "not-required Visual Matter evidence cannot carry an active manifest or controls",
      });
    }
    if (!value.controlsReady) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["controlsReady"],
        message: "not-required Visual Matter evidence must be ready by definition",
      });
    }
  } else if (!value.manifestRevision || !value.controls.length || !value.controlsReady) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "active Visual Matter evidence requires a manifest revision and per-shot controls",
    });
  }
  if (value.requiresAnchoredReferenceAssets && (value.status !== "anchored_controls" || !value.referencePackFingerprint)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "anchored-reference requirement needs anchored controls and a reference-pack fingerprint",
    });
  }
  if (value.evidenceFingerprint !== productionRouteVisualMatterEvidenceFingerprint(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceFingerprint"],
      message: "Visual Matter evidence fingerprint does not match its payload",
    });
  }
});

export type ProductionRouteVisualMatterEvidence = z.infer<typeof ProductionRouteVisualMatterEvidenceSchema>;

export function assertProductionRouteVisualMatterEvidence(value: unknown): ProductionRouteVisualMatterEvidence {
  return ProductionRouteVisualMatterEvidenceSchema.parse(value);
}

/**
 * Reads existing Visual Matter planning/reference artifacts only. It never
 * generates them, and it keeps reference-pixel conditioning opt-in and explicit.
 */
export function readProductionRouteVisualMatterEvidence(input: {
  readonly binding: unknown;
  readonly required?: boolean;
  readonly requiresAnchoredReferenceAssets?: boolean;
  readonly manifest?: unknown;
  readonly shotIds?: readonly string[];
}): ProductionRouteVisualMatterEvidence {
  const binding = assertProductionRouteQualificationBinding(input.binding);
  const required = input.required === true;
  const requiresAnchoredReferenceAssets = input.requiresAnchoredReferenceAssets === true;
  const requestedShotIds = sortedUniqueStrings(input.shotIds ?? []);
  if (requiresAnchoredReferenceAssets && !required) {
    throw new Error("anchored Visual Matter reference assets can only be required for an active Visual Matter route");
  }
  if (input.manifest === undefined) {
    if (required || requestedShotIds.length) {
      throw new Error("required Visual Matter controls need an actual manifest");
    }
    const body: ProductionRouteVisualMatterEvidenceBody = {
      version: PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION,
      bindingFingerprint: binding.bindingFingerprint,
      required: false,
      requiresAnchoredReferenceAssets: false,
      status: "not_required",
      controls: [],
      controlsReady: true,
    };
    return assertProductionRouteVisualMatterEvidence({
      ...body,
      evidenceFingerprint: productionRouteVisualMatterEvidenceFingerprint(body),
    });
  }

  if (binding.contentLaneKey !== "cinematic_ai") {
    throw new Error("Visual Matter controls are only admitted for the cinematic_ai content lane");
  }
  const manifest = VisualMatterManifestSchema.parse(input.manifest);
  if (manifest.status === "disabled") {
    if (required || requestedShotIds.length) {
      throw new Error("a disabled Visual Matter manifest cannot satisfy required per-shot controls");
    }
    const body: ProductionRouteVisualMatterEvidenceBody = {
      version: PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION,
      bindingFingerprint: binding.bindingFingerprint,
      required: false,
      requiresAnchoredReferenceAssets: false,
      status: "not_required",
      controls: [],
      controlsReady: true,
    };
    return assertProductionRouteVisualMatterEvidence({
      ...body,
      evidenceFingerprint: productionRouteVisualMatterEvidenceFingerprint(body),
    });
  }
  if (requiresAnchoredReferenceAssets && manifest.status !== "anchored") {
    throw new Error("anchored Visual Matter reference assets were required but the manifest is only planned");
  }
  const shotIds = requestedShotIds.length
    ? requestedShotIds
    : sortedUniqueStrings(manifest.storyboard.map((frame) => frame.shotId));
  if (!shotIds.length) throw new Error("active Visual Matter evidence requires storyboard shots");
  const controls = shotIds.map((shotId) => {
    const directive = visualMatterDirectiveForShot(manifest, shotId);
    if (!directive) throw new Error(`Visual Matter does not define controls for storyboard shot ${shotId}`);
    const referenceAssetIds = sortedUniqueStrings(
      visualMatterReferenceAssetsForShot(manifest, shotId).map((asset) => asset.id),
    );
    if (requiresAnchoredReferenceAssets && !referenceAssetIds.length) {
      throw new Error(`Visual Matter shot ${shotId} has no attached reference asset`);
    }
    return {
      shotId,
      directiveFingerprint: fingerprint({
        renderPrompt: directive.renderPrompt,
        motionPrompt: directive.motionPrompt,
        qaCriteria: directive.qaCriteria,
        referenceAssetLabels: directive.referenceAssetLabels,
      }),
      referenceAssetIds,
    };
  });
  const body: ProductionRouteVisualMatterEvidenceBody = {
    version: PRODUCTION_ROUTE_VISUAL_MATTER_EVIDENCE_VERSION,
    bindingFingerprint: binding.bindingFingerprint,
    required,
    requiresAnchoredReferenceAssets,
    status: manifest.status === "anchored" ? "anchored_controls" : "planned_controls",
    manifestRevision: manifest.revision,
    ...(manifest.referencePackFingerprint
      ? { referencePackFingerprint: manifest.referencePackFingerprint }
      : {}),
    controls,
    controlsReady: true,
  };
  return assertProductionRouteVisualMatterEvidence({
    ...body,
    evidenceFingerprint: productionRouteVisualMatterEvidenceFingerprint(body),
  });
}

