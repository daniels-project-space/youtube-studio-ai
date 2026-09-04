/**
 * Every knob the onboarding UI offers must be a parameter the block actually
 * reads.
 *
 * A module surface is a promise to the operator: "set this and the pipeline
 * behaves differently." Nothing enforced that promise. A knob whose id no block
 * consults renders as a working control, validates on write, persists to the
 * channel — and changes nothing. That is indistinguishable from a working
 * feature until someone inspects output, which is exactly how the thumbnail
 * module carried five dead options for weeks.
 *
 * The failure this guards against is also asymmetric. Adding a knob is easy and
 * a plausible id is easy to get slightly wrong (`clickbait` vs
 * `clickbaitLevel`); nothing else in the codebase would notice, because both
 * typecheck and both validate.
 *
 * Deliberately a SOURCE check rather than a runtime one. Executing every block
 * to see which params it touches would need a full pipeline context, providers
 * and spend; reading how the block indexes ctx.params answers the same question
 * for free and cannot be fooled by a mocked context.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { CORE_MODULE_SURFACES } from "@/engine/moduleSurfaces";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function main(): void {
  // Blocks live under src/trigger/blocks; a few read their params through
  // engine helpers, so the whole of src is the haystack.
  const sources = [...walk(join(ROOT, "src", "trigger")), ...walk(join(ROOT, "src", "engine")), ...walk(join(ROOT, "src", "lib"))]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  const dead: string[] = [];
  for (const card of CORE_MODULE_SURFACES) {
    for (const knob of card.customization?.knobs ?? []) {
      // Both indexing styles occur in this codebase.
      const patterns = [
        `params["${knob.id}"]`,
        `params.${knob.id}`,
        `params?.["${knob.id}"]`,
        `params?.${knob.id}`,
      ];
      if (!patterns.some((pattern) => sources.includes(pattern))) {
        dead.push(`${card.key}.${knob.id}`);
      }
    }
  }

  assert.deepEqual(
    dead,
    [],
    `these knobs are offered in onboarding but no block reads them, so setting them changes nothing:\n  ${dead.join("\n  ")}`,
  );

  // The surface must also stay reachable: an unregistered block has its config
  // silently dropped by validateModuleConfigMap, which is how the whole title
  // module went unconfigurable.
  const keys = new Set(CORE_MODULE_SURFACES.map((card) => card.key));
  for (const required of ["metadata", "script_gen", "narration_tts", "visual_matter"]) {
    assert.ok(keys.has(required), `${required} must expose a surface or its channel config is dropped on write`);
  }

  // Presets may only reference knobs the same card declares. A preset naming a
  // knob that does not exist writes a value nothing will ever read.
  for (const card of CORE_MODULE_SURFACES) {
    const declared = new Set((card.customization?.knobs ?? []).map((knob) => knob.id));
    for (const [presetName, preset] of Object.entries(card.customization?.presets ?? {})) {
      for (const key of Object.keys(preset as Record<string, unknown>)) {
        assert.ok(
          declared.has(key),
          `${card.key} preset "${presetName}" sets "${key}", which the card does not declare`,
        );
      }
    }
  }

  console.log(`MODULE SURFACE WIRING PASS — ${CORE_MODULE_SURFACES.length} surfaces, every knob read by a block`);
}

main();
