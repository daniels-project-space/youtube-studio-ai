import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function main(): Promise<void> {
  const [buildChannel, inception] = await Promise.all([
    readFile(join(root, "src/app/api/build-channel/route.ts"), "utf8"),
    readFile(join(root, "src/trigger/designChannelInception.ts"), "utf8"),
  ]);

  assert.match(
    buildChannel,
    /requiresReviewedLtxRuntime[\s\S]{0,800}resolveOwnerReviewedLtxRuntime[\s\S]{0,800}formatPreflight[\s\S]{0,900}\{ runtimeTarget \}/,
    "the authenticated creator route must derive—not accept—a reviewed runtime target before LTX-blocked preflight",
  );
  assert.match(
    buildChannel,
    /familyProductionReadiness\(family\.key, runtimeTarget\)/,
    "the API must repeat the dynamic runtime target at its independent family-readiness gate",
  );

  const reviewedRuntime = inception.indexOf("const reviewedLtxRuntime = await resolveOwnerReviewedLtxRuntime");
  const creatorPreflight = inception.indexOf("const creatorPreflight = formatPreflight");
  const bootstrap = inception.indexOf("await bootstrapSecrets(log)");
  const preflightWrite = inception.indexOf("recordRoutePreflightReady");
  assert(reviewedRuntime >= 0 && creatorPreflight > reviewedRuntime,
    "direct Trigger inception must reload the owner-reviewed runtime before preflight");
  assert.match(
    inception,
    /familyProductionReadiness\(payload\.family, reviewedLtxRuntime\.runtime\)[\s\S]{0,300}certifiedFamilyAdmission\(payload\.family, reviewedLtxRuntime\.runtime\)/,
    "direct Trigger inception must use the same derived target for both independent admission checks",
  );
  assert.match(
    inception,
    /const designOptions: DesignOptions = \{[\s\S]{0,350}runtimeTarget: reviewedLtxRuntime\.runtime[\s\S]{0,1800}const design = designPipeline\(designOptions\)/,
    "the compiled channel pipeline must be generated from the verified target rather than browser state",
  );
  assert(preflightWrite >= 0 && preflightWrite < bootstrap,
    "the immutable private-benchmark qualification must be written before provider-capable inception starts");
  assert.match(
    inception,
    /readProductionRouteQualificationBinding[\s\S]{0,1500}readProductionRouteRuntimeEvidence[\s\S]{0,900}recordRoutePreflightReady/,
    "the preflight receipt must bind the exact route, planner, runtime, and pipeline instead of persisting a runtime flag alone",
  );

  console.log("reviewed LTX creator admission and preflight wiring tests passed");
}

void main();
