import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exampleClipAnalysisUnavailable } from "@/lib/exampleClipAnalysisUnavailable";

const unavailable = exampleClipAnalysisUnavailable();
assert.deepEqual(unavailable, {
  ok: false,
  available: false,
  status: "UNAVAILABLE",
  code: "NO_GEMINI_EXAMPLE_CLIP_ANALYSIS",
  analysisPerformed: false,
  error: "Example-video analysis is unavailable because the former Gemini-backed analyzer is disabled by the no-Gemini runtime policy.",
  remediation: "Describe the channel for a deterministic local format recommendation, or select a format manually.",
});

const source = readFileSync(new URL("./analyzeClip.ts", import.meta.url), "utf8");
assert.match(source, /return exampleClipAnalysisUnavailable\(\);/);
assert.match(source, /@\/lib\/exampleClipAnalysisUnavailable/);
assert.doesNotMatch(source, /@\/lib\/(bootstrap|clipAnalysis)|geminiAnalyzeYouTube|analyzeClip\(url\)/);

console.log("No-Gemini example-clip Trigger compatibility task tests passed");
