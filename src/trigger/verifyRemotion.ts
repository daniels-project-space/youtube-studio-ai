/**
 * `verify-remotion` — a cheap, isolated cloud check that the in-app Remotion
 * title card actually renders inside the Trigger image (headless Chromium via
 * ensureBrowser, bundling src/remotion baked in by additionalFiles). It burns
 * NO paid APIs (no Mureka/Fish/YouTube) — just R2 — so it de-risks the one
 * unproven piece of the title-card pipeline before a full render.
 *
 * Trigger it standalone; it returns { ok, sizeKB, width, height, r2Key }.
 */
import { task } from "@trigger.dev/sdk";
import { join } from "node:path";
import { renderTitleCard } from "@/lib/remotionRender";
import { probe } from "@/lib/ffmpeg";
import { makeRunTempDir, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";

export interface VerifyRemotionInput {
  title?: string;
  subtitle?: string;
  durationSec?: number;
}

export const verifyRemotionTask = task({
  id: "verify-remotion",
  // Chromium + ffmpeg need real memory; match the pipeline machine.
  machine: "large-1x",
  maxDuration: 600,
  run: async (payload: VerifyRemotionInput) => {
    await bootstrapSecrets((m, x) => console.log(`[verify-remotion] ${m}`, x ?? ""));

    const title = payload.title ?? "The Quiet Stoic";
    const subtitle = payload.subtitle ?? "On the shortness of life";
    const durationSec = payload.durationSec ?? 5;

    const tmp = await makeRunTempDir("verify-remotion");
    const out = join(tmp, "titlecard.mp4");

    console.log(`[verify-remotion] rendering title card "${title}" (${durationSec}s)…`);
    const t0 = Date.now();
    await renderTitleCard({
      title,
      subtitle,
      palette: ["#0a0a1a", "#2a1a3a", "#10242a"],
      outPath: out,
      durationSec,
      width: 1920,
      height: 1080,
    });
    const renderMs = Date.now() - t0;

    const bytes = await readBytes(out);
    const p = await probe(out);
    const r2Key = `_verify/remotion/titlecard-${durationSec}s.mp4`;
    await putObject(r2Key, bytes, { contentType: "video/mp4" });

    const result = {
      ok: p.hasVideo && bytes.length > 20_000,
      sizeKB: Math.round(bytes.length / 1024),
      width: p.width,
      height: p.height,
      durationSec: p.durationSec,
      renderMs,
      r2Key,
    };
    console.log("[verify-remotion] result", result);
    if (!result.ok) {
      throw new Error(`verify-remotion FAILED: ${JSON.stringify(result)}`);
    }
    return result;
  },
});
