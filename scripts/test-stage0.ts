import { hydrateEnv } from "@/lib/vault";

async function token(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("token: " + JSON.stringify(j));
  return j.access_token;
}

async function main() {
  await hydrateEnv("youtube");
  const at = await token();
  // scopes
  const ti = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${at}`)).json();
  console.log("OAuth scopes:", ti.scope ?? "(unknown)");
  // Data API: search (read)
  const s = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&q=stoicism&maxResults=1&type=video", { headers: { Authorization: `Bearer ${at}` } });
  const sj = await s.json();
  console.log("Data API search.list:", s.status, s.ok ? "OK (read works)" : (sj.error?.errors?.[0]?.reason ?? sj.error?.message ?? "").slice(0,120));
  // Analytics API
  const today = "2026-06-01";
  const a = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=2026-01-01&endDate=${today}&metrics=views`, { headers: { Authorization: `Bearer ${at}` } });
  const aj = await a.json();
  console.log("Analytics API:", a.status, a.ok ? "OK" : (aj.error?.errors?.[0]?.reason ?? aj.error?.message ?? "").slice(0,140));
}
main().catch(e => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
