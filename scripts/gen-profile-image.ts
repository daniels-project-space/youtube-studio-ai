/**
 * Generate a custom profile image (hooded stoic statue, dramatic, grey bg) via
 * FLUX1.1 [pro], store it as the channel's avatar in R2, and print a shareable
 * link. One-off.
 *
 *   npx tsx scripts/gen-profile-image.ts
 */
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VAULT = "https://fantastic-roadrunner-485.convex.cloud/api/query";
async function vault(service: string): Promise<Record<string, string>> {
  const r = await fetch(VAULT, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service }, format: "json" }),
  });
  const j = (await r.json()) as { value: { keyName: string; value: string }[] };
  const o: Record<string, string> = {};
  for (const s of j.value) o[s.keyName] = s.value;
  return o;
}

async function main() {
  const fal = await vault("fal");
  if (fal.FAL_KEY) process.env.FAL_KEY = fal.FAL_KEY;
  const cf = await vault("cloudflare");
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) if (cf[k]) process.env[k] = cf[k];
  process.env.R2_BUCKET = "youtube-studio-ai";

  const { generateFalFluxProImage } = await import("@/lib/falImage");
  const { putObject, presignDownload } = await import("@/lib/storage");

  const prompt =
    "A dramatic ancient stoic statue wearing a HOOD (cloaked, cowled), carved from luminous " +
    "light-grey and white marble, standing solemnly and powerfully, head slightly lowered, " +
    "the hood casting a soft shadow over the face, weathered detailed stone, strong cinematic " +
    "rim lighting and chiaroscuro, centered full-frame portrait, on a plain neutral GREY studio " +
    "background, ultra detailed, photorealistic, no text, no letters, no watermark.";

  const url = await generateFalFluxProImage({ prompt, width: 1024, height: 1024 });
  const tmp = join(tmpdir(), "profile.png");
  await writeFile(tmp, Buffer.from(await (await fetch(url)).arrayBuffer()));

  // Overwrite the channel's existing avatar key so the UI picks it up.
  const key = "owner/owner_daniel/channel/the-quiet-stoic-1780409262742/art/avatar.png";
  await putObject(key, await readFile(tmp), { contentType: "image/png" });

  const signed = await presignDownload(key, { expiresIn: 604800 });
  const short = await (await fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(signed))).text();
  await writeFile(join(process.cwd(), "_profile.png"), await readFile(tmp));
  console.log("R2 key:", key);
  console.log("LINK\t" + short);
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
