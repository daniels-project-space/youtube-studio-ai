import type { CustomizationSurface } from "@/engine/customization";

/** Pure manifest surface: safe to import from Convex schema/validation code. */
export const CINEMATOGRAPHER_SURFACE: CustomizationSurface = {
  capabilities: [
    "shot COVERAGE per beat (wide/medium/close + inserts + reactions — not host-only)",
    "camera-move grammar (dolly/crane/orbit/pan/crash-zoom, matched to energy)",
    "lens language + lighting key (the channel's optical look)",
    "cut-to-subject discipline (objective, antagonist, bystanders — story-driven)",
  ],
  knobs: [
    { id: "coverageDensity", type: "number", range: [1, 3], default: 2, describes: "shots per story beat (1 = spare, 3 = rich coverage)", servesStyles: ["cinematic", "documentary"] },
    { id: "shotSizeMix", type: "enum", values: ["balanced", "wide_led", "intimate", "kinetic"], default: "balanced", describes: "the shot-size palette — balanced / wide-establishing-led / close-up-intimate / dynamic-kinetic", servesStyles: ["cinematic", "documentary", "hype"] },
    { id: "insertFrequency", type: "enum", values: ["none", "light", "rich"], default: "light", describes: "how often to cut to INSERTS/cutaways (objects, hands, documents, mechanisms)", servesStyles: ["documentary", "explainer"] },
    { id: "cameraEnergy", type: "enum", values: ["locked", "measured", "dynamic", "frenetic"], default: "measured", describes: "camera-move vocabulary + intensity", servesStyles: ["meditation", "documentary", "hype", "shorts"] },
    { id: "lensLanguage", type: "enum", values: ["natural", "wide", "tele", "anamorphic"], default: "natural", describes: "lens character (natural 35-50mm / wide 18-24mm / tele 85-135mm / anamorphic + flares)", servesStyles: ["cinematic"] },
    { id: "lightingKey", type: "enum", values: ["natural", "low_key", "high_key", "noir"], default: "natural", describes: "lighting doctrine (natural / low-key moody / high-key bright / noir chiaroscuro)", servesStyles: ["cinematic", "documentary"] },
    { id: "speedRamps", type: "boolean", default: false, describes: "allow slow-motion / speed-ramp notes on hero shots (smooths AI jitter, adds prestige)", servesStyles: ["hype", "cinematic"] },
  ],
  presets: {
    documentary: { coverageDensity: 3, shotSizeMix: "balanced", insertFrequency: "rich", cameraEnergy: "measured", lensLanguage: "natural", lightingKey: "low_key" },
    essay: { coverageDensity: 2, shotSizeMix: "balanced", insertFrequency: "light", cameraEnergy: "measured" },
    cinematic: { coverageDensity: 3, shotSizeMix: "balanced", insertFrequency: "rich", cameraEnergy: "dynamic", lensLanguage: "anamorphic", lightingKey: "noir", speedRamps: true },
    hype: { coverageDensity: 2, shotSizeMix: "kinetic", insertFrequency: "light", cameraEnergy: "frenetic", speedRamps: true },
    shorts: { coverageDensity: 1, shotSizeMix: "kinetic", insertFrequency: "light", cameraEnergy: "frenetic" },
    meditation: { coverageDensity: 1, shotSizeMix: "wide_led", insertFrequency: "none", cameraEnergy: "locked", lightingKey: "high_key" },
  },
};

export const CINEMATOGRAPHER_MODULE = {
  key: "dp_brief",
  title: "Crew · Cinematographer",
  stage: "brief",
  does:
    "The cinematographer (DP) owns the look AND the shot coverage: it turns the script into a real shot list " +
    "with varied sizes (wide/medium/close), inserts/cutaways, reaction + antagonist cuts and subject variety — " +
    "with motivated camera moves, lens and lighting. planCoverage() produces cinecraft ShotSpecs the visual " +
    "stage (gen_footage) renders. Crew directs, the visual module renders.",
  produces: { kind: "shot_plan", file: "n/a", returns: "CinematographerConfig + DpDirectives + planCoverage(script) → ShotSpec[]" },
  requires: { channelProfile: "ChannelProfile — supplies DP preset + overrides (moduleConfig['dp_brief'])" },
  optional: { script: "the video's Script (hook + sections) — planCoverage plans coverage from it" },
  needs: { secrets: ["GEMINI_API_KEY"], tools: [], note: "Config/directives are pure; planCoverage calls Gemini Pro to author the shot list." },
  customization: CINEMATOGRAPHER_SURFACE,
  rules: [
    "DP OWNS COVERAGE: shot-size mix + inserts + reactions + camera grammar — NOT host-only push-ins.",
    "SUBJECT VARIETY: cut to the objective, the antagonist, bystanders and hands — empty subjects[] = atmosphere/insert.",
    "PER-ACCOUNT: all DP choices come from moduleConfig['dp_brief'] (preset + overrides).",
    "REUSES ShotSpec: planCoverage emits cinecraft ShotSpecs — no parallel shot type.",
  ],
} as const;
