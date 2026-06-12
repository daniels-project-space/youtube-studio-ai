/**
 * SCRIPTCRAFT — the script + hook engine as ONE standalone module (the second
 * GOLDEN module, same integration shape as the banana thumbnail engine):
 * identity in → judged, fact-checked, journey-structured script out.
 *
 * The chain a single craftScript() call runs:
 *   1. HOOKCRAFT cold open — 4 device-diverse candidates (latest Gemini Pro),
 *      deterministic craft lint (≤7s first sentence, banned filler, concrete
 *      anchor), judge gates punch/specificity/curiosity/voiceMatch/promise ≥7,
 *      then a Google-Search-grounded FACT-CHECK that rejects any candidate
 *      with a false claim. One feedback retry, then loud failure.
 *   2. VOICE — the niche's archetype doctrine (narrator-teacher history,
 *      teacher-advisor finance, chaos-commentator drama, gentle-guide
 *      meditation, …) shapes the cold open AND the whole narration; the
 *      channel's Style-DNA register outranks it. ElevenLabs-v3 channels get
 *      the archetype's performed audio-tag palette.
 *   3. NARRATION — the latest Gemini Pro writes the script continuing from
 *      the cold open as a Calm-style STORY JOURNEY: arrival ritual →
 *      experience-before-explanation movements carried by ONE image →
 *      integration into the viewer's day → a landing that pays off the
 *      hook's loop and distills THE QUOTE (closingLine).
 *   4. SERIES — episodic programs pass `series` (episode N of M, previous
 *      thread, next seed) for phase-aware curriculum continuity.
 *
 * Deps: GEMINI_API_KEY only (vault service "gemini"). Downstream, qa_script
 * verifies the loop payoff + midpoint re-hook against Script.hookLoop.
 *
 *   import { craftScript, hasScriptcraft } from "@/lib/scriptcraft";
 *   const script = await craftScript({ topic, channelName, niche, persona,
 *     narrative, style, maxSeconds, series, voiceTags }, log);
 *   // script.hook (the cold open) · script.sections (role-tagged arc) ·
 *   // script.hookLoop (the promise) · script.closingLine (THE QUOTE)
 */
export { hasGeminiKey as hasScriptcraft } from "@/lib/gemini";
export {
  craftHook,
  lintHook,
  hasHookcraft,
  HOOK_DEVICES,
  BANNED_OPENERS,
  type CraftedHook,
  type HookCraftArgs,
  type HookVerdict,
  type HookLint,
} from "@/lib/hookcraft";
export {
  synthScript as craftScript,
  translateScript,
  sanitizeSpoken,
  type Script,
  type ScriptRequest,
  type ScriptSection,
  type SeriesContext,
} from "@/lib/scriptGen";
export { resolveVoiceDoctrine, V3_TAG_PALETTES, CRAFT_RULES, type VoiceDoctrine } from "@/engine/golden";
