import { z } from "zod";

import manifestJson from "./goldenProofMediaManifest.json";

const GoldenProofMediaKindSchema = z.enum(["image", "video", "audio"]);
const GoldenProofMediaStatusSchema = z.enum([
  "reference",
  "context",
  "historical",
  "quarantined",
  "duplicate",
]);

const GoldenProofMediaEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "golden proof media id must be kebab-case"),
  path: z.string().regex(/^golden\/[a-z0-9_/-]+\.(?:jpg|jpeg|png|webp|mp4|mp3)$/i, "golden proof media must stay under public/golden"),
  kind: GoldenProofMediaKindSchema,
  family: z.string().min(1),
  status: GoldenProofMediaStatusSchema,
  statusReason: z.string().min(1).optional(),
  duplicateOf: z.string().regex(/^[a-z0-9-]+$/).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "golden proof media requires a SHA-256 fingerprint"),
});

const GoldenProofMediaManifestSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  auditedAt: z.string().datetime(),
  entries: z.array(GoldenProofMediaEntrySchema).min(1),
});

export type GoldenProofMediaKind = z.infer<typeof GoldenProofMediaKindSchema>;
export type GoldenProofMediaStatus = z.infer<typeof GoldenProofMediaStatusSchema>;
export type GoldenProofMediaEntry = z.infer<typeof GoldenProofMediaEntrySchema>;
export type GoldenProofMediaManifest = z.infer<typeof GoldenProofMediaManifestSchema>;

export interface GoldenProofMediaPresentation {
  id: string;
  kind: GoldenProofMediaKind;
  status: "reference" | "context";
  url: string;
  sha256: string;
}

/**
 * A retained Golden video may be visible for context or quarantined for a
 * known defect.  These are the only catalog assets that call for a fresh
 * successor render.  Historical and duplicate assets stay in the audit trail
 * instead of being silently regenerated, and this never represents a
 * replacement of an existing YouTube upload.
 */
export interface GoldenProofMediaSuccessorRequirement {
  id: string;
  family: string;
  status: "context" | "quarantined";
  reason: string;
  sha256: string;
  requiredOutcome: string;
}

function buildGoldenProofMediaManifest(value: unknown): GoldenProofMediaManifest {
  const manifest = GoldenProofMediaManifestSchema.parse(value);
  const ids = new Set<string>();
  const paths = new Set<string>();
  const entriesById = new Map<string, GoldenProofMediaEntry>();

  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) throw new Error(`Golden proof media manifest duplicates id ${entry.id}`);
    if (paths.has(entry.path)) throw new Error(`Golden proof media manifest duplicates path ${entry.path}`);
    ids.add(entry.id);
    paths.add(entry.path);
    entriesById.set(entry.id, entry);

    if (entry.status === "duplicate") {
      if (!entry.duplicateOf) throw new Error(`Duplicate golden proof media ${entry.id} must name its canonical entry`);
      continue;
    }
    if (entry.duplicateOf) throw new Error(`Only duplicate golden proof media may declare duplicateOf (${entry.id})`);
    if ((entry.status === "context" || entry.status === "quarantined") && !entry.statusReason) {
      throw new Error(`${entry.status} golden proof media ${entry.id} must explain its status`);
    }
  }

  for (const entry of manifest.entries.filter((candidate) => candidate.status === "duplicate")) {
    const canonical = entriesById.get(entry.duplicateOf!);
    if (!canonical) throw new Error(`Duplicate golden proof media ${entry.id} names unknown canonical ${entry.duplicateOf}`);
    if (canonical.status === "duplicate") throw new Error(`Duplicate golden proof media ${entry.id} may not point to another duplicate`);
    if (canonical.sha256 !== entry.sha256) throw new Error(`Duplicate golden proof media ${entry.id} does not match ${entry.duplicateOf}`);
    if (canonical.kind !== entry.kind) throw new Error(`Duplicate golden proof media ${entry.id} changes media kind from ${entry.duplicateOf}`);
  }

  const presentableHashes = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (entry.status !== "reference" && entry.status !== "context") continue;
    const prior = presentableHashes.get(entry.sha256);
    if (prior) throw new Error(`Golden proof media ${entry.id} and ${prior} would present duplicate bytes as evidence/context`);
    presentableHashes.set(entry.sha256, entry.id);
  }

  return manifest;
}

export const GOLDEN_PROOF_MEDIA_MANIFEST = buildGoldenProofMediaManifest(manifestJson);
export const GOLDEN_PROOF_MEDIA_MANIFEST_VERSION = GOLDEN_PROOF_MEDIA_MANIFEST.schemaVersion;
export const GOLDEN_PROOF_MEDIA_CATALOG_VERSION = GOLDEN_PROOF_MEDIA_MANIFEST.catalogVersion;

const entriesById = new Map(GOLDEN_PROOF_MEDIA_MANIFEST.entries.map((entry) => [entry.id, entry]));

export function goldenProofMediaEntry(id: string): GoldenProofMediaEntry {
  const entry = entriesById.get(id);
  if (!entry) throw new Error(`Unknown golden proof media id ${id}`);
  return entry;
}

export function goldenProofMediaPresentation(
  id: string,
  intent: "reference" | "context",
  expectedKind?: GoldenProofMediaKind,
): GoldenProofMediaPresentation {
  const entry = goldenProofMediaEntry(id);
  if (entry.status !== intent) {
    throw new Error(`Golden proof media ${id} is ${entry.status}, not eligible for ${intent} presentation`);
  }
  if (expectedKind && entry.kind !== expectedKind) {
    throw new Error(`Golden proof media ${id} is ${entry.kind}, expected ${expectedKind}`);
  }
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    url: `/${entry.path}`,
    sha256: entry.sha256,
  };
}

export function goldenProofMediaSuccessorQueue(): readonly GoldenProofMediaSuccessorRequirement[] {
  return GOLDEN_PROOF_MEDIA_MANIFEST.entries
    .filter(
      (entry): entry is GoldenProofMediaEntry & { status: "context" | "quarantined" } =>
        entry.kind === "video" && (entry.status === "context" || entry.status === "quarantined"),
    )
    .map((entry) => ({
      id: entry.id,
      family: entry.family,
      status: entry.status,
      reason: entry.statusReason ?? "This retained sample is not eligible as current Golden evidence.",
      sha256: entry.sha256,
      requiredOutcome:
        entry.status === "quarantined"
          ? "Repair the recorded defect, then create a newly reviewed final master."
          : "Correct the stated limitation, then create a newly reviewed final master.",
    }));
}

export function goldenProofMediaExclusion(id: string): GoldenProofMediaEntry {
  const entry = goldenProofMediaEntry(id);
  if (entry.status === "reference" || entry.status === "context") {
    throw new Error(`Golden proof media ${id} is presentable and has no exclusion notice`);
  }
  return entry;
}

export function goldenProofMediaInventorySummary(): Readonly<Record<GoldenProofMediaStatus, number>> {
  const summary: Record<GoldenProofMediaStatus, number> = {
    reference: 0,
    context: 0,
    historical: 0,
    quarantined: 0,
    duplicate: 0,
  };
  for (const entry of GOLDEN_PROOF_MEDIA_MANIFEST.entries) summary[entry.status] += 1;
  return summary;
}
