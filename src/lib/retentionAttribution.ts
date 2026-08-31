import {
  PackageToOpeningPlanSchema,
  PackageToOpeningReceiptSchema,
} from "@/engine/packageToOpening";

/**
 * The post-release learning loop may only attribute opening retention to the
 * package/opening mechanism that was actually sealed for that final master.
 * It returns an explicit unknown state for historical or incomplete runs
 * rather than selecting a plausible playbook device.
 */
export type PackageOpeningRetentionAttribution =
  | {
      readonly state: "verified_final_master";
      readonly openingAnchorSource: "script_hook_loop" | "script_cold_open" | "quiz_topic" | "ambient_continuity" | "topic_declaration";
      readonly planFingerprint: string;
      readonly receiptFingerprint: string;
    }
  | {
      readonly state: "planned_not_final_master_verified";
      readonly openingAnchorSource: "script_hook_loop" | "script_cold_open" | "quiz_topic" | "ambient_continuity" | "topic_declaration";
      readonly planFingerprint: string;
    }
  | { readonly state: "mismatched_receipt" }
  | { readonly state: "not_recorded" };

export function packageOpeningRetentionAttribution(args: {
  readonly plan: unknown;
  readonly receipt: unknown;
}): PackageOpeningRetentionAttribution {
  const plan = PackageToOpeningPlanSchema.safeParse(args.plan);
  const receipt = PackageToOpeningReceiptSchema.safeParse(args.receipt);

  if (!plan.success) return { state: "not_recorded" };
  if (!receipt.success) {
    return {
      state: "planned_not_final_master_verified",
      openingAnchorSource: plan.data.plannedOpeningAnchor.source,
      planFingerprint: plan.data.planFingerprint,
    };
  }
  if (receipt.data.planFingerprint !== plan.data.planFingerprint) {
    return { state: "mismatched_receipt" };
  }
  return {
    state: "verified_final_master",
    openingAnchorSource: plan.data.plannedOpeningAnchor.source,
    planFingerprint: plan.data.planFingerprint,
    receiptFingerprint: receipt.data.receiptFingerprint,
  };
}

export function describePackageOpeningRetentionAttribution(
  attribution: PackageOpeningRetentionAttribution,
): string {
  switch (attribution.state) {
    case "verified_final_master":
      return `verified final-master opening anchor: ${attribution.openingAnchorSource}`;
    case "planned_not_final_master_verified":
      return `planned but unverified opening anchor: ${attribution.openingAnchorSource}`;
    case "mismatched_receipt":
      return "package-to-opening plan and final-master receipt do not match";
    case "not_recorded":
      return "opening anchor was not retained for this run";
  }
}
