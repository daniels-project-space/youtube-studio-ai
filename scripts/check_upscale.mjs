import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const models = [
  "lucataco/real-esrgan-video",
  "topazlabs/video-upscale",
  "nightmareai/real-esrgan",
  "philz1337x/clarity-upscaler",
];
for (const m of models) {
  try {
    const r = await fetch(`https://api.replicate.com/v1/models/${m}`, { headers: { Authorization: `Bearer ${RT}` } });
    const j = await r.json();
    const props = j?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
    console.log(`\n${m} -> ${r.status} ver=${j?.latest_version?.id?.slice(0, 12) || "?"}`);
    if (props) console.log("  inputs:", Object.keys(props).join(", "));
    if (j?.run_count) console.log("  runs:", j.run_count);
  } catch (e) { console.log(`${m} ERR ${String(e).slice(0, 80)}`); }
}
