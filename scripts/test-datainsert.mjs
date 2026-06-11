// Local render test of the DataInsert composition (all three kinds) +
// frame grabs for visual inspection. No cloud calls.
import { renderDataInsert } from "../src/lib/remotionRender.ts";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = (n) => join(tmpdir(), n);
const palette = ["#0a0f1e", "#1c2b4a", "#2e4a6b", "#c9a84c", "#e8e8e8"];

console.log("rendering big_stat…");
await renderDataInsert({
  kind: "big_stat", title: "The decade's quiet winner", value: "$534,000",
  label: "What $500/month in an index fund became", palette, accent: "#c9a84c",
  outPath: out("ins_stat.webm"), durationSec: 5,
});
console.log("rendering line_chart…");
await renderDataInsert({
  kind: "line_chart", title: "Compound growth, 2016 – 2026",
  series: [10, 11.5, 13.4, 15.8, 18.9, 23, 28.4, 35.6, 45.2, 58, 75],
  xLabels: ["2016", "2026"], palette, accent: "#c9a84c",
  outPath: out("ins_chart.webm"), durationSec: 7,
});
console.log("rendering bar_compare…");
await renderDataInsert({
  kind: "bar_compare", title: "Fads vs patience",
  bars: [
    { label: "Meme stocks", value: 12, display: "-12%" },
    { label: "Crypto fad", value: 31, display: "-31%" },
    { label: "Index fund", value: 142, display: "+142%" },
  ],
  palette, accent: "#c9a84c",
  outPath: out("ins_bars.webm"), durationSec: 7,
});

for (const [f, t] of [["ins_stat", 3.4], ["ins_chart", 4.6], ["ins_bars", 4.6]]) {
  spawnSync("ffmpeg", ["-y", "-c:v", "libvpx", "-i", out(`${f}.webm`), "-ss", String(t), "-frames:v", "1", out(`${f}.png`)], { stdio: "ignore" });
  console.log("frame:", out(`${f}.png`));
}
console.log("done");
