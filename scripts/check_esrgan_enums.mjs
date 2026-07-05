import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const j = await (await fetch("https://api.replicate.com/v1/models/lucataco/real-esrgan-video", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("FULL VERSION:", j?.latest_version?.id);
const props = j?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};
for (const [k, v] of Object.entries(props)) {
  const en = v.enum || v.allOf?.[0]?.enum;
  console.log(`${k}: type=${v.type || "?"} default=${JSON.stringify(v.default)} ${en ? "enum=" + JSON.stringify(en) : ""}`);
}
// resolve $ref enums
const schemas = j?.latest_version?.openapi_schema?.components?.schemas || {};
for (const [k, v] of Object.entries(schemas)) if (v.enum) console.log(`ENUM ${k}:`, JSON.stringify(v.enum));
