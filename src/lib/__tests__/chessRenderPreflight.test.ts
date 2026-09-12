import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { renderSceneManifest } from "@/lib/sceneCompilerRender";
import { chessDiagnosticManifest } from "../../../test-fixtures/chess-replay/fixture";

async function main() {
  const good = chessDiagnosticManifest();
  for (const mutate of [
    (m: typeof good) => { m.scenes[0].t0 = -1; },
    (m: typeof good) => { m.scenes[0].t1 = Number.NaN; },
    (m: typeof good) => { m.scenes[1].t0 = 3; },
    (m: typeof good) => { m.scenes[1].t0 = 1; },
    (m: typeof good) => { m.durationSec = 11; },
    (m: typeof good) => { delete m.chessReplay; },
  ]) {
    const manifest = structuredClone(good);
    mutate(manifest);
    const outPath = `/tmp/chess-rejected-${process.pid}.mp4`;
    await assert.rejects(renderSceneManifest({ manifest, outPath }));
    assert.equal(existsSync(outPath), false, "invalid inputs must never reach the native encode");
  }
  console.log("Chess renderer preflight rejects six invalid handoffs before browser/encode");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
