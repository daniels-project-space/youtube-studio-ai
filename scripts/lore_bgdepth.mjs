// Depth-map each CLEAN background plate (figure-removed) so it can be sliced into
// multiple parallax bands. Publishes each plate to nginx (fal needs a public URL).
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
for (let i = 0; i < N; i++) {
  if (existsSync(rd(`bgdepth_${i}.png`))) { console.error(`bgdepth_${i} cached`); continue; }
  await copyFile(rd(`bg_${i}.png`), join(WEB, `bg_${i}.png`));
  const url = `http://87.106.233.113/lorecraft/bg_${i}.png`;
  const r = await getDepthMap(url, rd(`bgdepth_${i}.png`), (m) => console.error("[depth]", m));
  console.error(`bgdepth_${i} via ${r.provider}`);
}
console.log("DONE bg depth (" + N + ")");
