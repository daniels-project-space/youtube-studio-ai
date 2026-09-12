/**
 * A stored creative assignment is not automatically an experiment.
 *
 * Most published videos have one title and one thumbnail. Their ordinary
 * analytics are useful context, but they cannot identify a winning package:
 * audience mix, seasonality, traffic source, and the video itself all vary at
 * once. YouTube's native title/thumbnail test is the distinct case that
 * concurrently serves variants and resolves a watch-time-share verdict.
 *
 * `contentExperiments` is a legacy table name and cannot be renamed without a
 * data migration. This contract makes the distinction explicit at its write
 * boundary so no caller can silently turn an ordinary observation into an A/B
 * learning example.
 */
export const CREATIVE_MEASUREMENT_KINDS = [
  "single_variant_observation",
  "youtube_native_ab",
] as const;

export type CreativeMeasurementKind = typeof CREATIVE_MEASUREMENT_KINDS[number];

export function creativeMeasurementKind(value: unknown): CreativeMeasurementKind {
  return value === "youtube_native_ab" ? "youtube_native_ab" : "single_variant_observation";
}

export type CreativeObservationAdmission =
  | { pass: true; kind: "single_variant_observation" }
  | { pass: false; kind: "youtube_native_ab"; reason: string };

/**
 * Ordinary Analytics API data may be attached to one assigned package only.
 * It must never be used to resolve a native test, whose authoritative result
 * needs the platform's variant-level watch-time-share verdict.
 */
export function admitOrdinaryCreativeObservation(
  kind: unknown,
): CreativeObservationAdmission {
  const resolved = creativeMeasurementKind(kind);
  if (resolved === "youtube_native_ab") {
    return {
      pass: false,
      kind: resolved,
      reason: "native A/B results require YouTube's variant-level watch-time-share verdict, not an ordinary video analytics snapshot",
    };
  }
  return { pass: true, kind: resolved };
}

