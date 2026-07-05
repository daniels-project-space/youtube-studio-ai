// Generate a depth map per painting (fal marigold → replicate fallback). The
// depth API needs a public URL, so publish each painting to nginx first.
import { writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { getDepthMap } from "@/lib/depth";

const RUN = join(process.cwd(), "output", "lorecraft", "moria");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
await mkdir(WEB, { recursive: true });
await bootstrapSecrets(() => {});
const N = 4;
const scenes = [];
for (let i = 0; i < N; i++) {
  await copyFile(rd(`scene_${i}.png`), join(WEB, `scene_${i}.png`));
  const url = `http://87.106.233.113/lorecraft/scene_${i}.png`;
  if (!existsSync(rd(`depth_${i}.png`))) {
    const r = await getDepthMap(url, rd(`depth_${i}.png`), (m) => console.error("[depth]", m));
    console.error(`scene ${i} depth via ${r.provider}`);
  } else console.error(`scene ${i} depth cached`);
  scenes.push({ img: `scene_${i}.png`, depth: `depth_${i}.png` });
}
await writeFile(rd("lore3d_scenes.json"), JSON.stringify(scenes, null, 2));
console.log("DONE depth (" + N + ")");
