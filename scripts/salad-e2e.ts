/**
 * salad-e2e.ts — end-to-end proof of the YSA → Salad LTX-2.3 render path.
 * Exercises the SAME code the `ltx-render` Trigger task runs: bootstrapSecrets
 * (vault) → renderGpuVideo({provider:"salad-ltx"}) (base64 image, template inject,
 * async submit, R2 poll). Run:
 *   SALAD_LTX_GATEWAY=<gw> E2E_IMAGE_URL=<presigned 8-bit still> npx tsx scripts/salad-e2e.ts
 */
import { readFileSync } from "node:fs";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { renderGpuVideo } from "@/lib/gpuVideo";

async function main(): Promise<void> {
  // Pin the working LTX-2.3 workflow (env wins over the vault value inside bootstrap).
  process.env.SALAD_LTX_WORKFLOW_JSON = readFileSync("src/lib/ltx23_i2v_workflow.json", "utf8");
  await bootstrapSecrets((m) => console.log("[boot]", m), { required: ["SALAD_API_KEY", "SALAD_R2_BUCKET"] });
  console.log("[e2e] gateway:", process.env.SALAD_LTX_GATEWAY);
  console.log("[e2e] r2 bucket:", process.env.SALAD_R2_BUCKET, "prefix:", process.env.SALAD_R2_PREFIX);

  const imageUrl = process.env.E2E_IMAGE_URL;
  if (!imageUrl) throw new Error("E2E_IMAGE_URL required");

  const t0 = Date.now();
  const r = await renderGpuVideo({
    provider: "salad-ltx",
    imageUrl,
    prompt:
      "Slow cinematic dolly push-in through a misty ancient forest at dawn, shafts of golden light between towering trees, gentle drifting fog, leaves stirring in the breeze. Shallow depth of field, filmic grain.",
    negativePrompt: "low quality, warped, distorted, morphing, text, watermark, flicker",
    log: (m) => console.log("[render]", m),
    timeoutMs: 600_000,
    pollIntervalMs: 8000,
  });
  console.log(`[e2e] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("E2E_RESULT " + JSON.stringify(r));
}

main().catch((e) => {
  console.error("E2E_FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
