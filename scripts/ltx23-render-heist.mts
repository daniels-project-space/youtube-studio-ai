/**
 * Heist render driver (tsx). Uses the pre-built API-format LTX-2.3 workflow
 * template (from the local /object_info, since the comfyui-api gateway doesn't
 * proxy /object_info) and POSTs it to a comfyui-api /prompt endpoint (Salad or
 * RunPod) with the heist still + audio-first prompt substituted, output → R2.
 *
 * Env: LTX_GATEWAY (comfyui-api base URL), LTX_AUTH_HEADER (e.g. "Salad-Api-Key"),
 *      LTX_AUTH_VALUE, SALAD_R2_BUCKET/PREFIX. Falls back to vault salad config.
 */
import fs from "node:fs";
const V = "https://fantastic-roadrunner-485.convex.cloud/api";
const vget = async (s: string, k: string) => {
  const r = await fetch(`${V}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "secrets:getOne", args: { service: s, keyName: k }, format: "json" }) });
  const j = await r.json(); const v = j.value; return v && typeof v === "object" ? v.value : v;
};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const gw = (process.env.LTX_GATEWAY ?? (await vget("salad", "SALAD_LTX_GATEWAY"))).replace(/\/+$/, "");
const authH = process.env.LTX_AUTH_HEADER ?? "Salad-Api-Key";
const authV = process.env.LTX_AUTH_VALUE ?? (await vget("salad", "SALAD_API_KEY"));
const bucket = process.env.SALAD_R2_BUCKET ?? (await vget("salad", "SALAD_R2_BUCKET"));
const H: Record<string, string> = { [authH]: authV, "content-type": "application/json", "User-Agent": UA };

const template = JSON.parse(fs.readFileSync(process.env.LTX_TEMPLATE ?? "/root/ltx-build/ltx23_api_template.json", "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;
const stills = JSON.parse(fs.readFileSync("/tmp/lustig_stills_r2.json", "utf8")) as Record<string, { key: string; url: string }>;

const NEG = "low quality, worst quality, blurry, distorted, morphing, flickering, inconsistent, jittery motion, watermark, text, logo, cartoonish, deformed";
const SHOTS: Array<{ still: string; prompt: string }> = [
  { still: "hook.png", prompt: "Inside a moving 1900s steam-train carriage at night, a well-dressed man in a bowler hat sits by the rain-streaked window feigning calm as a gloved hand presses a revolver to his temple from off-frame; eyes flick sideways, jaw tight. Slow dolly in, shallow depth of field, flickering gas-lamp light, warm amber against cold blue window. Audio: rhythmic iron wheels clattering on rails, rain tapping glass, a low tense drone, faint hammer click." },
  { still: "scene1.png", prompt: "A gloved hand traces a route across a hand-drawn railway map on a wooden table lit by a single oil lamp; coins hold the paper's corners. Slow overhead push-in, shallow depth of field, warm lamp glow, deep shadows. Audio: quiet room tone, paper rustling, a ticking pocket-watch, a distant train whistle." },
  { still: "train.png", prompt: "Masked robbers in long coats move down the swaying corridor of a lamplit steam-train carriage as frightened passengers shrink into their seats; torch beams sweep faces. Handheld tracking following the men, shallow depth of field, flickering warm light against night windows. Audio: iron wheels pounding rails, muffled frightened murmurs, boots on wood, a sharp shouted command." },
  { still: "scene8_getaway.png", prompt: "At dawn the robbers gallop from a stopped train across misty countryside, saddlebags heavy, glancing back. Wide tracking alongside the riders, golden-hour backlight, soft haze, long shadows. Audio: thundering hooves on wet ground, heavy breathing, distant train hiss fading, wind rushing." },
];

function patch(shot: { still: string; prompt: string }): typeof template {
  const g = JSON.parse(JSON.stringify(template));
  for (const n of Object.values(g) as Array<{ class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>) {
    if (n.class_type === "LoadImage") n.inputs.image = stills[shot.still].url;
    if (n.class_type === "CLIPTextEncode" || n.class_type === "GemmaAPITextEncode") {
      const neg = String(n._meta?.title ?? "").toLowerCase().includes("negativ");
      if ("text" in n.inputs) n.inputs.text = neg ? NEG : shot.prompt;
      if ("prompt" in n.inputs) n.inputs.prompt = neg ? NEG : shot.prompt;
    }
  }
  return g;
}

const results: Record<string, string> = {};
for (const [i, shot] of SHOTS.entries()) {
  const body = { prompt: patch(shot), s3: { bucket, prefix: "lustig/clips/", async: false } };
  console.log(`[${i + 1}/${SHOTS.length}] ${shot.still} → /prompt …`);
  const r = await fetch(`${gw}/prompt`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) { console.log("  ERR", r.status, txt.slice(0, 300)); continue; }
  const s3url = txt.match(/s3:\/\/[^"\\]+\.(mp4|webm|mov)/i)?.[0] ?? txt.match(/https?:\/\/[^"\\]+\.(mp4|webm|mov)/i)?.[0] ?? txt.slice(0, 200);
  results[shot.still] = s3url;
  console.log("  ->", s3url);
}
fs.writeFileSync("/tmp/heist_clips_r2.json", JSON.stringify(results, null, 2));
console.log("DONE →", JSON.stringify(results));
