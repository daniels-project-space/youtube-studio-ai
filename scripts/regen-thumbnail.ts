/**
 * Standalone: regenerate ONE narrated-essay thumbnail using the NEW deterministic
 * overlap guard (measure statue left edge → cap title width → reject+regenerate
 * if the title would touch the face). Uploads to a temp R2 key and prints a
 * presigned link so the result can be eyeballed without a full render.
 *
 *   npx tsx scripts/regen-thumbnail.ts "THE STOIC SELF-MASTERY SECRET"
 */
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VAULT = "https://fantastic-roadrunner-485.convex.cloud/api/query";
async function vault(service: string): Promise<Record<string, string>> {
  const r = await fetch(VAULT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service }, format: "json" }),
  });
  const j = (await r.json()) as { value: { keyName: string; value: string }[] };
  const o: Record<string, string> = {};
  for (const s of j.value) o[s.keyName] = s.value;
  return o;
}

async function main() {
  const ttl = process.argv[2] || "THE STOIC SELF-MASTERY SECRET";

  const fal = await vault("fal");
  if (fal.FAL_KEY) process.env.FAL_KEY = fal.FAL_KEY;
  const cf = await vault("cloudflare");
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) if (cf[k]) process.env[k] = cf[k];
  process.env.R2_BUCKET = "youtube-studio-ai";

  const { generateFalFluxProImage } = await import("@/lib/falImage");
  const { planSubjectLayout, subjectLeftEdgeFrac, thumbnailDesign } = await import("@/lib/ffmpeg");
  const { resolveThumbnailStyle, buildBasePrompt, TEXT_FREE_SUFFIX } = await import("@/lib/thumbnailFormula");
  const { putObject, presignDownload } = await import("@/lib/storage");

  const style = resolveThumbnailStyle("narrated-essay");
  const basePrompt = `${buildBasePrompt(style, "Stoic self-mastery through reflective writing", "stoicism")} ${TEXT_FREE_SUFFIX}`;
  const tmp = tmpdir();
  const outJpg = join(tmp, "regen_thumb.jpg");

  const X = 60, MARGIN = 44, maxAttempts = 4;
  let ok = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = await generateFalFluxProImage({ prompt: basePrompt });
    const base = join(tmp, `regen_base_${attempt}.png`);
    await writeFile(base, Buffer.from(await (await fetch(url)).arrayBuffer()));

    const layout = await planSubjectLayout(base);
    if (!layout.leftZoneClean && attempt < maxAttempts) {
      console.log(`attempt ${attempt}: subject not cleanly right (L${layout.left}/R${layout.right}) — regenerating`);
      continue;
    }
    const subjFrac = await subjectLeftEdgeFrac(base, { flip: layout.flip });
    const subjLeftPx = subjFrac >= 1 ? 660 : Math.round(subjFrac * 1280);
    const maxTextW = subjLeftPx - X - MARGIN;
    const d = await thumbnailDesign({
      basePath: base, outJpg,
      brushPath: join(process.cwd(), "src/assets/thumb_brush_swash.png"),
      title: ttl, tagline: style.design!.tagline, channel: "The Quiet Stoic",
      badge: style.design!.badge, accentHex: style.design!.accentHex, font: style.title.font,
      flipBase: layout.flip, maxTextW,
    });
    console.log(`attempt ${attempt}: flip=${layout.flip} subjLeft=${subjLeftPx}px textRight=${d.textRightPx}px fits=${d.fits} maxTextW=${maxTextW}`);
    if ((!d.fits || d.textRightPx > subjLeftPx - MARGIN) && attempt < maxAttempts) {
      console.log(`  → title would touch the subject — regenerating`);
      continue;
    }
    ok = true;
    console.log(`  → CLEAN (gap of ${subjLeftPx - d.textRightPx}px between title and statue)`);
    break;
  }
  if (!ok) console.log("warning: accepted last attempt without a clean gap");

  const key = `owner/owner_daniel/channel/the-quiet-stoic-1780409262742/_thumb_preview/regen.jpg`;
  await putObject(key, await readFile(outJpg), { contentType: "image/jpeg" });
  const signed = await presignDownload(key, { expiresIn: 604800 });
  const short = await (await fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(signed))).text();
  await writeFile(join(process.cwd(), "_regen_thumb.jpg"), await readFile(outJpg));
  console.log("LINK\t" + short);
  console.log("LOCAL\t_regen_thumb.jpg");
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
