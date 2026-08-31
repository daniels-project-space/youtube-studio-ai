import assert from "node:assert/strict";
import { automaticFamilyCreatorReadiness } from "@/engine/automaticFamilyCreatorReadiness";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILY_KEYS, familyProductionReadiness } from "@/engine/families";

for (const family of FAMILY_KEYS) {
  const readiness = automaticFamilyCreatorReadiness(family);
  const renderer = familyProductionReadiness(family);
  const certified = certifiedFamilyAdmission(family);
  assert.equal(
    readiness.ready,
    renderer.productionReady && certified.automatic,
    `${family} must never be offered by the automatic creator on renderer readiness alone`,
  );
  if (readiness.ready) assert.deepEqual(readiness.blockers, []);
}

for (const family of ["children_learning", "cinematic", "music_loop", "loreshort"] as const) {
  assert.equal(
    automaticFamilyCreatorReadiness(family).ready,
    false,
    `${family} must remain out of automatic creator selection until its exact admission exists`,
  );
}

console.log("AUTOMATIC FAMILY CREATOR READINESS PASS");
