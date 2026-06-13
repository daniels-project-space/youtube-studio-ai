// Render the Lustig PoC: per shot -> soul keyframe (soul_cinematic +
// custom_reference_id) -> Seedance 1.5 i2v with the camera-move prompt.
// Outputs clip URLs to /tmp/clips.txt. Run on the VPS (HIGGSFIELD_LIVE=1).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SOUL = readFileSync("/tmp/soulid.txt", "utf8").trim();
// The canonical locked hero render — referenced DIRECTLY on every keyframe
// (9/10 identity match vs 6/10 for the trained soul; the soul drops fine
// features like the thin mustache). This anchors the same face every shot.
const HERO = "439e9172-6d5c-4e63-a8e9-590577c71a68";
const LOCK = "This is the EXACT SAME man — identical face, same thin neat mustache, same slicked dark hair, same charcoal 1920s three-piece suit. Do not change his facial identity. ";
const shots = JSON.parse(readFileSync("/tmp/shotplan.json", "utf8")).shots;
console.log(`hero=${HERO} shots=${shots.length}`);

function hf(args) {
  const out = execFileSync("higgsfield", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, HIGGSFIELD_LIVE: "1" } });
  // Extract the JSON array/object from the output (skip any log lines).
  const s = out.indexOf("[") >= 0 ? out.indexOf("[") : out.indexOf("{");
  const e = Math.max(out.lastIndexOf("]"), out.lastIndexOf("}"));
  if (s < 0 || e < 0) throw new Error("no JSON in output: " + out.slice(0, 200));
  const j = JSON.parse(out.slice(s, e + 1));
  return Array.isArray(j) ? j : [j];
}

const clips = [];
for (let i = 0; i < shots.length; i++) {
  const sh = shots[i];
  console.log(`\n=== shot ${i + 1}: ${sh.cameraMove}, ${sh.lens} ===`);
  // 1) keyframe = canonical hero image as a DIRECT reference (identity lock)
  let kfId = null;
  try {
    const jobs = hf(["generate", "create", "nano_banana_2", "--image", HERO, "--aspect_ratio", "16:9", "--prompt", LOCK + sh.keyframePrompt, "--wait", "--wait-timeout", "6m", "--json"]);
    const job = jobs.find((x) => x.result_url) ?? jobs[0];
    kfId = job?.id ?? null;
    console.log(`keyframe job=${kfId} url=${job?.result_url ?? "?"}`);
  } catch (e) {
    console.log(`keyframe FAILED shot ${i + 1}: ${String(e).slice(0, 200)}`);
    clips.push("");
    continue;
  }
  if (!kfId) { clips.push(""); continue; }
  // 2) seedance 1.5 i2v
  try {
    const jobs = hf(["generate", "create", "seedance1_5", "--image", kfId, "--aspect_ratio", "16:9", "--resolution", "1080p", "--duration", "4", "--prompt", sh.i2vPrompt, "--wait", "--wait-timeout", "12m", "--json"]);
    const job = jobs.find((x) => x.result_url) ?? jobs[0];
    const url = job?.result_url ?? "";
    console.log(`clip=${url}`);
    clips.push(url);
  } catch (e) {
    console.log(`seedance FAILED shot ${i + 1}: ${String(e).slice(0, 200)}`);
    clips.push("");
  }
}
writeFileSync("/tmp/clips.txt", clips.join("\n"));
console.log("\nDONE clips:\n" + clips.join("\n"));
