/** Download the curated starter pack without losing its auditable provenance. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  DOCUMENTARY_ASSET_PROVIDERS,
  DOCUMENTARY_STANDARD_ASSET_ROOT,
  DOCUMENTARY_STANDARD_ASSETS,
  type DocumentaryStandardAsset,
} from "../src/lib/documentaryStandardAssetLibrary";

const projectRoot = resolve(import.meta.dirname, "..");
const destinationRoot = resolve(projectRoot, DOCUMENTARY_STANDARD_ASSET_ROOT);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchAsset(asset: DocumentaryStandardAsset): Promise<Record<string, unknown>> {
  const destination = join(destinationRoot, asset.localFile);
  await mkdir(dirname(destination), { recursive: true });
  let bytes: Uint8Array;
  let status: "downloaded" | "existing";
  try {
    bytes = await readFile(destination);
    status = "existing";
  } catch {
    const response = await fetch(asset.remoteUrl, { headers: { "user-agent": "youtube-studio-ai-documentary-library/1.0" } });
    if (!response.ok) throw new Error(`${asset.id}: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`${asset.id}: expected image response, received ${contentType || "unknown"}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1_024) throw new Error(`${asset.id}: download is unexpectedly small`);
    await writeFile(destination, bytes, { flag: "wx" });
    status = "downloaded";
  }
  return {
    ...asset,
    localFile: relative(projectRoot, destination),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    status,
  };
}

async function run(): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  const assets = [];
  for (const asset of DOCUMENTARY_STANDARD_ASSETS) assets.push(await fetchAsset(asset));
  const manifest = {
    version: "documentary-standard-assets/v1",
    generatedAt: new Date().toISOString(),
    providers: DOCUMENTARY_ASSET_PROVIDERS,
    assets,
    publishingRule: "Use only with the recorded credit, terms and source context. Never imply source-provider endorsement.",
  };
  await writeFile(join(destinationRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
  console.log(`documentary standard assets: ${assets.map((asset) => `${asset.id}=${asset.status}`).join(", ")}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
