import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const models = [
  "lightricks/ltx-video-0.9.7-distilled",
  "wan-video/wan-2.2-i2v-fast",
  "wan-video/wan-2.2-i2v-a14b",
  "minimax/hailuo-02",
  "bytedance/seedance-1-lite",
  "kwaivgi/kling-v2.1",
];
for (const m of models) {
  try {
    const j = await (await fetch(`https://api.replicate.com/v1/models/${m}`, { headers: { Authorization: `Bearer ${RT}` } })).json();
    const props = j?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};
    const imgKey = Object.keys(props).find((k) => /image|first_frame|start/i.test(k)) || "?";
    const keys = Object.keys(props).filter((k) => /image|first_frame|start|prompt|duration|resolution|num_frames|fps|negative|aspect/i.test(k));
    console.log(`\n${m}  ${j.latest_version ? "v=" + j.latest_version.id.slice(0, 10) : "NO-VERSION"} runs=${j.run_count || "?"}`);
    console.log("  imageKey:", imgKey, "| relevant:", keys.join(", "));
  } catch (e) { console.log(`${m} ERR ${String(e).slice(0, 60)}`); }
}
