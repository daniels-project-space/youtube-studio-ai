import assert from "node:assert/strict";

import {
  evidenceVisualManifestAllowsNumbers,
  evidenceVisualManifestFingerprint,
  evaluateEvidenceVisualManifest,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { EpisodeVisualStateSchema, type SceneManifest } from "@/engine/episodeGraph";
import { sceneKindFor } from "@/remotion/sceneCompiler/SceneCompiler";

const now = Date.now();
const source = {
  id: "source-stat-office",
  name: "National Statistics Office",
  url: "https://statistics.example.org/release",
  snapshotSha256: "a".repeat(64),
};
const chartBase = {
  version: "evidence-visual-manifest/v1" as const,
  id: "visual-labour-trend",
  visualKind: "chart" as const,
  surface: "scene_compiler" as const,
  targetSceneId: "scene-labour-trend",
  sources: [source],
  narrationAnchors: [{
    id: "anchor-labour-trend",
    sentenceId: "sentence-labour-trend",
    startSec: 12,
    endSec: 18,
    spokenText: "According to the National Statistics Office, unemployment moved from 5.0% to 4.1%.",
    requiredAttribution: "National Statistics Office",
    sourceIds: [source.id],
  }],
  values: [
    { id: "value-unemployment-start", sourceId: source.id, narrationAnchorId: "anchor-labour-trend", role: "series" as const, value: 5, unit: "percent", display: "5.0%" },
    { id: "value-unemployment-end", sourceId: source.id, narrationAnchorId: "anchor-labour-trend", role: "series" as const, value: 4.1, unit: "percent", display: "4.1%" },
  ],
  attribution: { visibleText: "National Statistics Office", sourceIds: [source.id] },
};
const chart: EvidenceVisualManifest = {
  ...chartBase,
  review: {
    decision: "approved",
    reviewerId: "reviewer-1",
    reviewId: "review-labour-trend",
    reviewedAt: new Date(now).toISOString(),
    reviewedManifestFingerprint: evidenceVisualManifestFingerprint(chartBase),
  },
};

const admittedChart = evaluateEvidenceVisualManifest(chart, {
  sceneId: "scene-labour-trend",
  narrationSentenceIds: ["sentence-labour-trend"],
  now,
});
assert.equal(admittedChart.safe, true);
assert.equal(admittedChart.receipt?.sourceSnapshotSha256[source.id], source.snapshotSha256);
assert.deepEqual(admittedChart.receipt?.narrationAnchorIds, ["anchor-labour-trend"]);
assert.equal(evidenceVisualManifestAllowsNumbers(chart, [5, 4.1]), true);
assert.equal(evidenceVisualManifestAllowsNumbers(chart, [4.6]), false, "interpolated points cannot become factual chart data");
const evidenceArtifact = artifactContract("evidenceVisualManifests");
assert.equal(evidenceArtifact.type, "EvidenceVisualManifest[]");
assert.equal(evidenceArtifact.opaque, false);
assert.equal(evidenceArtifact.persist, "reference");
assert.doesNotThrow(() => validateArtifact(evidenceArtifact, [chart]));

const wrongScene = evaluateEvidenceVisualManifest(chart, {
  sceneId: "scene-other",
  narrationSentenceIds: ["sentence-labour-trend"],
  now,
});
assert.equal(wrongScene.safe, false);
assert.ok(wrongScene.issues.some((issue) => issue.code === "scene_target_mismatch"));

const inventedPoint = evaluateEvidenceVisualManifest({
  ...chart,
  values: [...chart.values, {
    id: "value-invented",
    sourceId: source.id,
    narrationAnchorId: "anchor-labour-trend",
    role: "series",
    value: 4.6,
    unit: "percent",
    display: "4.6%",
  }],
}, { sceneId: "scene-labour-trend", narrationSentenceIds: ["sentence-labour-trend"], now });
assert.equal(inventedPoint.safe, false);
assert.ok(inventedPoint.issues.some((issue) => issue.code === "value_not_spoken"));

const geoBase = {
  ...chartBase,
  id: "visual-route",
  visualKind: "geo_map" as const,
  targetSceneId: "scene-route",
  narrationAnchors: [{
    id: "anchor-route",
    sentenceId: "sentence-route",
    startSec: 22,
    endSec: 27,
    spokenText: "According to the National Statistics Office, the route runs from 51.5074 to 48.8566 and longitude -0.1278 to 2.3522.",
    requiredAttribution: "National Statistics Office",
    sourceIds: [source.id],
  }],
  values: [
    { id: "lat-london", sourceId: source.id, narrationAnchorId: "anchor-route", role: "latitude" as const, value: 51.5074, unit: "degrees north", display: "51.5074" },
    { id: "lon-london", sourceId: source.id, narrationAnchorId: "anchor-route", role: "longitude" as const, value: -0.1278, unit: "degrees east", display: "-0.1278" },
    { id: "lat-paris", sourceId: source.id, narrationAnchorId: "anchor-route", role: "latitude" as const, value: 48.8566, unit: "degrees north", display: "48.8566" },
    { id: "lon-paris", sourceId: source.id, narrationAnchorId: "anchor-route", role: "longitude" as const, value: 2.3522, unit: "degrees east", display: "2.3522" },
  ],
};
const geo: EvidenceVisualManifest = {
  ...geoBase,
  review: {
    decision: "approved",
    reviewerId: "reviewer-1",
    reviewId: "review-route",
    reviewedAt: new Date(now).toISOString(),
    reviewedManifestFingerprint: evidenceVisualManifestFingerprint(geoBase),
  },
};
assert.equal(evaluateEvidenceVisualManifest(geo, { sceneId: "scene-route", narrationSentenceIds: ["sentence-route"], now }).safe, true);

assert.equal(EpisodeVisualStateSchema.safeParse({ action: "Show a reviewed labour trend", props: [], evidenceVisualIntent: "factual_chart" }).success, false);
assert.equal(EpisodeVisualStateSchema.safeParse({ action: "Show an illustrative route", props: [] }).success, true, "legacy fiction/illustration remains valid");
assert.equal(
  sceneKindFor({ id: "scene-labour-trend", kind: "lesson", visualState: { evidenceVisualIntent: "factual_chart" } } as unknown as SceneManifest["scenes"][number]),
  "chart",
  "a declared factual chart cannot fall through to seeded lesson geometry",
);
assert.equal(
  sceneKindFor({ id: "scene-route", kind: "lesson", visualState: { evidenceVisualIntent: "factual_geo" } } as unknown as SceneManifest["scenes"][number]),
  "map",
  "a declared factual geo visual routes to the map surface, where a missing manifest is withheld",
);

console.log("Evidence visual manifest tests passed");
