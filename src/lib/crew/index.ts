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
// Crew sub-modules (per-member). Editor first — director/dp/composer/critic to follow.
export { EDITOR_SURFACE, EDITOR_MODULE, EDITOR_BLOCK, resolveEditorConfig, editorDirectives } from "./editor";
export type { EditorConfig, EditorDirectives } from "./editor";
export { COMPOSER_SURFACE, COMPOSER_MODULE, COMPOSER_BLOCK, resolveComposerConfig, composerDirectives } from "./composer";
export type { ComposerConfig, ComposerDirectives } from "./composer";
export { DIRECTOR_SURFACE, DIRECTOR_MODULE, DIRECTOR_BLOCK, resolveDirectorConfig, directorChapterPlan } from "./director";
export type { DirectorConfig, StructureBeat, ChapterWindow } from "./director";
