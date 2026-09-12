/** Actual native renderer, visual-only proof. Does not call TTS, R2 or publish. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { renderSceneManifest } from "@/lib/sceneCompilerRender";
import { castleSource, chessDiagnosticManifest, openingSource, enPassantSource, promotionSource } from "../test-fixtures/chess-replay/fixture";

async function main() {
const outputDir = resolve(process.argv[2] ?? "/tmp/chess-replay-proof-20260912");
await mkdir(outputDir, { recursive: true });
const sourceHashes = Object.fromEntries(await Promise.all([
  "src/engine/chessReplay.ts", "src/engine/chessNarration.ts", "src/engine/chessScene.ts", "src/engine/episodeGraph.ts",
  "src/remotion/sceneCompiler/ChessBoardVisual.tsx", "src/remotion/sceneCompiler/SceneCompiler.tsx",
  "src/lib/sceneCompilerRender.ts", "test-fixtures/chess-replay/fixture.ts", "package.json",
].map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
for (const [name, source, orientation, theme] of [
  ["opening-white", openingSource, "white", "walnut"],
  ["castling-black", castleSource, "black", "midnight"],
  ["en-passant", enPassantSource, "white", "midnight"],
  ["promotion", promotionSource, "black", "walnut"],
] as const) {
  if (process.argv[3] && !name.startsWith(process.argv[3])) continue;
  const manifest = chessDiagnosticManifest(source, orientation, theme);
  const started = performance.now();
  const videoPath = join(outputDir, `${name}.mp4`);
  await renderSceneManifest({ manifest, outPath: videoPath, concurrency: 2, log: console.log });
  await writeFile(join(outputDir, `${name}.json`), JSON.stringify({
    scope: "visual-only diagnostic, synthetic timing; not narrated channel qualification",
    elapsedSec: (performance.now() - started) / 1_000, videoPath, manifest, sourceHashes,
    videoSha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"),
  }, null, 2));
  console.log(videoPath);
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
