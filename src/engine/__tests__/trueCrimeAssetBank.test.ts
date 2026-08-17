import assert from "node:assert/strict";

import { OVERLAY_TEMPLATE_IDS } from "@/lib/hyperframesOverlay";
import { TRUE_CRIME_ASSET_BANK, getTrueCrimeAsset } from "@/engine/trueCrimeAssetBank";

// Mirrors the shape-assertion style of src/engine/__tests__/ltxStylePresets.test.ts.

const ids = Object.keys(TRUE_CRIME_ASSET_BANK);
assert.ok(ids.length > 0, "TRUE_CRIME_ASSET_BANK must not be empty");

for (const id of ids) {
  const asset = TRUE_CRIME_ASSET_BANK[id]!;
  assert.equal(asset.id, id, `asset key "${id}" must match its own id field`);
  assert.ok(asset.label.trim().length > 0, `${id}: label must be non-empty`);
  assert.ok(asset.description.trim().length > 0, `${id}: description must be non-empty`);

  if (asset.kind === "overlay_template") {
    assert.ok(
      (OVERLAY_TEMPLATE_IDS as readonly string[]).includes(asset.templateId),
      `${id}: templateId "${asset.templateId}" must be a real hyperframesOverlay template id`,
    );
    assert.ok(asset.suitedNarrativeRoles.length > 0, `${id}: suitedNarrativeRoles must not be empty`);
  } else if (asset.kind === "prop_reference") {
    assert.ok(asset.promptFragment.trim().length > 0, `${id}: promptFragment must be non-empty`);
  } else {
    assert.fail(`${id}: unknown asset kind`);
  }
}

// Both required categories are represented.
assert.ok(ids.some((id) => TRUE_CRIME_ASSET_BANK[id]!.kind === "overlay_template"), "must include at least one overlay_template asset");
assert.ok(ids.some((id) => TRUE_CRIME_ASSET_BANK[id]!.kind === "prop_reference"), "must include at least one prop_reference asset");

// No grain/vignette numeric-preset category — that would duplicate the
// per-style grain/vignette fields already on LtxStyleDef/DocuTheme.
for (const asset of Object.values(TRUE_CRIME_ASSET_BANK)) {
  assert.ok(!("grain" in asset), `${asset.id}: must not duplicate LtxStyleDef/DocuTheme's grain field`);
  assert.ok(!("vignette" in asset), `${asset.id}: must not duplicate LtxStyleDef/DocuTheme's vignette field`);
}

// All three overlay templates from Part A are referenced by id from this bank.
for (const templateId of OVERLAY_TEMPLATE_IDS) {
  assert.ok(
    Object.values(TRUE_CRIME_ASSET_BANK).some((asset) => asset.kind === "overlay_template" && asset.templateId === templateId),
    `expected an asset-bank entry referencing overlay template "${templateId}"`,
  );
}

// getTrueCrimeAsset() behavior.
assert.equal(getTrueCrimeAsset("overlay_case_file_stamp")?.kind, "overlay_template");
assert.equal(getTrueCrimeAsset("prop_sealed_evidence_folder")?.kind, "prop_reference");
assert.equal(getTrueCrimeAsset("not-a-real-asset"), undefined, "an unknown id must return undefined rather than throwing");

console.log("trueCrimeAssetBank: all assertions passed");
