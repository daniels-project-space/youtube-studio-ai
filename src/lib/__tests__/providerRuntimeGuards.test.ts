import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { LTX_23_MODEL_REVISION, generationProfile } from "@/engine/generationProfiles";
import { parseJsonLoose } from "@/lib/gemini";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";
import { boundFalVideoPrompt, FAL_VIDEO_PROMPT_MAX_CHARS } from "@/lib/providerText";

function providerPromptGuard(): void {
  const source = `${"cinematic rain over neon glass ".repeat(120)}FINAL_SENTINEL`;
  const bounded = boundFalVideoPrompt(source);
  assert.ok(bounded.length <= FAL_VIDEO_PROMPT_MAX_CHARS);
  assert.ok(!bounded.endsWith("cinem"), "long prompts end on a word boundary");
  assert.equal(boundFalVideoPrompt("short prompt"), "short prompt");
}

function novitaProfileGuard(): void {
  const profile = toNovitaPhaseProfile(generationProfile("production"), "video");
  assert.equal(profile.model, "Lightricks/LTX-2.3");
  assert.equal(profile.revision, LTX_23_MODEL_REVISION);
  assert.equal(profile.pipeline, "two-stage-hq");
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

providerPromptGuard();
novitaProfileGuard();
trailingModelOutputGuard();
comicFontGuard();
console.log("PROVIDER RUNTIME GUARDS PASS: prompt bound, Novita model pin, JSON tail repair, packaged font fallback");
