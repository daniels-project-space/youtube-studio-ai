import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const j = await (await fetch("https://api.replicate.com/v1/models/bytedance/seedance-1-lite", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("VERSION:", j?.latest_version?.id);
const schemas = j?.latest_version?.openapi_schema?.components?.schemas || {};
const props = schemas?.Input?.properties || {};
for (const [k, v] of Object.entries(props)) {
  let en = v.enum;
  if (!en && v.allOf?.[0]?.$ref) en = schemas[v.allOf[0].$ref.split("/").pop()]?.enum;
  if (!en && v.$ref) en = schemas[v.$ref.split("/").pop()]?.enum;
  console.log(`${k}: type=${v.type || "ref"} default=${JSON.stringify(v.default)} ${en ? "enum=" + JSON.stringify(en) : ""}`);
}
