import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function main(): Promise<void> {
  const [buildChannel, inception] = await Promise.all([
    readFile(join(root, "src/app/api/build-channel/route.ts"), "utf8"),
    readFile(join(root, "src/trigger/designChannelInception.ts"), "utf8"),
  ]);

  for (const [label, source] of [["authenticated creator", buildChannel], ["Trigger inception", inception]] as const) {
    assert.doesNotMatch(
      source,
      /reviewedLtxRuntime|resolveOwnerReviewedLtxRuntime|runtimeTarget:\s*reviewed/u,
      `${label} must admit current H3 work without an obsolete LTX registry dependency`,
    );
  }
  assert.match(
    buildChannel,
    /const creatorPreflight = formatPreflight\(family\.key, briefToFormatSelectionInput\(programBrief,/u,
    "the authenticated creator must calculate the canonical format preflight before dispatch",
  );
  assert.match(
    buildChannel,
    /const runtimeReadiness = familyProductionReadiness\(family\.key\);/u,
    "the API must retain an independent current-runtime family gate",
  );
  assert.match(
    inception,
    /familyProductionReadiness\(payload\.family\);[\s\S]{0,300}certifiedFamilyAdmission\(payload\.family\);/u,
    "direct Trigger inception must repeat both current H3 admission checks",
  );
  const designOptions = inception.indexOf("const designOptions: DesignOptions = {");
  const compile = inception.indexOf("const design = designPipeline(designOptions);");
  assert.ok(
    designOptions >= 0 && compile > designOptions,
    "the compiled channel pipeline must still be built from the sealed brief after preflight",
  );
  assert.match(
    inception,
    /readProductionRouteQualificationBinding[\s\S]{0,1500}readProductionRouteRuntimeEvidence[\s\S]{0,900}recordRoutePreflightReady/u,
    "the preflight receipt must still bind the exact route, planner, runtime, and pipeline",
  );

  console.log("MiniMax H3 creator admission and preflight wiring tests passed");
}

void main();
