/**
 * Fail-closed tombstone for retired one-off Google/Gemini operator scripts.
 *
 * The only admitted Google model route is the sealed Nano Banana thumbnail
 * adapter in src/lib/banana.ts. Keep this separate from that adapter so a
 * manually run script cannot become an unreviewed second provider boundary.
 */
export function failClosedLegacyGoogleRuntimeScript(scriptName) {
  throw new Error(
    `${scriptName} is retired: direct Google/Gemini operator scripts are forbidden. ` +
      "Use the sealed thumbnail_gen module for approved Nano Banana work; all other pipelines must use their non-Google providers.",
  );
}
