// Assemble the lofi video the v1 golden way: composeMusicLoopDeblur (8s deblur
// "blur intro" sigma 20->0 + lower-third title card + stream-looped music).
// Loop unit = the seamless FLF2V loop; music = real lofi extracted from v1 render.
import { composeMusicLoopDeblur } from "../src/lib/ffmpeg.ts";

const LOOP = "/var/www/html/lofi/bc3_loop.mp4";
const MUSIC = "/var/www/html/lofi/oceancafe_music.mp3";
const DUR = Number(process.argv[2] || 180);
const OUT = `/var/www/html/lofi/bc3_final_${DUR}.mp4`;

await composeMusicLoopDeblur({
  loopUnitPath: LOOP,
  musicPath: MUSIC,
  outPath: OUT,
  durationSec: DUR,
  title: "Beachside Cafe",
  channel: "lofi to relax & study",
  width: 1920,
  height: 1080,
  preset: "veryfast",
});
console.log("[lofi] DONE ->", OUT, `(${DUR}s)`);
