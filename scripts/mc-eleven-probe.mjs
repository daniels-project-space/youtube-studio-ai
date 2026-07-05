// Motion-comic probe 1: figure out ElevenLabs MULTI-VOICE.
// Checks credits, lists voices, and tries the Text-to-Dialogue endpoint (one call,
// multiple voices) + confirms the per-line fallback shape.
import { writeFileSync } from "node:fs";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["ELEVENLABS_API_KEY"] });
const key = process.env.ELEVENLABS_API_KEY;
const H = { "xi-api-key": key };

// 1. credits
const sub = await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: H })).json();
console.log(`CREDITS: ${sub.character_count}/${sub.character_limit} used | tier: ${sub.tier} | resets: ${sub.next_character_count_reset_unix ? new Date(sub.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : "?"}`);

// 2. voices (pick distinct character voices)
const vs = await (await fetch("https://api.elevenlabs.io/v1/voices", { headers: H })).json();
const voices = (vs.voices || []).map((v) => ({ id: v.voice_id, name: v.name, g: v.labels?.gender, age: v.labels?.age, desc: v.labels?.description }));
console.log("VOICES:");
for (const v of voices.slice(0, 12)) console.log(`  ${v.name} [${v.g}/${v.age}/${v.desc}] ${v.id}`);
const male = voices.find((v) => v.g === "male") || voices[0];
const female = voices.find((v) => v.g === "female") || voices[1];

// 3. Text-to-Dialogue (eleven_v3): ONE call, MULTIPLE voices. Tiny script to fit credits.
const inputs = [
  { text: "Who's there?", voice_id: male.id },
  { text: "Trouble.", voice_id: female.id },
];
console.log(`DIALOGUE test: ${male.name} + ${female.name} (~${inputs.reduce((n, i) => n + i.text.length, 0)} chars)`);
const res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue", {
  method: "POST", headers: { ...H, "content-type": "application/json" },
  body: JSON.stringify({ model_id: "eleven_v3", inputs }),
});
console.log(`  -> ${res.status} ${res.headers.get("content-type")}`);
if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); writeFileSync("/tmp/mc_dialogue.mp3", b); console.log(`  DIALOGUE OK ${b.length} bytes -> /tmp/mc_dialogue.mp3`); }
else console.log(`  DIALOGUE FAIL: ${(await res.text()).slice(0, 220)}`);
