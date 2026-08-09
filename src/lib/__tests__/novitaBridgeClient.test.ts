import assert from "node:assert/strict";
import { generationProfile } from "@/engine/generationProfiles";
import {
  getNovitaRenderStatus,
  hasNovitaRenderFarmConfig,
  launchImages,
  toNovitaPhaseProfile,
  type NovitaRenderCfg,
} from "@/lib/novitaRenderFarm";

/**
 * The former HTTPS/VPS bridge must remain impossible to revive accidentally.
 * Direct rendering is covered by the immutable manifest + worker contract; no
 * test path is permitted to send a browser/Trigger request to a bridge URL.
 */
async function main() {
  process.env.NOVITA_RENDER_FARM_API = "https://retired.example/render";
  process.env.NOVITA_RENDER_FARM_TOKEN = "retired-token-that-is-longer-than-thirty-two-characters";

  const profile = toNovitaPhaseProfile(generationProfile("production"), "image");
  const renderCfg: NovitaRenderCfg = {
    prefix: "console/test-run",
    profile,
    shots: [{
      id: "shot-01",
      prompt: "A blacksmith working beside a glowing forge",
      cameraMove: "static",
      shotScale: "medium",
      lens: "35mm",
      seconds: 5,
      motion: "sparks rise from the anvil",
    }],
    nshard: 1,
    maxConcurrent: 1,
    jobs: "full",
  };

  assert.equal(hasNovitaRenderFarmConfig(), false, "old bridge variables never configure the direct control plane");
  await assert.rejects(
    () => launchImages(renderCfg),
    /legacy Novita bridge is disabled/,
  );
  await assert.rejects(
    () => getNovitaRenderStatus("image-0123456789abcdef0123456789abcdef"),
    /legacy Novita bridge is disabled/,
  );
  console.log("legacy Novita bridge retirement tests passed");
}

void main();
