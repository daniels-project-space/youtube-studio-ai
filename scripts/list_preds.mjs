import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const j = await (await fetch("https://api.replicate.com/v1/predictions", { headers: { Authorization: `Bearer ${RT}` } })).json();
const rows = (j.results || []).slice(0, 16);
for (const p of rows) {
  const age = p.created_at ? Math.round((Date.now() - new Date(p.created_at).getTime()) / 1000) : "?";
  console.log(`${p.status.padEnd(11)} ${String(age).padStart(5)}s  ${(p.model || p.version || "").slice(0, 40)}  ${p.error ? "ERR:" + String(p.error).slice(0, 60) : ""}`);
}
// account info / concurrency hints
const acct = await (await fetch("https://api.replicate.com/v1/account", { headers: { Authorization: `Bearer ${RT}` } })).json();
console.log("ACCOUNT:", acct.username || acct.type || JSON.stringify(acct).slice(0, 80));
