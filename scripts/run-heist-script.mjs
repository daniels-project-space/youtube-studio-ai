// One-off: run the real scriptGen.synthScript module for the Victor Lustig
// crime-history heist video (1963 Great Train Robbery), 5 chronological stages.
// Loads .env.local manually (standalone script — Next doesn't inject here),
// then dynamic-imports the TS module so env is set before gemini.ts reads it.
import fs from "node:fs";

// --- load .env.local ---
try {
  const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envRaw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch (e) {
  console.error("env load failed:", e.message);
}

const { synthScript } = await import("../src/lib/scriptGen.ts");

const beats = [
  { name: "STAGE 1 — The Plan", note: "Leatherslade Farm hideout, the gang around a table of railway timetables and maps; Victor lays out the con: stop the Glasgow-London Travelling Post Office and take the High Value Packages coach." },
  { name: "STAGE 2 — Rigging the Signal", note: "Deep night at Sears Crossing; a glove over the green signal, a battery wired to a false red light to halt the train without touching the track alarms." },
  { name: "STAGE 3 — Storming the Train", note: "The mail train stops; masked men swarm the diesel engine, uncouple the HVP coach, the driver Jack Mills is struck; Victor rides the footplate." },
  { name: "STAGE 4 — The Human Chain", note: "A line down the embankment passing 120 mailbags — 2.6 million pounds — hand to hand into a waiting Land Rover and army lorry, on a 30-minute clock." },
  { name: "STAGE 5 — Counting the Loot", note: "Back at the farm before dawn; banknotes stacked on the table, the gang playing Monopoly with real money — the slip that later burned them." },
];

const req = {
  topic:
    "The 1963 Great Train Robbery, narrated by Victor — a sharp con-man host embedded with the gang, vlogging the viewer through each chronological stage of the heist.",
  channelName: "Victor Lustig",
  persona:
    "Victor: a charming, dangerous con-man narrator who talks straight to camera like a vlogger dropped inside history — dry wit, insider swagger, never glorifying, always revealing the craft.",
  niche: "crime history / heist reenactment",
  style: "crime",
  language: "en",
  maxSeconds: 60,
  endWithSummary: false,
  ttsSpeed: 0.94,
  voiceTags: false,
  structure: {
    hook:
      "3 a.m. on a railway bridge, fifteen men, and a plan to rob a moving Post Office of 2.6 million pounds — I'm Victor, and you're coming with us.",
    beats,
  },
};

const s = await synthScript(req, (m) => console.error("  [script] " + m));

const outDir = "/var/www/html/lustig-scenes";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outDir + "/script.json", JSON.stringify(s, null, 2));

const md =
  `# Victor — The Great Train Robbery (1963)\n\n**Hook:** ${s.hook}\n\n**Est. duration:** ${s.estDurationSec}s\n\n` +
  s.sections.map((x, i) => `## ${i + 1}. ${x.heading}\n\n${x.narration}\n`).join("\n") +
  (s.closingLine ? `\n**Closing:** ${s.closingLine}\n` : "");
fs.writeFileSync(outDir + "/script.md", md);

// compact machine summary for the caller
console.log("###SCRIPT_JSON_START###");
console.log(
  JSON.stringify(
    {
      hook: s.hook,
      est: s.estDurationSec,
      closing: s.closingLine ?? null,
      sections: s.sections.map((x) => ({ heading: x.heading, narration: x.narration })),
    },
    null,
    2,
  ),
);
console.log("###SCRIPT_JSON_END###");
