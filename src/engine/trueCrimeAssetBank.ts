/**
 * TRUE-CRIME ASSET BANK — a small, additive registry of reusable
 * evidence-overlay and prop-reference primitives for the Casefile /
 * true-crime doctrine, mirroring the exact id/label/description
 * `Record<string, T>` pattern established by src/remotion/docuStyles.ts's
 * `DOCU_STYLES` and src/engine/ltxStylePresets.ts's `LTX_STYLES`. Adding a
 * new asset = adding one entry.
 *
 * DELIBERATELY OMITS a grain/vignette numeric-preset category: that would
 * duplicate the per-style `grain`/`vignette` fields already on
 * `LtxStyleDef` (src/engine/ltxStylePresets.ts) and `DocuTheme`
 * (src/remotion/docuStyles.ts) on the identical 0-1 scale. A caller wanting
 * a grade should read the active style's own grain/vignette rather than a
 * second, competing source of truth.
 *
 * STATUS — additive, referenced by id. No live consumer yet, matching the
 * judgment call in src/lib/hyperframesOverlay.ts (see its file doc for the
 * sibling finding this follows): the Casefile pipeline has no clip
 * assembler yet to wire this into. Built ready for whenever the true-crime
 * doctrine module and/or the Casefile clip assembler exist to consume it.
 */
import { OVERLAY_TEMPLATE_IDS, type OverlayTemplateId } from "@/lib/hyperframesOverlay";

export type TrueCrimeAssetKind = "overlay_template" | "prop_reference";

export interface TrueCrimeOverlayAssetDef {
  id: string;
  label: string;
  description: string;
  kind: "overlay_template";
  /** The src/lib/hyperframesOverlay.ts template this asset renders through. */
  templateId: OverlayTemplateId;
  /** CinematicNarrativeRole values (src/engine/cinematicCaseSequence.ts) this overlay is intended to accent. */
  suitedNarrativeRoles: readonly string[];
}

export interface TrueCrimePropAssetDef {
  id: string;
  label: string;
  description: string;
  kind: "prop_reference";
  /** Reusable prose fragment — drop straight into a mannequin `keyProp` or a shot `still` prompt. */
  promptFragment: string;
}

export type TrueCrimeAssetDef = TrueCrimeOverlayAssetDef | TrueCrimePropAssetDef;

/* ------------------------------------------------------- OVERLAY TEMPLATES -- */

const CASE_FILE_STAMP_ASSET: TrueCrimeOverlayAssetDef = {
  id: "overlay_case_file_stamp",
  label: "Case File Stamp",
  description: "A rotated case-file ink stamp accent for a reveal beat's cited evidence insert.",
  kind: "overlay_template",
  templateId: "case_file_stamp",
  suitedNarrativeRoles: ["reveal"],
};

const EVIDENCE_TAG_ASSET: TrueCrimeOverlayAssetDef = {
  id: "overlay_evidence_tag",
  label: "Evidence Tag",
  description: "A hanging evidence-locker tag accent for a contradiction beat's cited evidence insert.",
  kind: "overlay_template",
  templateId: "evidence_tag",
  suitedNarrativeRoles: ["contradiction"],
};

const TRACKING_HUD_ASSET: TrueCrimeOverlayAssetDef = {
  id: "overlay_tracking_hud",
  label: "Tracking HUD",
  description:
    "A surveillance-style reticle and readout accent. Not auto-selected by " +
    "selectEvidenceOverlayShots() today (see that function's doc comment in " +
    "src/lib/hyperframesOverlay.ts) — kept available for a future, " +
    "separately-scoped gating rule such as a spatial_anchor shot inside an " +
    "investigation beat.",
  kind: "overlay_template",
  templateId: "tracking_hud",
  suitedNarrativeRoles: ["investigation"],
};

/* ------------------------------------------------------------- PROP REFS -- */

const SEALED_EVIDENCE_FOLDER: TrueCrimePropAssetDef = {
  id: "prop_sealed_evidence_folder",
  label: "Sealed Evidence Folder",
  description: "A sealed, numbered case folder — a standard mannequin key-prop reference for investigation/evidence beats.",
  kind: "prop_reference",
  promptFragment: "a sealed manila case folder with a printed evidence number label and a red string tie",
};

const REDACTED_DOCUMENT: TrueCrimePropAssetDef = {
  id: "prop_redacted_document",
  label: "Redacted Document",
  description: "A printed document with black-bar redactions — for cited but privacy-sensitive source inserts.",
  kind: "prop_reference",
  promptFragment: "a printed document page with several black-bar redaction marks over identifying text",
};

const CHAIN_OF_CUSTODY_TAG: TrueCrimePropAssetDef = {
  id: "prop_chain_of_custody_tag",
  label: "Chain-of-Custody Tag",
  description: "A tied paper tag with a handwritten log line — for evidence-handling inserts.",
  kind: "prop_reference",
  promptFragment: "a small tied paper chain-of-custody tag with a handwritten date and initials log line",
};

const CORKBOARD_RED_STRING: TrueCrimePropAssetDef = {
  id: "prop_corkboard_red_string",
  label: "Corkboard Red String",
  description: "A pinned corkboard with photographs and connecting red string — investigation-board atmosphere.",
  kind: "prop_reference",
  promptFragment: "a corkboard with pinned photographs and documents connected by taut red string",
};

export const TRUE_CRIME_ASSET_BANK: Record<string, TrueCrimeAssetDef> = {
  overlay_case_file_stamp: CASE_FILE_STAMP_ASSET,
  overlay_evidence_tag: EVIDENCE_TAG_ASSET,
  overlay_tracking_hud: TRACKING_HUD_ASSET,
  prop_sealed_evidence_folder: SEALED_EVIDENCE_FOLDER,
  prop_redacted_document: REDACTED_DOCUMENT,
  prop_chain_of_custody_tag: CHAIN_OF_CUSTODY_TAG,
  prop_corkboard_red_string: CORKBOARD_RED_STRING,
};

export function getTrueCrimeAsset(id: string): TrueCrimeAssetDef | undefined {
  return TRUE_CRIME_ASSET_BANK[id];
}

// Every declared overlay template id used in this bank is a real
// hyperframesOverlay template id — kept as a cheap module-load sanity check
// rather than only relying on the union type at authoring time.
for (const asset of Object.values(TRUE_CRIME_ASSET_BANK)) {
  if (asset.kind === "overlay_template" && !(OVERLAY_TEMPLATE_IDS as readonly string[]).includes(asset.templateId)) {
    throw new Error(`trueCrimeAssetBank: asset ${asset.id} references unknown overlay template ${asset.templateId}`);
  }
}
