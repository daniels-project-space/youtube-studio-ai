/**
 * FOOTAGE A/B — before (Pexels size=medium, 1080p cap, single-frame gate) vs
 * after (federated 4K-first + multi-frame relevance/watermark gate), for one
 * example channel. Proves the two no-new-key wins and exercises the gate.
 *
 * Run:  set -a; . .env.local; set +a; npx tsx scripts/footage-ab.ts
 * Output: /var/www/html/footage-ab/ (index.html + clips) + report.md
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { searchFootage, scoreClip, activeProviders, type FootageClip } from "@/lib/footage";
import { downloadTo } from "@/lib/files";
import { grabFrame } from "@/lib/ffmpeg";
import { geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";

const OUT = "/var/www/html/footage-ab";
const CHANNEL = "Antiquity Files (ancient history)";
const QUERIES = [
  "ancient roman ruins aerial",
  "egyptian pyramids desert",
  "greek temple columns",
  "ancient marble statue",
  "mediterranean sea cliffs",
  "torchlit stone corridor",
];

/** OLD path: Pexels only, size=medium, reject anything wider than 1920. */
async function oldPexelsPick(query: string): Promise<FootageClip | null> {
  const key = process.env.PEXELS_API_KEY!;
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape&size=medium`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) return null;
  const j = (await res.json()) as { videos?: { duration?: number; width?: number; height?: number; video_files?: { link: string; width?: number; height?: number; file_type?: string }[] }[] };
  let best: FootageClip | null = null;
  for (const v of j.videos ?? []) {
    const mp4s = (v.video_files ?? []).filter((f) => (f.file_type ?? "").includes("mp4"));
    const within = mp4s.filter((f) => (f.width ?? 0) <= 1920);
    const f = (within.length ? within : mp4s).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    if (!f) continue;
    const c: FootageClip = { url: f.link, width: f.width ?? 0, height: f.height ?? 0, durationSec: v.duration ?? 0, query, provider: "pexels(old)" };
    if (!best || scoreClip(c) > scoreClip(best)) best = c;
  }
  return best;
}

/** Run the gate over N frames, return {relevant, score}. */
async function gate(localPath: string, fracs: number[], dur: number, query: string): Promise<{ relevant: boolean; score: number }> {
  const frames: string[] = [];
  for (const [i, frac] of fracs.entries()) {
    const f = `${localPath}.${i}.jpg`;
    try { await grabFrame(localPath, Math.max(0.5, dur * frac), f); frames.push(f); } catch { /* skip */ }
  }
  if (frames.length === 0) return { relevant: true, score: 5 };
  try {
    const raw = await geminiVisionLocal({
      prompt:
        `These ${frames.length} frames are sampled across ONE ancient-history b-roll clip (query "${query}"). ` +
        `REJECT if ANY frame shows a watermark, stock-site logo, burned-in caption, modern object/person/vehicle, ` +
        `or drifts off an ancient-world theme. Return STRICT JSON {"relevant":boolean,"score":0-10}.`,
      imagePaths: frames,
      json: true,
      maxTokens: 200,
    });
    const v = parseJsonLoose<{ relevant?: boolean; score?: number }>(raw);
    return { relevant: v.relevant !== false, score: typeof v.score === "number" ? v.score : 5 };
  } catch {
    return { relevant: true, score: 5 };
  }
}

const mb = (clip: FootageClip | null) => (clip ? `${clip.width}x${clip.height}` : "—");

async function main() {
  await bootstrapSecrets((m) => console.log(`[bootstrap] ${m}`));
  mkdirSync(OUT, { recursive: true });
  console.log(`active footage providers: ${activeProviders().join(", ")}`);

  const rows: { q: string; old: FootageClip | null; neu: FootageClip | null; oldFile: string; newFile: string; gateNote: string }[] = [];
  const lines: string[] = [`# Footage A/B — ${CHANNEL}`, ``, `Providers active: ${activeProviders().join(", ")}. Run ${new Date().toISOString()}`, ``];

  for (const [i, q] of QUERIES.entries()) {
    console.log(`\n=== ${q} ===`);
    const old = await oldPexelsPick(q).catch(() => null);
    const cands = await searchFootage(q, 6, "landscape").catch(() => [] as FootageClip[]);
    const neu = cands[0] ?? null;
    console.log(`  OLD ${mb(old)}  ->  NEW ${mb(neu)} (${neu?.provider ?? "—"})`);

    let oldFile = "", newFile = "", gateNote = "";
    if (old) { oldFile = `old_${i}.mp4`; await downloadTo(old.url, join(OUT, oldFile)).catch(() => (oldFile = "")); }
    if (neu) {
      newFile = `new_${i}.mp4`;
      await downloadTo(neu.url, join(OUT, newFile)).catch(() => (newFile = ""));
      // Gate divergence: single-frame (old behavior) vs three-frame (new).
      if (newFile && hasGeminiKey()) {
        const lp = join(OUT, newFile);
        const single = await gate(lp, [0.04], neu.durationSec || 8, q);
        const multi = await gate(lp, [0.12, 0.5, 0.82], neu.durationSec || 8, q);
        const diverge = single.relevant !== multi.relevant || Math.abs(single.score - multi.score) >= 2;
        gateNote = `single-frame ${single.relevant ? "accept" : "reject"} ${single.score}/10 · multi-frame ${multi.relevant ? "accept" : "reject"} ${multi.score}/10${diverge ? " ⟵ DIVERGED" : ""}`;
        console.log(`  gate: ${gateNote}`);
      }
    }
    rows.push({ q, old, neu, oldFile, newFile, gateNote });
    lines.push(`## ${q}`, `- OLD: ${mb(old)} (${old ? (old.height >= 2160 ? "4K" : old.height >= 1080 ? "1080p" : `${old.height}p`) : "none"})`, `- NEW: ${mb(neu)} via ${neu?.provider ?? "—"} (${neu ? (neu.height >= 2160 ? "**4K**" : neu.height >= 1080 ? "1080p" : `${neu.height}p`) : "none"})`, `- gate: ${gateNote || "n/a"}`, ``);
  }

  // HTML page with side-by-side players.
  const cards = rows.map((r) => `
  <h2>${r.q}</h2>
  <div class="pair">
    <div class="cell before"><b>BEFORE — ${mb(r.old)} (size=medium, 1080p cap)</b>${r.oldFile ? `<video controls preload="none" src="${r.oldFile}"></video>` : "<i>no clip</i>"}</div>
    <div class="cell after"><b>AFTER — ${mb(r.neu)} via ${r.neu?.provider ?? "—"}${r.neu && r.neu.height >= 2160 ? " · 4K" : ""}</b>${r.newFile ? `<video controls preload="none" src="${r.newFile}"></video>` : "<i>no clip</i>"}</div>
  </div>
  <p class="meta">${r.gateNote || ""}</p>`).join("\n");
  writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Footage A/B — ${CHANNEL}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0e0e10;color:#eee;max-width:1000px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.3rem}h2{font-size:1rem;color:#ffd166;margin:1.5rem 0 .4rem}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.cell{background:#19191d;border-radius:10px;padding:.7rem}.cell b{display:block;font-size:.8rem;margin-bottom:.5rem}.before b{color:#888}.after b{color:#6ee7a8}
video{width:100%;border-radius:6px}p.meta{font-size:.78rem;color:#9a9aa5;margin:.3rem 0 0}</style>
<h1>Footage A/B — ${CHANNEL}</h1><p style="color:#9a9aa5;font-size:.85rem">Providers: ${activeProviders().join(", ")}. Before = current Pexels path (medium, 1080p cap). After = federated, highest-res file (4K when offered).</p>
${cards}`);
  writeFileSync(join(OUT, "report.md"), lines.join("\n"));
  console.log(`\npage → http://87.106.233.113/footage-ab/`);
}

main().catch((e) => { console.error("footage A/B failed:", e); process.exit(1); });
