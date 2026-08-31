import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CERTIFIED_AUTOMATIC_FAMILY_ADMISSION_DEFINITIONS,
  assertCertifiedFamilyAdmissionCatalog,
  certifiedFamilyAdmission,
  certifiedFamilyAdmissionCanAwaitRuntimeEvidence,
} from "@/engine/certifiedFamilyAdmission";
import { formatPreflight } from "@/engine/creative/selectFormat";
import { FAMILY_KEYS, familyProductionReadiness, type FamilyKey } from "@/engine/families";

assert.doesNotThrow(
  () => assertCertifiedFamilyAdmissionCatalog(),
  "every current productionReady family must have a complete CertifiedFamilyAdmission",
);

const automaticFamilies = FAMILY_KEYS.filter((family) => familyProductionReadiness(family).productionReady);
const declaredAutomaticFamilies = CERTIFIED_AUTOMATIC_FAMILY_ADMISSION_DEFINITIONS.map((definition) => definition.family);
const declaredAutomaticFamilySet = new Set<FamilyKey>(declaredAutomaticFamilies);
assert.ok(
  automaticFamilies.every((family) => declaredAutomaticFamilySet.has(family)),
  "automatic admission must be explicit: no family may inherit production readiness without a certified route/composition/policy record",
);

for (const family of automaticFamilies) {
  const admission = certifiedFamilyAdmission(family);
  assert.equal(admission.mode, "automatic", `${family} must have automatic admission mode`);
  assert.equal(admission.automatic, true, `${family} must be admitted only after every cross-check passes`);
  assert.ok(admission.routeKeys.length > 0, `${family} requires at least one certified program route`);
  assert.ok(admission.compositionKey, `${family} requires a baseline certified composition`);
  assert.deepEqual(
    admission.checks,
    {
      productionReadiness: true,
      route: true,
      composition: true,
      inception: true,
      editorialPolicy: true,
      referenceQuality: true,
      runtime: true,
    },
    `${family} must not claim production readiness while any family-admission receipt is missing`,
  );
}

const illustrated = certifiedFamilyAdmission("illustrated_explainer");
assert.equal(illustrated.compositionKey, "illustrated_original_explainer");
assert.deepEqual(illustrated.routeKeys, [
  "illustrated-explainer/foundation/v1",
  "illustrated-explainer/fictional-decision-lab/v1",
  "illustrated-explainer/fictional-ai-town/v1",
  "illustrated-explainer/fictional-ai-pov/v1",
]);
assert.equal(
  formatPreflight("illustrated_explainer", {
    concept: "A clear, original illustrated explanation with a repeatable viewer payoff.",
    nicheKey: "educational",
  }).certifiedFamilyAdmission.automatic,
  true,
  "creator preflight must expose the same certified automatic admission used by the direct Trigger boundary",
);

const children = certifiedFamilyAdmission("children_learning");
assert.equal(children.automatic, false);
assert.equal(children.mode, "supervised");
assert.equal(children.reviewScope, "private_human_child_editor_review_only");

const lore = certifiedFamilyAdmission("loreshort");
assert.equal(lore.automatic, false);
assert.ok(
  declaredAutomaticFamilySet.has("loreshort"),
  "Lore must declare its full route/composition/inception agreement before a benchmark can promote it",
);
assert.equal(lore.checks.runtime, false, "the LTX benchmark remains an independent final admission gate");

const cinematic = certifiedFamilyAdmission("cinematic");
assert.equal(cinematic.automatic, false);
assert.equal(cinematic.mode, "blocked");
assert.equal(
  cinematic.checks.editorialPolicy,
  true,
  "a blocked family can still have a real production quality gate",
);
assert.ok(
  !cinematic.blockers.some((blocker) => blocker.includes("has no matching production editorial quality gate")),
  "missing automatic-admission registration must not be misreported as missing release quality policy",
);
assert.ok(
  cinematic.blockers.every((blocker) => blocker.includes("ltx_2_5_revision_not_benchmarked_on_rtx_4090")),
  "the cinematic route, composition, planning, inception, and quality contracts are now registered; only the independently measured LTX runtime may block it",
);
assert.ok(
  !cinematic.blockers.some((blocker) => blocker.includes("no explicit CertifiedFamilyAdmission definition")),
  "a future benchmark must promote the already-registered cinematic foundation rather than relying on a flag-only admission change",
);
assert.deepEqual(
  cinematic.checks,
  {
    productionReadiness: false,
    route: true,
    composition: true,
    inception: true,
    editorialPolicy: true,
    referenceQuality: true,
    runtime: false,
  },
  "cinematic remains fail-closed only at the exact unmeasured Novita runtime boundary",
);
assert.equal(
  certifiedFamilyAdmissionCanAwaitRuntimeEvidence(cinematic),
  true,
  "cinematic may proceed only to the read-only reviewed-runtime lookup; it is not automatically admitted yet",
);
assert.equal(
  certifiedFamilyAdmissionCanAwaitRuntimeEvidence(children),
  false,
  "a supervised/private-only family cannot disguise itself as a runtime-only automatic candidate",
);
const whiteboard = certifiedFamilyAdmission("whiteboard");
assert.equal(
  certifiedFamilyAdmissionCanAwaitRuntimeEvidence(whiteboard),
  false,
  "a family missing more than runtime proof is rejected before owner/provider admission",
);

const inceptionSource = readFileSync(new URL("../../trigger/designChannelInception.ts", import.meta.url), "utf8");
const certifiedGate = inceptionSource.indexOf("const certifiedAdmission = certifiedFamilyAdmission(payload.family);");
const ownerAdmission = inceptionSource.indexOf("const ownerId = admitProviderTaskOwner({");
const illustratedFoundation = inceptionSource.indexOf('if (payload.family === "illustrated_explainer")');
assert.ok(certifiedGate >= 0 && ownerAdmission >= 0 && certifiedGate < ownerAdmission);
assert.ok(
  certifiedGate >= 0 && illustratedFoundation >= 0 && certifiedGate < illustratedFoundation,
  "CertifiedFamilyAdmission must stop a false automatic family claim before the deterministic illustrated foundation can run",
);

console.log("CertifiedFamilyAdmission cross-check tests passed");
