// E2E smoke: run the DP's planCoverage on the real Victor script and prove it
// produces coverage-rich shots (varied camera moves + inserts + non-host subjects).
import fs from "node:fs";
try {
  for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch {}
const { planCoverage } = await import("../src/lib/crew/cinematographer.ts");
const script = JSON.parse(fs.readFileSync("/var/www/html/lustig/script.json", "utf8"));
const cfg = { coverageDensity: 3, shotSizeMix: "balanced", insertFrequency: "rich", cameraEnergy: "dynamic", lensLanguage: "anamorphic", lightingKey: "noir", speedRamps: true };
const shots = await planCoverage({
  script: { hook: script.hook, sections: script.sections },
  cfg,
  subjects: [
    { name: "Victor", kind: "character", look: "1930s con-man host, suit + fedora" },
    { name: "Police", kind: "character", look: "1963 British police, uniforms + squad cars" },
    { name: "Passengers", kind: "character", look: "frightened mail-train staff and passengers" },
  ],
  styleLock: "1963 Britain, cinematic film-noir reconstruction, anamorphic 35mm, moody low-key",
  niche: "crime history", period: "1963", targetShots: 12, clipSec: 6,
  log: (m) => console.error("[dp] " + m),
});
const moves = new Set(shots.map((s) => (s.cameraMove || "").toLowerCase().trim()));
const inserts = shots.filter((s) => !(s.subjects || []).length).length;
const nonHost = shots.filter((s) => (s.subjects || []).length && !(s.subjects || []).some((n) => /victor/i.test(n))).length;
console.log("###SMOKE###");
console.log(`shots: ${shots.length} | distinct camera moves: ${moves.size} | inserts/atmosphere: ${inserts} | non-host-subject shots: ${nonHost}`);
console.log(shots.slice(0, 12).map((s) => `  #${s.id} [${(s.subjects || []).join(",") || "—"}] ${s.cameraMove} · ${s.lens || ""} | ${(s.keyframePrompt || "").slice(0, 64)}`).join("\n"));
// "not host-only" coverage = inserts (empty subjects) + shots with a named non-host subject
const notHostCoverage = inserts + nonHost;
const ok = shots.length >= 8 && notHostCoverage >= Math.ceil(shots.length / 2) && moves.size >= 3;
console.log(`not-host-only coverage: ${notHostCoverage}/${shots.length} shots (${inserts} inserts + ${nonHost} named non-host)`);
console.log(ok ? "SMOKE PASS: coverage-rich (varied moves + inserts + non-host cuts)" : "SMOKE WEAK");
process.exit(ok ? 0 : 1);
