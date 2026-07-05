/**
 * Cinematographer (DP) crew sub-module test (tsx). Proves the DP is a real,
 * customizable, registered module and that its directives encode COVERAGE
 * discipline (varied sizes + inserts + camera vocabulary + not-host-only).
 * planCoverage (LLM) is exercised in the e2e smoke, not here.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { resolveKnobs } from "@/engine/customization";
import {
  resolveCinematographerConfig,
  defaultCinematographerConfig,
  cinematographerDirectives,
  CINEMATOGRAPHER_SURFACE,
} from "../cinematographer";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "dp_brief", params }],
  });
}

function configResolves(): void {
  const doc = resolveCinematographerConfig(profileWith({ preset: "documentary" }));
  assert.equal(doc.coverageDensity, 3, "documentary = rich coverage (3/beat)");
  assert.equal(doc.insertFrequency, "rich", "documentary = rich inserts");
  assert.equal(doc.lightingKey, "low_key", "documentary = low-key lighting");

  const cine = resolveCinematographerConfig(profileWith({ preset: "cinematic" }));
  assert.equal(cine.lensLanguage, "anamorphic", "cinematic = anamorphic lens");
  assert.equal(cine.lightingKey, "noir", "cinematic = noir lighting");
  assert.equal(cine.speedRamps, true, "cinematic = speed ramps on");

  const sh = resolveCinematographerConfig(profileWith({ preset: "shorts" }));
  assert.equal(sh.coverageDensity, 1, "shorts = spare coverage");
  assert.equal(sh.cameraEnergy, "frenetic", "shorts = frenetic camera");

  // override on top of preset
  const ov = resolveCinematographerConfig(profileWith({ preset: "documentary", cameraEnergy: "dynamic" }));
  assert.equal(ov.cameraEnergy, "dynamic", "override wins over preset");
  console.log("CONFIG PASS: DP presets + overrides resolve");
}

function defaultsResolve(): void {
  const d = defaultCinematographerConfig();
  assert.equal(d.coverageDensity, 2, "default density 2");
  assert.equal(d.shotSizeMix, "balanced", "default balanced mix");
  assert.equal(d.cameraEnergy, "measured", "default measured camera");
  console.log("DEFAULTS PASS: defaultCinematographerConfig = knob defaults");
}

function directivesEncodeCoverage(): void {
  const cfg = resolveCinematographerConfig(profileWith({ preset: "documentary" }));
  const dir = cinematographerDirectives(cfg);
  assert.ok(dir.shotSizes.length >= 3, "multiple shot sizes");
  assert.ok(dir.cameraMoves.length >= 3, "a camera-move vocabulary");
  assert.ok(dir.insertGuidance.length > 0, "insert guidance present");
  assert.ok(/host/i.test(dir.rubric), "rubric enforces NOT host-only");
  assert.ok(/insert|cutaway/i.test(dir.rubric), "rubric calls for inserts/cutaways");
  assert.equal(dir.coverageDensity, 3, "directives carry density");
  console.log("DIRECTIVES PASS: coverage rubric (sizes + inserts + not-host-only + camera vocab)");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(CINEMATOGRAPHER_SURFACE.presets)) {
    assert.ok(resolveKnobs(CINEMATOGRAPHER_SURFACE, name).ok, `DP preset '${name}' valid`);
  }
  assert.ok(configurableModules().some((m) => m.blockId === "dp_brief"), "DP registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("dp_brief")?.knobs.some((k) => k.id === "coverageDensity"), "DP surface UI-enumerable");
  assert.throws(() => resolveCinematographerConfig(profileWith({ coverageDensity: 99 })), /resolveCinematographerConfig/, "out-of-range coverageDensity throws");
  console.log("SURFACE/REGISTRY PASS: presets valid + registered + illegal throws");
}

function main(): void {
  configResolves();
  defaultsResolve();
  directivesEncodeCoverage();
  surfaceAndRegistry();
  console.log("\nALL CINEMATOGRAPHER TESTS PASSED");
}

main();
