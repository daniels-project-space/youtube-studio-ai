import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function retiredTasksNeverReachProviders(): void {
  const comic = source("../renderValidatedComic.ts");
  assert.match(comic, /standalone paid rendering has no signed compiler reservation/i);
  assert.doesNotMatch(comic, /createAttestedNovitaImageGenerator/);
  assert.doesNotMatch(comic, /bootstrapSecrets/);

  const art = source("../channelArt.ts");
  assert.match(art, /a channel id alone is not a signed provider budget or lifecycle/i);
  assert.doesNotMatch(art, /generateChannelArt\(/);
  assert.doesNotMatch(art, /bootstrapSecrets/);
}

function maintenanceTasksDoNotCreateUnadmittedArt(): void {
  const bible = source("../refreshShowBible.ts");
  assert.match(bible, /refuses standalone paid art generation/i);
  assert.doesNotMatch(bible, /generateChannelArt\(/);

  const multilingual = source("../makeMultilingual.ts");
  assert.match(multilingual, /localized identity art requires an admitted per-sibling provider envelope and lifecycle/i);
  assert.doesNotMatch(multilingual, /generateFlagBanner\(/);
  assert.doesNotMatch(multilingual, /createChannel\(/);
}

function forgeChecksAllI2VBeforeProviderPrimitives(): void {
  const forge = source("../../engine/forge/runtime.ts");
  assert.match(forge, /function forgedSpecUsesI2V/);
  assert.match(forge, /assertForgedRuntimeAdmissible\(spec\)/);
  assert.match(forge, /assertPipelineVideoRuntimeReady/);
  assert(
    forge.indexOf("assertForgedRuntimeAdmissible(spec)") < forge.indexOf("makeRunTempDir(ctx.runId)"),
    "Forge must reject an incompatible I2V spec before it can reach a provider-adjacent primitive.",
  );
}

retiredTasksNeverReachProviders();
maintenanceTasksDoNotCreateUnadmittedArt();
forgeChecksAllI2VBeforeProviderPrimitives();

console.log("orphan paid-path retirement test passed");
