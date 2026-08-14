/**
 * A truthful compatibility result for creator flows that once delegated example
 * video analysis to a remote model. This is deliberately not a best-effort
 * classification: callers must never manufacture style data for an unseen clip.
 */
export interface ExampleClipAnalysisUnavailable {
  ok: false;
  available: false;
  status: "UNAVAILABLE";
  code: "NO_GEMINI_EXAMPLE_CLIP_ANALYSIS";
  analysisPerformed: false;
  error: string;
  remediation: string;
}

export function exampleClipAnalysisUnavailable(): ExampleClipAnalysisUnavailable {
  return {
    ok: false,
    available: false,
    status: "UNAVAILABLE",
    code: "NO_GEMINI_EXAMPLE_CLIP_ANALYSIS",
    analysisPerformed: false,
    error: "Example-video analysis is unavailable because the former Gemini-backed analyzer is disabled by the no-Gemini runtime policy.",
    remediation: "Describe the channel for a deterministic local format recommendation, or select a format manually.",
  };
}
