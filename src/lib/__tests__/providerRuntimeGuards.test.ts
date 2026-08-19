import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { LTX_25_MODEL_REVISION, generationProfile } from "@/engine/generationProfiles";
import { parseJsonLoose } from "@/lib/gemini";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";

function novitaProfileGuard(): void {
  const profile = toNovitaPhaseProfile(generationProfile("production"), "video");
  assert.equal(profile.model, "Lightricks/LTX-2.5");
  assert.equal(profile.revision, LTX_25_MODEL_REVISION);
  assert.equal(profile.pipeline, "distilled");
  assert.equal(profile.twoStageRefine, true);
  assert.equal(profile.quantization, "fp8-cast");
  assert.equal(profile.offload, "cpu");
  assert.equal(profile.spatialUpscaleFactor, 2);
  assert.deepEqual([profile.width, profile.height, profile.stageOneWidth, profile.stageOneHeight], [1280, 704, 640, 352]);
  assert.equal(profile.infrastructure.weightStorage, "local-persistent-disk");
  assert.equal(profile.infrastructure.elasticGpuCeiling, 8);
  assert.equal(profile.allowFallback, false);
}

function trailingModelOutputGuard(): void {
  const parsed = parseJsonLoose<{ panels: number[] }>(
    '{"panels":[1,2,3]}\n{"duplicate":"model kept talking"}',
  );
  assert.deepEqual(parsed, { panels: [1, 2, 3] });
}

function comicFontGuard(): void {
  const scripts = join(process.cwd(), "scripts");
  const result = spawnSync(
    "python3",
    ["-c", "from mc_font import resolve_font, load_font; assert resolve_font(); assert load_font(28).getbbox('Golden')"],
    {
      cwd: scripts,
      env: { ...process.env, MC_FONT: "/definitely/missing/comic-font.ttf" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `comic font fallback failed: ${result.stderr || result.stdout}`);
}

novitaProfileGuard();
trailingModelOutputGuard();
comicFontGuard();
console.log("PROVIDER RUNTIME GUARDS PASS: Novita model pin, JSON tail repair, packaged font fallback");
