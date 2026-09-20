import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = new URL("../public/fonts/documotion/", import.meta.url);
const manifestPath = new URL("manifest.json", directory);
const licenseRevision = "e44c4b011a820c2cbe2fd2cfa8052037d7edb571";
const sources = [
  "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3K8-C8QSw.woff2",
  "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3K9-C8QSw.woff2",
  "https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-C8.woff2",
  "https://fonts.gstatic.com/s/oswald/v57/TK3iWkUHHAIjg752GT8G.woff2",
  "https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2",
  "https://fonts.gstatic.com/s/specialelite/v20/XLYgIZbkc4JPUL5CVArUVL0ntnAOSA.woff2",
].map((source) => ({ source, file: source.split("/").at(-1) }));
for (const family of ["anton", "oswald", "caveat"]) {
  sources.push({
    source: `https://raw.githubusercontent.com/google/fonts/${licenseRevision}/ofl/${family}/OFL.txt`,
    file: `${family}-OFL.txt`,
  });
}
sources.push({
  source: `https://raw.githubusercontent.com/google/fonts/${licenseRevision}/apache/specialelite/LICENSE.txt`,
  file: "specialelite-LICENSE.txt",
});
let previous;
try {
  previous = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const assets = [];
// Acquire and verify everything before replacing any retained asset.
for (const { source, file } of sources) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Font acquisition failed: ${response.status} ${source}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (file.endsWith(".woff2") && bytes.subarray(0, 4).toString() !== "wOF2") {
    throw new Error(`Invalid WOFF2: ${source}`);
  }
  if (file.endsWith(".txt") && !/SIL OPEN FONT LICENSE|Apache License/.test(bytes.toString())) {
    throw new Error(`Missing font license: ${source}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const retained = previous?.assets.find((asset) => asset.source === source);
  if (previous && (!retained || retained.sha256 !== sha256)) {
    throw new Error(`Pinned font provenance changed: ${source}`);
  }
  assets.push({ source, file, sha256, byteLength: bytes.length, bytes });
}
await mkdir(directory, { recursive: true });
for (const asset of assets) await writeFile(new URL(asset.file, directory), asset.bytes);
await writeFile(manifestPath, `${JSON.stringify({
  licenseRevision,
  assets: assets.map(({ source, file, sha256, byteLength }) => ({ source, file, sha256, byteLength })),
}, null, 2)}\n`);
console.log(`Vendored ${assets.length} pinned font/license assets in ${fileURLToPath(directory)}`);
