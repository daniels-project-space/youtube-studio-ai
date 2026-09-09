import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { canonicalJson } from "@/lib/canonicalJson";
import { generationProfile } from "@/engine/generationProfiles";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";
import type { NovitaRenderCfg } from "@/lib/novitaRenderFarm";
import type { createAttestedNovitaImageGenerator, NovitaPromptImageRequest } from "@/lib/novitaMedia";

const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
type Builder = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string }): void;
};
type Factory = typeof createAttestedNovitaImageGenerator;
const BOUNDARY = "test stopped at external Novita renderImages transport";

async function loadFactory(transport: (cfg: NovitaRenderCfg) => Promise<never>, sideEffect: (name: string) => never): Promise<Factory> {
  const baseline = process.env.NOVITA_REFERENCE_BASELINE_SOURCE
    ? await readFile(process.env.NOVITA_REFERENCE_BASELINE_SOURCE, "utf8") : undefined;
  const compiled = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    stdin: { contents: 'export {createAttestedNovitaImageGenerator} from "./src/lib/novitaMedia";', resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "novita-external-transport-only", setup(builder: Builder) {
      if (baseline !== undefined) builder.onLoad({ filter: /\/novitaMedia\.ts$/, namespace: "file" }, () => ({ contents: baseline, loader: "ts" }));
      builder.onResolve({ filter: /^@\/lib\/(novitaRenderFarm|storage|imageUsage)$/ }, ({ path }) => ({ path, namespace: path }));
      // Real factory, media adapter, cost envelope, profile conversion and receipt
      // assertions stay intact. Only external/dependency boundaries are replaced.
      builder.onLoad({ filter: /.*/, namespace: "@/lib/novitaRenderFarm" }, () => ({
        contents: 'export const renderImages=__transport; export const toNovitaPhaseProfile=__phaseProfile; export const renderVideo=()=>__sideEffect("video");', loader: "js",
      }));
      builder.onLoad({ filter: /.*/, namespace: "@/lib/storage" }, () => ({
        contents: 'export const getObjectBytes=()=>__sideEffect("download"); export const presignDownload=()=>__sideEffect("presign"); export const putObject=()=>__sideEffect("upload");', loader: "js",
      }));
      builder.onLoad({ filter: /.*/, namespace: "@/lib/imageUsage" }, () => ({ contents: 'export const recordImageUsage=()=>__sideEffect("usage-receipt");', loader: "js" }));
    } }],
  });
  const loaded = { exports: {} as { createAttestedNovitaImageGenerator: Factory } };
  new Function("require", "module", "exports", "__transport", "__sideEffect", "__phaseProfile", compiled.outputFiles[0].text)(require, loaded, loaded.exports, transport, sideEffect, toNovitaPhaseProfile);
  return loaded.exports.createAttestedNovitaImageGenerator;
}

async function main(): Promise<void> {
  const events: string[] = [], payloads: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { events.push("network"); throw new Error("network forbidden"); };
  try {
    const factory = await loadFactory(async (cfg) => {
      events.push("provider-boundary");
      const { beforeProviderSpend, ...payload } = cfg;
      payloads.push(canonicalJson(payload));
      await beforeProviderSpend?.();
      events.push("lifecycle-boundary");
      throw new Error(BOUNDARY);
    }, (name) => { events.push(name); throw new Error(`unexpected ${name}`); });
    const generate = factory<NovitaPromptImageRequest & { images?: unknown; aspectRatio?: string; imageSize?: string; allowText?: boolean; tier?: string }>({
      prefix: "/owners/test/channels/test/runs/test/comic/",
      id: () => { events.push("id"); return "panel-one"; },
      maxCostUsd: 100,
      get lifecycle() { events.push("lifecycle-read"); return { ownerId: "owner-test", channelId: "channel-test", runId: "run-test", blockId: "motion_comic" }; },
      beforeProviderSpend: () => { events.push("before-spend"); },
      onProviderReceipt: () => { events.push("provider-receipt"); },
      onReceipt: () => { events.push("receipt"); },
    });
    const textRequest = { prompt: "An original ink character holds a lantern beside a stone bridge.", negativePrompt: "no text, no watermark", seed: 731 };
    for (const extra of [{}, { images: undefined }, { images: [] }, { images: [], aspectRatio: "4:3", imageSize: "2K", allowText: false, tier: "flash" }]) {
      events.length = 0;
      await assert.rejects(() => generate({ ...textRequest, ...extra }), new RegExp(BOUNDARY));
      assert.deepEqual(events, ["id", "lifecycle-read", "provider-boundary", "before-spend", "lifecycle-boundary"]);
    }
    assert.equal(new Set(payloads).size, 1, "absent/empty refs and legacy comic knobs preserve identical transport bytes");
    const transport = JSON.parse(payloads[0]) as { profile: unknown; shots: Array<{ prompt: string; negative: string; seed: number }>; prefix: string };
    assert.deepEqual(transport.profile, toNovitaPhaseProfile(generationProfile("production"), "image"), "all actual model/precision/geometry/infrastructure settings remain intact");
    assert.equal(transport.shots[0].prompt, textRequest.prompt);
    assert.equal(transport.shots[0].negative, textRequest.negativePrompt);
    assert.equal(transport.shots[0].seed, textRequest.seed);
    assert.equal(transport.prefix, "owners/test/channels/test/runs/test/comic/images");
    console.log(`text-only transport SHA256: ${createHash("sha256").update(payloads[0]).digest("hex")}`);
    console.log(`text-only transport: ${payloads[0]}`);

    const unsupported: unknown[] = [[{ data: "c2FtcGxlLXJlZmVyZW5jZQ==", mimeType: "image/png" }], [undefined], [{}], new Array(1), "https://example.test/reference.png", "", { data: "bytes", mimeType: "image/png" }, { length: 0 }, new Uint8Array(0), null, false, 0];
    for (const [index, images] of unsupported.entries()) {
      events.length = 0; const priorPayloads = payloads.length;
      let failure: unknown;
      try { await generate({ ...textRequest, images }); } catch (error) { failure = error; }
      if (events.length) console.log(JSON.stringify({ counterexample: "reference images silently reached provider", case: index, events, transportHasReferenceData: payloads.slice(priorPayloads).some((payload) => payload.includes("c2FtcGxlLXJlZmVyZW5jZQ==")) }));
      assert.match(String(failure), /reference images.*unsupported|unsupported.*reference images/i);
      assert.deepEqual(events, [], "reject before ID, lifecycle, spend, network, storage or receipt side effects");
      assert.equal(payloads.length, priorPayloads);
    }
    console.log(`Novita reference boundary PASS: ${unsupported.length} malformed/nonempty cases rejected before all side effects; four legacy requests byte-equivalent; no providers invoked`);
  } finally { globalThis.fetch = originalFetch; }
}
void main();
