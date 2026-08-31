/**
 * Immutable rights evidence for third-party stock footage.
 *
 * This is deliberately a small, provider-neutral sidecar rather than a claim
 * that the rendered master contains a copy of every source download. A release
 * binds this evidence manifest only; worker-scoped source videos remain normal
 * transient render inputs.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";

export const THIRD_PARTY_STOCK_EVIDENCE_VERSION =
  "third-party-stock-evidence/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const objectKey = z.string().trim().min(1).max(2_000);
const epochMs = z.number().int().nonnegative();

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * These are intentionally reviewed, fixed snapshots. We do not fetch mutable
 * provider terms in a worker while selecting footage: that would make a render
 * depend on an unbounded external legal-page request and would make retries
 * capture different terms for the same run.
 *
 * The snapshot is a concise record of the provider's published licensing
 * position on the review date, not a substitute for the linked official terms.
 * The official page remains the controlling reference.
 */
const REVIEWED_PROVIDER_LICENSES = {
  pexels: {
    provider: "pexels",
    termsUrl: "https://www.pexels.com/license/",
    reviewedAt: "2026-08-22",
    attribution: {
      licenseStatus: "not_required",
      apiGuidanceStatus: "recommended",
      apiGuidanceUrl: "https://www.pexels.com/api/documentation/",
      applicationStatus: "not_automatically_applied",
      caveat:
        "Pexels API documentation asks applications to show a prominent Pexels link and credit photographers when possible. This provenance record does not assert that an upload description, on-screen credit, or API attribution action occurred.",
    },
    termsSnapshot: [
      "Pexels License — reviewed provider-license snapshot (2026-08-22).",
      "Official terms: https://www.pexels.com/license/",
      "Pexels states that photos and videos may be used free of charge, including for commercial use, and attribution is not required.",
      "The published restrictions include no sale of unaltered copies, no implied endorsement, no redistribution or sale on stock/wallpaper platforms, and no use as a trademark or service mark.",
      "The official terms above control; this fixed snapshot records the policy reviewed when the asset was selected.",
    ].join("\n"),
  },
  pixabay: {
    provider: "pixabay",
    termsUrl: "https://pixabay.com/service/license-summary/",
    reviewedAt: "2026-08-22",
    attribution: {
      licenseStatus: "not_required",
      apiGuidanceStatus: "not_separately_reviewed",
      apiGuidanceUrl: "https://pixabay.com/api/docs/",
      applicationStatus: "not_automatically_applied",
      caveat:
        "This provenance record establishes neither third-party rights clearance nor an upload-description or on-screen attribution action.",
    },
    termsSnapshot: [
      "Pixabay Content License Summary — reviewed provider-license snapshot (2026-08-22).",
      "Official terms: https://pixabay.com/service/license-summary/",
      "Pixabay states that Content may be used free of charge, without attribution, and adapted into new works, subject to its prohibited uses.",
      "The published restrictions include no standalone distribution, no misleading or illegal use, and limits involving recognizable trademarks, logos, brands, people, and other third-party rights.",
      "Pixabay says its full Content License is legally binding; the official terms above control over this fixed reviewed snapshot.",
    ].join("\n"),
  },
} as const;

export type ApprovedThirdPartyStockProvider = keyof typeof REVIEWED_PROVIDER_LICENSES;

const providerLicenseTermsSnapshotSchema = z.object({
  provider: z.enum(["pexels", "pixabay"]),
  termsUrl: z.string().url().max(2_000),
  termsSnapshot: z.string().trim().min(1).max(20_000),
  termsSnapshotSha256: sha256,
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Provider-license terms and API attribution guidance can differ. Keep the
  // latter explicit so release provenance is never mistaken for proof that a
  // publication credit was rendered or placed in an upload description.
  attribution: z.object({
    licenseStatus: z.enum(["not_required"]),
    apiGuidanceStatus: z.enum(["recommended", "not_separately_reviewed"]),
    apiGuidanceUrl: z.string().url().max(2_000),
    applicationStatus: z.literal("not_automatically_applied"),
    caveat: z.string().trim().min(1).max(2_000),
  }).strict(),
}).strict();

