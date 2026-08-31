import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function main(): void {
  const source = readFileSync(resolve(process.cwd(), "src/trigger/runPipeline.ts"), "utf8");

  const benchmarkAdmission = source.indexOf("assertRouteQualificationBenchmarkAdmission");
  const benchmarkApproval = source.indexOf('action: "route-qualification-benchmark"');
  assert(
    benchmarkAdmission >= 0 && benchmarkApproval > benchmarkAdmission,
    "a full benchmark must have its own signed action rather than borrowing a shortened probe approval",
  );
  assert.match(
    source,
    /path: payload\.probeAdmission \|\| payload\.routeQualificationBenchmarkAdmission[\s\S]{0,80}\? "private_benchmark_manual"/,
    "the benchmark may consume only a private preflight receipt before work starts",
  );
  const resultFailure = source.indexOf("if (!result.ok)");
  const releasePromotion = source.indexOf("sealed route_release_qualified receipt from exact private final-master benchmark");
  const completeRun = source.indexOf("api.runs.completeRun", resultFailure);
  assert(
    resultFailure >= 0 && releasePromotion > resultFailure && completeRun > releasePromotion,
    "final-master qualification must occur after a passing engine result and before the run is marked complete",
  );
  assert.match(
    source,
    /routePreflightQualificationEvidence[\s\S]{0,1600}readProductionRouteProvenanceEvidenceFromReleaseCertificate[\s\S]{0,900}recordRouteReleaseQualified/,
    "promotion must combine the immutable preflight, final QA, and reloaded certificate before writing release qualification",
  );
  assert.match(
    source,
    /runtime evidence changed or was revoked during execution/,
    "a revised or revoked reviewed runtime must fail the benchmark before promotion",
  );

  console.log("ROUTE QUALIFICATION BENCHMARK WIRING TESTS PASS");
}

main();
