import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const STUDIO_POSTPRODUCTION_DECISION_VERSION = "studio-postproduction-decision/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const TransitionPresetSchema = z.enum(["hardcut", "crossfade", "dip_to_black"]);

export const StudioPostproductionDecisionReceiptSchema = z.object({
  version: z.literal(STUDIO_POSTPRODUCTION_DECISION_VERSION),
  assetKind: z.literal("transition_template"),
  moduleId: z.literal("timeline_assemble"),
  transitionPreset: TransitionPresetSchema,
  /**
   * Only operator_module_config is eligible for later promotion. A pipeline
   * default is intentionally recorded separately from a deliberate choice.
   */
  selectionSource: z.enum(["operator_module_config", "studio_asset", "pipeline_config", "default"]),
  sourceEntryFingerprints: z.array(sha256).max(1),
  editorConfigFingerprint: sha256.optional(),
  receiptFingerprint: sha256,
}).strict();

export type StudioPostproductionDecisionReceipt = z.infer<typeof StudioPostproductionDecisionReceiptSchema>;

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function frozenEditorConfig(value: unknown): Record<string, unknown> | undefined {
  return record(record(value)?.["editor_brief"]);
}

function parsedTransition(value: unknown): z.infer<typeof TransitionPresetSchema> | undefined {
  const parsed = TransitionPresetSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createStudioTransitionDecisionReceipt(input: {
  readonly frozenChannelModuleConfig: unknown;
  readonly explicitTransition: unknown;
  readonly studioTransitionPreset: unknown;
  readonly studioSourceEntryFingerprints: unknown;
}): StudioPostproductionDecisionReceipt {
  const explicitTransition = parsedTransition(input.explicitTransition);
  const studioTransitionPreset = parsedTransition(input.studioTransitionPreset);
  const sourceEntryFingerprints = z.array(sha256).max(1).safeParse(input.studioSourceEntryFingerprints);
  const studioSourceEntryFingerprints = sourceEntryFingerprints.success ? sourceEntryFingerprints.data : [];
  const editorConfig = frozenEditorConfig(input.frozenChannelModuleConfig);
  const explicitEditorTransition = parsedTransition(editorConfig?.["transitions"]);
  const selectedEditorPreset = typeof editorConfig?.["preset"] === "string" && editorConfig.preset.trim().length > 0;
  const isOperatorChoice = explicitTransition !== undefined && editorConfig !== undefined && (
    explicitEditorTransition === explicitTransition || selectedEditorPreset
  );

  const selectionSource = isOperatorChoice
    ? "operator_module_config" as const
    : explicitTransition !== undefined
      ? "pipeline_config" as const
      : studioTransitionPreset !== undefined && studioSourceEntryFingerprints.length === 1
        ? "studio_asset" as const
        : "default" as const;
  const core = {
    version: STUDIO_POSTPRODUCTION_DECISION_VERSION,
    assetKind: "transition_template" as const,
    moduleId: "timeline_assemble" as const,
    transitionPreset: explicitTransition ?? studioTransitionPreset ?? "crossfade" as const,
    selectionSource,
    sourceEntryFingerprints: selectionSource === "studio_asset" ? studioSourceEntryFingerprints : [],
    ...(isOperatorChoice ? { editorConfigFingerprint: fingerprint(editorConfig) } : {}),
  };
  return StudioPostproductionDecisionReceiptSchema.parse({
    ...core,
    receiptFingerprint: fingerprint(core),
  });
}

export function assertStudioPostproductionDecisionReceipt(value: unknown): StudioPostproductionDecisionReceipt {
  const receipt = StudioPostproductionDecisionReceiptSchema.parse(value);
  const { receiptFingerprint, ...core } = receipt;
  if (fingerprint(core) !== receiptFingerprint) {
    throw new Error("Studio post-production decision receipt fingerprint does not match its contents");
  }
  if (receipt.selectionSource === "studio_asset" && receipt.sourceEntryFingerprints.length !== 1) {
    throw new Error("Studio post-production Studio-asset decision requires one exact approved source entry");
  }
  if (receipt.selectionSource !== "studio_asset" && receipt.sourceEntryFingerprints.length > 0) {
    throw new Error("Studio post-production decision may record source entries only when that Studio asset was actually selected");
  }
  if (receipt.selectionSource === "operator_module_config" && !receipt.editorConfigFingerprint) {
    throw new Error("Studio post-production operator decision requires the frozen editor-config fingerprint");
  }
  if (receipt.selectionSource !== "operator_module_config" && receipt.editorConfigFingerprint) {
    throw new Error("Studio post-production non-operator decision cannot claim editor-config provenance");
  }
  return receipt;
}

export function studioPostproductionDecisionReceiptFromUnknown(value: unknown): StudioPostproductionDecisionReceipt | undefined {
  return value === undefined ? undefined : assertStudioPostproductionDecisionReceipt(value);
}