/** Stable identity and provider-license evidence available at search time. */
export const ThirdPartyStockSourceSchema = z.object({
  provider: z.enum(["pexels", "pixabay"]),
  /** Provider's durable asset identifier; never a signed/CDN rendition URL. */
  assetId: z.string().trim().min(1).max(512),
  /** Provider's canonical human-facing asset page, not the download URL. */
  assetUrl: z.string().url().max(2_000),
  license: providerLicenseTermsSnapshotSchema,
}).strict();

export type ThirdPartyStockSource = z.infer<typeof ThirdPartyStockSourceSchema>;
export type ProviderLicenseTermsSnapshot = z.infer<typeof providerLicenseTermsSnapshotSchema>;

/**
 * Return an immutable, reviewed provider-license record for a source adapter.
 * Unsupported providers deliberately get no fallback record: callers must
 * reject them rather than manufacture a generic "royalty-free" assertion.
 */
export function approvedThirdPartyStockSource(args: {
  provider: ApprovedThirdPartyStockProvider;
  assetId: string | number;
  assetUrl: string;
}): ThirdPartyStockSource {
  const policy = REVIEWED_PROVIDER_LICENSES[args.provider];
  const termsSnapshotSha256 = sha256Text(policy.termsSnapshot);
  return ThirdPartyStockSourceSchema.parse({
    provider: policy.provider,
    assetId: String(args.assetId).trim(),
    assetUrl: args.assetUrl,
    license: {
      ...policy,
      termsSnapshotSha256,
    },
  });
}

/**
 * Exact staged footage inputs. `studio_generated` is included only to make the
 * ordinal map exhaustive when signature clips are prepended; it carries no
 * third-party licensing assertion.
 */
const stagedFootageInputBase = {
  ordinal: z.number().int().nonnegative(),
  footageKey: objectKey,
  footageSha256: sha256,
};

const thirdPartyStockInputSchema = z.object({
  ...stagedFootageInputBase,
  origin: z.literal("third_party_stock"),
  source: ThirdPartyStockSourceSchema,
  /** Set only after the selected source rendition has been acquired. */
  acquiredAt: epochMs,
}).strict();

const studioGeneratedInputSchema = z.object({
  ...stagedFootageInputBase,
  origin: z.literal("studio_generated"),
  /** Bounded diagnostic label; it is never a third-party rights claim. */
  sourceLabel: z.string().trim().min(1).max(128),
}).strict();

export const ThirdPartyStockEvidenceManifestSchema = z.object({
  version: z.literal(THIRD_PARTY_STOCK_EVIDENCE_VERSION),
  inputs: z.array(z.discriminatedUnion("origin", [thirdPartyStockInputSchema, studioGeneratedInputSchema]))
    .min(1)
    .max(160),
}).strict();

export type ThirdPartyStockEvidenceManifest = z.infer<typeof ThirdPartyStockEvidenceManifestSchema>;
export type ThirdPartyStockEvidenceInput = ThirdPartyStockEvidenceManifest["inputs"][number];

export const ThirdPartyStockEvidenceReferenceSchema = z.object({
  version: z.literal(THIRD_PARTY_STOCK_EVIDENCE_VERSION),
  manifestKey: objectKey,
  manifestSha256: sha256,
  inputCount: z.number().int().positive().max(160),
  stockAssetCount: z.number().int().nonnegative().max(160),
}).strict();

export type ThirdPartyStockEvidenceReference = z.infer<typeof ThirdPartyStockEvidenceReferenceSchema>;

function manifestPayload(manifest: ThirdPartyStockEvidenceManifest): string {
  return canonicalJson(manifest);
}

export function thirdPartyStockEvidenceManifestSha256(manifest: ThirdPartyStockEvidenceManifest): string {
  return sha256Text(`${THIRD_PARTY_STOCK_EVIDENCE_VERSION}\n${manifestPayload(manifest)}`);
}

