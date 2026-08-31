import { canonicalJson } from "@/lib/canonicalJson";
import { certifiedFamilyAdmission } from "./certifiedFamilyAdmission";
import { resolveContentLane } from "./contentLane";
import { FAMILY_KEYS, type FamilyKey } from "./families";
import {
  readProductionRouteQualificationBinding,
  type ProductionRouteQualificationBinding,
} from "./productionRouteQualification";
import {
  assertRoutePreflightReadyReceipt,
  assertRouteReleaseQualifiedReceipt,
  productionRouteQualificationReceiptBindingFor,
  ROUTE_PREFLIGHT_READY,
  ROUTE_RELEASE_QUALIFIED,
} from "./productionRouteQualificationReceipt";

/**
 * A deliberately exact, versioned channel-identity opt-in. Program Route is
 * strict and cannot safely grow ad-hoc fields, so a newly-gated route may be
 * marked on the channel's sealed identity without turning a stray boolean into
 * a production stop signal.
 */
export const PRODUCTION_ROUTE_QUALIFICATION_REQUIRED_MARKER =
  "route_release_qualified/v1" as const;

export type ProductionRouteQualificationAdmissionPath =
  | "normal_cadence"
  | "private_benchmark_manual";

export interface ProductionRouteQualificationRequirement {
  readonly requiresReceipt: boolean;
  readonly level: typeof ROUTE_RELEASE_QUALIFIED | typeof ROUTE_PREFLIGHT_READY;
  readonly binding?: ProductionRouteQualificationBinding;
  readonly reason: string;
}

