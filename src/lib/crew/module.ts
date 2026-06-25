/**
 * CREW_MODULE — self-describing card for the Show-Bible + Crew module, with a
 * CustomizationSurface so the Architect/Director (and the onboarding/settings UI)
 * configure the crew per channel FROM DATA: which roles are active, the critic's
 * strictness, and style hints — zero per-role code paths.
 */
import type { CustomizationSurface } from "@/engine/customization";

export const CREW_SURFACE: CustomizationSurface = {
  capabilities: [
    "per-channel crew composition (not every channel needs every role)",
    "Show-Bible doctrine per role (director/DP/editor/composer/critic)",
    "critic authors the ValidationSpec the verify stage enforces",
    "market-aware critic (judge vs scraped real competitors)",
    "style hints (director style · editor cadence) for downstream modules",
  ],
  knobs: [
    // which roles are active for this channel
    { id: "director", type: "boolean", default: true, describes: "Director — story shape + visual grammar", servesStyles: ["all"] },
    { id: "cinematographer", type: "boolean", default: true, describes: "Cinematographer — look / shot grammar / lighting", servesStyles: ["cinematic", "documentary"] },
    { id: "editor", type: "boolean", default: true, describes: "Editor — cut rhythm + pacing", servesStyles: ["narrated", "shorts"] },
    { id: "composer", type: "boolean", default: true, describes: "Composer — score palette + mood", servesStyles: ["all"] },
    { id: "critic", type: "boolean", default: true, describes: "Critic — authors the verify ValidationSpec", servesStyles: ["quality"] },
    // direction
    { id: "criticStrictness", type: "enum", values: ["lenient", "standard", "strict"], default: "standard", describes: "how hard the critic gates output", servesStyles: ["documentary", "meditation"] },
    { id: "marketAwareCritic", type: "boolean", default: true, describes: "critic judges vs scraped real top competitors", servesStyles: ["competitive"] },
    { id: "directorStyle", type: "enum", values: ["classical", "kinetic", "contemplative", "bold"], default: "classical", describes: "director's visual-grammar stance (hint to downstream)", servesStyles: ["hype", "meditation"] },
    { id: "editorCadence", type: "enum", values: ["slow", "measured", "snappy", "frenetic"], default: "measured", describes: "editor's cut-rhythm philosophy (aligns with Assembly cutEnergy)", servesStyles: ["documentary", "shorts"] },
  ],
  presets: {
    documentary: { criticStrictness: "strict", editorCadence: "slow", directorStyle: "classical" },
    essay: {}, // full crew, standard — the default
    hype: { directorStyle: "bold", editorCadence: "frenetic" },
    shorts: { cinematographer: false, editorCadence: "frenetic", directorStyle: "kinetic" },
    meditation: { cinematographer: false, editor: false, criticStrictness: "lenient", editorCadence: "slow", directorStyle: "contemplative" },
    lofi: { cinematographer: false, editor: false, critic: false, directorStyle: "contemplative" },
  },
};

export const CREW_MODULE = {
  key: "show-bible",
  title: "Show Bible + Crew",
  stage: "brief",
  does:
    "Distills the channel's frozen Style-DNA into a Show Bible + a per-channel CREW (director / " +
    "cinematographer / editor / composer / critic) as DATA. A pure resolver reads which roles are active " +
    "(not every channel needs every role) + their authored doctrines, and the critic's doctrine becomes the " +
    "ValidationSpec the verify stage enforces. Standalone + composable; the Architect/Director read it to compose.",
  produces: {
    kind: "resolved_crew",
    file: "n/a (a typed brief, not media)",
    returns: "ResolvedCrew { members[{role,title,doctrine,informs}], criticStrictness, marketAwareCritic, directorStyle, editorCadence, warnings[] }",
  },
  requires: {
    channelProfile: "ChannelProfile — supplies the crew config (preset + overrides via moduleConfig['show-bible'])",
    showBible: "ShowBible (channel.identity.creativeBrief) — supplies each active role's authored doctrine",
  },
  optional: {
    "knob: criticStrictness": "lenient | standard | strict",
    "knob: marketAwareCritic": "critic judges vs scraped real competitors",
  },
  needs: { secrets: [] as string[], tools: [], note: "Pure resolver — no I/O. The Showrunner LLM (synthShowBible/crew briefs) authors the doctrines this module reads." },
  customization: CREW_SURFACE,
  rules: [
    "CREW IS DATA: roles + doctrines come from the ShowBible + CustomizationSurface — one pure resolver, no per-role code branches.",
    "OPT-IN ROLES: a role runs only if its knob is active; resolveCrew never assumes a fixed 5-role crew.",
    "NO SILENT GAPS: a role active without an authored doctrine is a typed warning (the brief stage / verify gate on it), never a silent generic brief.",
    "PER-ACCOUNT: every choice (active roles, critic strictness, style hints) comes from moduleConfig['show-bible'] (preset + overrides) — zero N code paths.",
    "CRITIC → VERIFY: the critic's doctrine authors the ValidationSpec the verify stage enforces; marketAwareCritic judges vs real competitors.",
  ],
} as const;
