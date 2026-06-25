/**
 * Crew — standalone, data-driven Show-Bible + Crew module.
 * Public surface: the role registry, the customization surface + card, and the pure
 * resolver the Architect/Director read.
 */
export { CREW_ROLE_DEFS, CREW_ROLE_ORDER } from "./roles";
export type { CrewRoleId, CrewRoleDef } from "./roles";
export { CREW_MODULE, CREW_SURFACE } from "./module";
export { resolveCrew, crewHasRole, CREW_BLOCK } from "./crewProfile";
export type { ResolvedCrew, ResolvedCrewMember, CriticStrictness } from "./crewProfile";
