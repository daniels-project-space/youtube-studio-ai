import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
let url = "https://api.replicate.com/v1/predictions";
const agg = {};
for (let page = 0; page < 4 && url; page++) {
  const j = await (await fetch(url, { headers: { Authorization: `Bearer ${RT}` } })).json();
  for (const p of j.results || []) {
    const m = (p.model || "?").split("/").pop();
    const t = p.metrics?.predict_time || 0;
    agg[m] = agg[m] || { n: 0, t: 0, succ: 0 };
    agg[m].n++; agg[m].t += t; if (p.status === "succeeded") agg[m].succ++;
  }
  url = j.next;
}
console.log("model".padEnd(34), "preds", "succ", "totSec", "avgSec");
for (const [m, a] of Object.entries(agg).sort((x, y) => y[1].t - x[1].t)) {
  console.log(m.padEnd(34), String(a.n).padStart(5), String(a.succ).padStart(4), String(Math.round(a.t)).padStart(6), (a.t / a.n).toFixed(1).padStart(7));
}
// estimate per-video (9 clips each): need hardware. fetch model hardware
for (const m of ["ltx-video-0.9.7-distilled", "real-esrgan-video"]) {
  try {
    const owner = m.includes("ltx") ? "lightricks" : "lucataco";
    const md = await (await fetch(`https://api.replicate.com/v1/models/${owner}/${m}`, { headers: { Authorization: `Bearer ${RT}` } })).json();
    console.log(`\n${m}: default_example hw? ${md?.latest_version?.id?.slice(0,8)} run_count=${md.run_count}`);
  } catch {}
}