export interface ProductionRouteQualificationReceiptAdmission {
  readonly automatic: boolean;
  readonly reason: string;
  readonly receiptFingerprint?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function knownFamily(value: unknown): FamilyKey | undefined {
  return typeof value === "string" && (FAMILY_KEYS as readonly string[]).includes(value)
    ? value as FamilyKey
    : undefined;
}

function explicitQualificationMarker(identity: unknown): boolean {
  return object(identity)?.["productionRouteQualificationRequirement"] ===
    PRODUCTION_ROUTE_QUALIFICATION_REQUIRED_MARKER;
}

function receiptLevelFor(
  path: ProductionRouteQualificationAdmissionPath,
): typeof ROUTE_RELEASE_QUALIFIED | typeof ROUTE_PREFLIGHT_READY {
  // A normal cadence run must never use a preflight receipt as a release
  // authorization. The only lower bar is reserved for a future explicitly
  // manual/private benchmark path; this module intentionally creates neither
  // that endpoint nor a dispatch path.
  return path === "private_benchmark_manual"
    ? ROUTE_PREFLIGHT_READY
    : ROUTE_RELEASE_QUALIFIED;
}

function failureRequirement(input: {
  readonly path: ProductionRouteQualificationAdmissionPath;
  readonly marker: boolean;
  readonly family?: FamilyKey;
  readonly error: unknown;
}): ProductionRouteQualificationRequirement {
  const familyRequiresReceipt = input.family !== undefined && !certifiedFamilyAdmission(input.family).automatic;
  if (!input.marker && !familyRequiresReceipt) {
    // Preserve historical cadence for the five catalog-certified automatic
    // families. A malformed legacy row is still revalidated later by the
    // worker's existing route/profile checks; it is not newly stopped merely
    // because it predates immutable qualification receipts.
    return {
      requiresReceipt: false,
      level: receiptLevelFor(input.path),
      reason: "legacy catalog-certified automatic route does not require a qualification receipt",
    };
  }
  const detail = input.error instanceof Error ? ` (${input.error.message})` : "";
  return {
    requiresReceipt: true,
    level: receiptLevelFor(input.path),
    reason:
      "sealed route/profile/pipeline could not be revalidated for production-route qualification" + detail,
  };
}

/**
 * Provider-free policy that decides whether this sealed channel needs a
 * current immutable qualification receipt. It does not query, mutate, claim,
 * bootstrap credentials, or dispatch work.
 */
export function productionRouteQualificationRequirement(input: {
  readonly path: ProductionRouteQualificationAdmissionPath;
  readonly identity: unknown;
  readonly family: unknown;
  readonly contentLane: unknown;
  readonly pipeline: unknown;
}): ProductionRouteQualificationRequirement {
  const marker = explicitQualificationMarker(input.identity);
  const storedFamily = knownFamily(input.family);
  try {
    const identity = object(input.identity);
    if (!identity) throw new Error("sealed channel identity is missing");
    if (!Array.isArray(input.pipeline)) throw new Error("persisted channel pipeline is missing");
    const binding = readProductionRouteQualificationBinding({
      programBrief: identity["programBrief"],
      programRoute: identity["programRoute"],
      showProfile: identity["showProfile"],
      pipeline: input.pipeline,
    });
    const bindingFamily = knownFamily(binding.family);
    if (!bindingFamily) throw new Error("sealed qualification route has an unknown family");
    if (storedFamily !== undefined && storedFamily !== bindingFamily) {
      throw new Error("persisted channel family does not match the sealed qualification route");
    }
    const lane = resolveContentLane({
      stored: input.contentLane,
      family: input.family,
      pipeline: input.pipeline,
    });
    if (lane.key !== binding.contentLaneKey) {
      throw new Error("persisted channel content lane does not match the sealed qualification route");
    }
    const familyAdmission = certifiedFamilyAdmission(bindingFamily);
    const requiresReceipt =
      marker ||
      !familyAdmission.automatic ||
      binding.route.admission !== "automatic";
    if (!requiresReceipt) {
      return {
        requiresReceipt: false,
        level: receiptLevelFor(input.path),
        reason: "catalog-certified automatic family and automatic route retain their receipt-free legacy cadence",
      };
    }
    return {
      requiresReceipt: true,
      level: receiptLevelFor(input.path),
      binding,
      reason: marker
        ? "channel identity explicitly requires a current production-route qualification receipt"
        : !familyAdmission.automatic
          ? "family is not in the catalog-certified automatic admission surface"
          : "sealed route is supervised and cannot use the catalog-certified automatic cadence",
    };
  } catch (error) {
    return failureRequirement({
      path: input.path,
      marker,
      family: storedFamily,
      error,
    });
  }
}

/**
 * Validates the compact current-head row returned by Convex. Missing,
 * malformed, stale, owner-mismatched, or binding-mismatched rows are a manual
 * gate rather than a task error, so callers can stop before leasing/spending.
 */
export function productionRouteQualificationReceiptAdmission(input: {
  readonly requirement: ProductionRouteQualificationRequirement;
  readonly row: unknown;
  readonly ownerId: string;
  readonly channelId: string;
}): ProductionRouteQualificationReceiptAdmission {
  if (!input.requirement.requiresReceipt) {
    return { automatic: true, reason: input.requirement.reason };
  }
  if (!input.requirement.binding) {
    return { automatic: false, reason: input.requirement.reason };
  }
  if (!input.row) {
    return {
      automatic: false,
      reason: `current ${input.requirement.level} receipt is missing; private/manual qualification is required`,
    };
  }
  try {
    const row = object(input.row);
    if (!row) throw new Error("receipt row is malformed");
    const receipt = input.requirement.level === ROUTE_RELEASE_QUALIFIED
      ? assertRouteReleaseQualifiedReceipt(row["receipt"])
      : assertRoutePreflightReadyReceipt(row["receipt"]);
    const expectedBinding = productionRouteQualificationReceiptBindingFor(input.requirement.binding);
    if (
      row["level"] !== input.requirement.level ||
      String(row["ownerId"] ?? "") !== input.ownerId ||
      String(row["channelId"] ?? "") !== input.channelId ||
      String(row["bindingFingerprint"] ?? "") !== expectedBinding.bindingFingerprint ||
      String(row["receiptFingerprint"] ?? "") !== receipt.receiptFingerprint ||
      receipt.ownerId !== input.ownerId ||
      receipt.channelId !== input.channelId ||
      canonicalJson(receipt.binding) !== canonicalJson(expectedBinding)
    ) {
      throw new Error("current qualification receipt does not match this sealed owner/channel/route/profile/pipeline binding");
    }
    return {
      automatic: true,
      reason: `${input.requirement.level} receipt matches the sealed production route`,
      receiptFingerprint: receipt.receiptFingerprint,
    };
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : "";
    return {
      automatic: false,
      reason: `current ${input.requirement.level} receipt is invalid for this production route${detail}`,
    };
  }
}
