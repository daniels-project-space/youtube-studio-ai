import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {});
const keys = Object.keys(process.env).filter((k) => /LTX|LIGHTRICK|FAL|REPLICATE|HIGGS|RUNWAY|LUMA/i.test(k));
console.log("VIDEO KEYS:", keys.map((k) => `${k}=${String(process.env[k]).slice(0, 6)}…`).join("  "));

// ── fal re-check (is the balance still exhausted?) ──
const FK = process.env.FAL_KEY;
if (FK) {
  try {
    const r = await fetch("https://queue.fal.run/fal-ai/ltx-video/image-to-video", { method: "POST", headers: { Authorization: `Key ${FK}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "test", image_url: "http://87.106.233.113/loreshort/ltx0.png" }) });
    const t = await r.text();
    console.log("FAL ltx submit:", r.status, t.slice(0, 160));
  } catch (e) { console.log("FAL err", String(e).slice(0, 120)); }
}

// ── Replicate LTX-distilled: get version + input schema (for the versioned call) ──
const RT = process.env.REPLICATE_API_TOKEN;
const m = await (await fetch("https://api.replicate.com/v1/models/lightricks/ltx-video-0.9.7-distilled", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("LTX-distilled version:", m?.latest_version?.id);
const props = m?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
if (props) console.log("LTX-distilled inputs:", Object.keys(props).join(", "));
const m2 = await (await fetch("https://api.replicate.com/v1/models/lightricks/ltx-video", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("LTX-video version:", m2?.latest_version?.id);
const p2 = m2?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
if (p2) console.log("LTX-video inputs:", Object.keys(p2).join(", "));
