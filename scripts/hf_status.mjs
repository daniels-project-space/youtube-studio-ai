import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(()=>{});
console.log("HF_LIVE", process.env.HIGGSFIELD_LIVE, "KEY", String(process.env.HIGGSFIELD_API_KEY||"").slice(0,6));
try { const m = await import("@/lib/higgsfield"); if (m.accountStatus) { const s = await m.accountStatus(()=>{}); console.log("STATUS", JSON.stringify(s).slice(0,300)); } } catch(e){ console.log("ERR", String(e).slice(0,200)); }
