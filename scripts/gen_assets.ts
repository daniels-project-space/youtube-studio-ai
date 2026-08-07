/**
 * gen_assets.ts — Phase A+C of the Lustig film: generate scene stills
 * (Nano-Banana, character-referenced to hook.png) + narration (ElevenLabs) for
 * every beat, upload to R2, and write a manifest. No GPU needed. Resumable:
 * skips assets already in R2. Run: npx tsx scripts/gen_assets.ts
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { generateBananaImage } from "@/lib/banana";
import { synthNarration } from "@/lib/tts";
import { putObject, presignDownload, listObjects } from "@/lib/storage";

const BUCKET = "youtube-studio-ai";
const VOICE = process.env.LUSTIG_VOICE || "IKne3meq5aSn9XLyUdCD"; // cinematic narrator
const DIR = "/root/ltx-build/film";

type Beat = { id: string; narration: string; visual: string; camera: string; still: string };
type Script = { slug: string; title: string; style: string; character: string; beats: Beat[] };
type ManifestBeat = Pick<Beat, "camera" | "id" | "narration" | "visual"> & {
  stillKey: string;
  voDur: number;
  voKey: string;
};

const hasChar = (v: string) => /\bcon man\b|the same man|young sharp-eyed man|the man\b/i.test(v);

async function main() {
  mkdirSync(DIR, { recursive: true });
  await bootstrapSecrets((m) => console.log("[boot]", m), { required: ["ELEVENLABS_API_KEY", "GEMINI_API_KEY"] });
  const script: Script = JSON.parse(readFileSync(`${DIR}/lustig_script.json`, "utf8"));

  // character reference (hook.png) as base64 for Lustig beats
  const refUrl = await presignDownload("lustig/stills/hook.png", { bucket: BUCKET, expiresIn: 3600 });
  const refB64 = Buffer.from(await (await fetch(refUrl)).arrayBuffer()).toString("base64");

  const existing = new Set(await listObjects("lustig/film/", BUCKET).catch(() => [] as string[]));
  const pool = async (n: number, items: Beat[], fn: (b: Beat) => Promise<void>) => {
    let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const b = items[i++]; try { await fn(b); } catch (e) { console.log(`[ERR ${b.id}]`, e instanceof Error ? e.message : e); } } }));
  };

  const manifest: ManifestBeat[] = [];
  const probe = (f: string) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${f}`).toString().trim()) || 3;

  await pool(3, script.beats, async (b) => {
    // ---- STILL ----
    let stillKey: string;
    if (b.still.startsWith("lustig/stills/")) {
      stillKey = b.still; // reuse an existing reference still
    } else {
      stillKey = `lustig/film/stills/${b.id}.png`;
      if (!existing.has(stillKey)) {
        const useRef = hasChar(b.visual);
        const prompt = useRef
          ? `Consistent recurring character: the SAME man as in the reference image — ${script.character}. New scene, keep his exact face, mustache and period wardrobe. SCENE: ${b.visual}. ${script.style}.`
          : `${b.visual}. ${script.style}.`;
        const png = await generateBananaImage({
          prompt, aspectRatio: "16:9", imageSize: "2K", tier: "pro",
          images: useRef ? [{ data: refB64, mimeType: "image/png" }] : undefined,
        });
        await putObject(stillKey, png, { bucket: BUCKET, contentType: "image/png" });
        console.log(`[still ${b.id}] ✓${useRef ? " (char-ref)" : ""}`);
      } else console.log(`[still ${b.id}] cached`);
    }
    // ---- NARRATION ----
    const voKey = `lustig/film/vo/${b.id}.mp3`;
    const voFile = `${DIR}/vo_${b.id}.mp3`;
    if (!existing.has(voKey)) {
      const buf = await synthNarration({ text: b.narration, provider: "elevenlabs", elevenVoiceId: VOICE, speed: 0.97 });
      writeFileSync(voFile, Buffer.from(buf));
      await putObject(voKey, readFileSync(voFile), { bucket: BUCKET, contentType: "audio/mpeg" });
      console.log(`[vo ${b.id}] ✓`);
    } else {
      const url = await presignDownload(voKey, { bucket: BUCKET, expiresIn: 3600 });
      writeFileSync(voFile, Buffer.from(await (await fetch(url)).arrayBuffer()));
    }
    const dur = probe(voFile);
    manifest.push({ id: b.id, narration: b.narration, camera: b.camera, visual: b.visual, stillKey, voKey, voDur: dur });
  });

  manifest.sort((a, b) => a.id.localeCompare(b.id));
  const total = manifest.reduce((s, m) => s + m.voDur + 0.5, 0);
  writeFileSync(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  await putObject("lustig/film/manifest.json", readFileSync(`${DIR}/manifest.json`), { bucket: BUCKET, contentType: "application/json" });
  console.log(`\nMANIFEST_DONE beats=${manifest.length} total_runtime=${Math.round(total)}s`);
}
main().catch((e) => { console.error("GEN_ASSETS_FAILED:", e); process.exit(1); });