/** Validate internal invariants without reinterpreting the provider's terms. */
export function assertThirdPartyStockEvidenceManifest(value: unknown): ThirdPartyStockEvidenceManifest {
  const manifest = ThirdPartyStockEvidenceManifestSchema.parse(value);
  const ordered = [...manifest.inputs].sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 0; index < ordered.length; index++) {
    const input = ordered[index];
    if (input.ordinal !== index) {
      throw new Error("third-party stock evidence inputs must have contiguous ordinals");
    }
    if (input.origin === "third_party_stock") {
      if (input.source.license.termsSnapshotSha256 !== sha256Text(input.source.license.termsSnapshot)) {
        throw new Error(`third-party stock evidence license snapshot hash mismatch for ${input.source.provider}:${input.source.assetId}`);
      }
      if (input.source.provider !== input.source.license.provider) {
        throw new Error(`third-party stock evidence license provider mismatch for ${input.source.assetId}`);
      }
    }
  }
  if (new Set(manifest.inputs.map((input) => input.footageKey)).size !== manifest.inputs.length) {
    throw new Error("third-party stock evidence must bind each staged footage key once");
  }
  const assetIds = manifest.inputs
    .filter((input): input is Extract<ThirdPartyStockEvidenceInput, { origin: "third_party_stock" }> => input.origin === "third_party_stock")
    .map((input) => `${input.source.provider}:${input.source.assetId}`);
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error("third-party stock evidence contains a duplicate provider asset id");
  }
  return manifest;
}

/** Fail before a costly compose if the evidence and the exact staged inputs diverge. */
export function assertThirdPartyStockEvidenceMatchesFootageKeys(args: {
  manifest: unknown;
  footageKeys: readonly string[];
}): ThirdPartyStockEvidenceManifest {
  const manifest = assertThirdPartyStockEvidenceManifest(args.manifest);
  if (manifest.inputs.length !== args.footageKeys.length) {
    throw new Error("third-party stock evidence input count does not match staged footage");
  }
  for (const input of manifest.inputs) {
    if (args.footageKeys[input.ordinal] !== input.footageKey) {
      throw new Error(`third-party stock evidence does not match staged footage at ordinal ${input.ordinal}`);
    }
  }
  return manifest;
}

export function createThirdPartyStockEvidenceReference(args: {
  manifestKey: string;
  manifest: unknown;
}): ThirdPartyStockEvidenceReference {
  const manifest = assertThirdPartyStockEvidenceManifest(args.manifest);
  return ThirdPartyStockEvidenceReferenceSchema.parse({
    version: THIRD_PARTY_STOCK_EVIDENCE_VERSION,
    manifestKey: args.manifestKey,
    manifestSha256: thirdPartyStockEvidenceManifestSha256(manifest),
    inputCount: manifest.inputs.length,
    stockAssetCount: manifest.inputs.filter((input) => input.origin === "third_party_stock").length,
  });
}

export function parseThirdPartyStockEvidenceManifestBytes(bytes: Uint8Array): ThirdPartyStockEvidenceManifest {
  try {
    return assertThirdPartyStockEvidenceManifest(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("third-party stock evidence")) throw error;
    throw new Error(`third-party stock evidence manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Verify the immutable sidecar which a final release certificate points to. */
export function assertThirdPartyStockEvidenceReferenceBinding(args: {
  reference: unknown;
  manifest: unknown;
}): ThirdPartyStockEvidenceReference {
  const reference = ThirdPartyStockEvidenceReferenceSchema.parse(args.reference);
  const manifest = assertThirdPartyStockEvidenceManifest(args.manifest);
  const actualSha256 = thirdPartyStockEvidenceManifestSha256(manifest);
  if (reference.manifestSha256 !== actualSha256) {
    throw new Error("third-party stock evidence manifest bytes do not match certificate reference");
  }
  const stockAssetCount = manifest.inputs.filter((input) => input.origin === "third_party_stock").length;
  if (reference.inputCount !== manifest.inputs.length || reference.stockAssetCount !== stockAssetCount) {
    throw new Error("third-party stock evidence manifest counts do not match certificate reference");
  }
  return reference;
}

function normalizePrefix(keyPrefix: string): string {
  const normalized = keyPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("third-party stock evidence requires a non-empty key prefix");
  return `${normalized}/`;
}

/** A release may retain this JSON evidence object, never the raw source clips. */
export function thirdPartyStockEvidenceManifestKey(
  keyPrefix: string,
  runId: string,
  manifestSha256: string,
): string {
  if (!sha256.safeParse(manifestSha256).success) {
    throw new Error("third-party stock evidence requires a SHA-256 manifest fingerprint");
  }
  const safeRunId = runId.trim();
  if (!safeRunId || /[\\/\u0000-\u001f]/.test(safeRunId)) {
    throw new Error("third-party stock evidence requires a safe run id");
  }
  return `${normalizePrefix(keyPrefix)}runs/${safeRunId}/third-party-stock-evidence/${manifestSha256}.json`;
}
