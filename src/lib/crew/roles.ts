/**
 * Crew role registry — the ready-made, declarative catalog of the per-video crew.
 * Reuses the canonical VIDEO_CREW_ROLES / ShowBible from the engine (no new role ids,
 * no duplicate truth). Each role declares the ShowBible doctrine field it owns and the
 * downstream stages it informs — so the resolver + Architect/Director are DATA-driven,
 * not 5 hardcoded brief blocks.
 */
import { VIDEO_CREW_ROLES, type VideoCrewRole } from "@/engine/creative/types";

export type CrewRoleId = VideoCrewRole; // "director" | "cinematographer" | "editor" | "composer" | "critic"

export interface CrewRoleDef {
  id: CrewRoleId;
  title: string;
  /** The ShowBible field holding this role's authored doctrine. */
  doctrineField: "directorDoctrine" | "dpDoctrine" | "editorDoctrine" | "composerDoctrine" | "criticDoctrine";
  /** Downstream spine stages this role's direction feeds. */
  informs: string[];
  responsibility: string;
}

export const CREW_ROLE_DEFS: Record<CrewRoleId, CrewRoleDef> = {
  director: { id: "director", title: "Director", doctrineField: "directorDoctrine", informs: ["script", "visual", "assemble"], responsibility: "story shape + visual grammar" },
  cinematographer: { id: "cinematographer", title: "Cinematographer", doctrineField: "dpDoctrine", informs: ["visual"], responsibility: "look · shot grammar · lighting" },
  editor: { id: "editor", title: "Editor", doctrineField: "editorDoctrine", informs: ["assemble", "layer"], responsibility: "cut rhythm + pacing (cutSheet)" },
  composer: { id: "composer", title: "Composer", doctrineField: "composerDoctrine", informs: ["narration", "assemble"], responsibility: "score palette + mood" },
  critic: { id: "critic", title: "Critic", doctrineField: "criticDoctrine", informs: ["verify"], responsibility: "authors the ValidationSpec the verify stage enforces" },
};

/** Canonical role order (= VIDEO_CREW_ROLES). */
export const CREW_ROLE_ORDER: readonly CrewRoleId[] = VIDEO_CREW_ROLES;
