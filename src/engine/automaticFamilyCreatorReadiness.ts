import { certifiedFamilyAdmission, type CertifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import {
  familyProductionReadiness,
  type FamilyKey,
  type FamilyProductionReadiness,
} from "@/engine/families";

export interface AutomaticFamilyCreatorReadiness {
  readonly family: FamilyKey;
  /**
   * The only truthful automatic-creator state. A renderer being ready is
   * necessary but insufficient: the sealed route, composition, inception,
   * quality policy, and runtime admission must agree as well.
   */
  readonly ready: boolean;
  readonly productionReadiness: FamilyProductionReadiness;
  readonly certifiedAdmission: CertifiedFamilyAdmission;
  readonly blockers: readonly string[];
}

function unique(values: readonly string[]): string[] {
  return values.filter((value, index) => value.length > 0 && values.indexOf(value) === index);
}

/**
 * Shared creator-facing readiness projection.
 *
 * Keep this separate from `familyProductionReadiness`: that lower-level
 * signal answers whether a family renderer can run, whereas this answers
 * whether the automatic channel creator may offer the family for selection.
 */
export function automaticFamilyCreatorReadiness(family: FamilyKey): AutomaticFamilyCreatorReadiness {
  const productionReadiness = familyProductionReadiness(family);
  const certifiedAdmission = certifiedFamilyAdmission(family);
  return {
    family,
    ready: productionReadiness.productionReady && certifiedAdmission.automatic,
    productionReadiness,
    certifiedAdmission,
    blockers: unique([
      ...productionReadiness.blockers,
      ...certifiedAdmission.blockers,
    ]),
  };
}
