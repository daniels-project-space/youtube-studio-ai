/**
 * Channel art generator — a square avatar + a 16:9 banner rendered from the
 * channel's visual identity (palette + style + persona) via Flux, uploaded to
 * R2 under the channel prefix. Text-free (the name is rendered in the UI, not
 * baked into the image). Pure helper: callable from the `generate-channel-art`
 * task and the package builder.
 */
import { generateFluxImage } from "@/lib/replicate";
import { channelKey, putObject } from "@/lib/storage";

export interface ArtIdentity {
  name: string;
  persona?: string;
  styleGrammar?: string;
  palette?: string[];
  niche?: string;
}

export interface ChannelArtResult {
  imageKey: string;
  bannerKey: string;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

function paletteClause(palette?: string[]): string {
  return palette && palette.length
    ? `color palette ${palette.slice(0, 5).join(", ")}`
    : "cohesive cinematic color palette";
}

function avatarPrompt(id: ArtIdentity): string {
  return [
    `Channel avatar icon for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.persona ?? "",
    id.styleGrammar ?? "",
    paletteClause(id.palette),
    "iconic, centered, simple, high contrast, no text, no letters, no words, app-icon style",
  ]
    .filter(Boolean)
    .join(", ");
}

function bannerPrompt(id: ArtIdentity): string {
  return [
    `Wide channel banner artwork for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.styleGrammar ?? id.persona ?? "",
    paletteClause(id.palette),
    "atmospheric, cinematic, wide establishing composition, no text, no letters, no words",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Fetch a remote image URL into R2 at `key`; returns the key. */
async function pipeToR2(url: string, key: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`channelArt: fetch ${key} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await putObject(key, bytes, { contentType: "image/png" });
  return key;
}

/**
 * Generate avatar + banner for a channel and store them in R2. Returns the two
 * R2 keys (caller persists them onto the channel record).
 */
export async function generateChannelArt(
  ownerId: string,
  slug: string,
  identity: ArtIdentity,
  log: Logger = () => {},
): Promise<ChannelArtResult> {
  log("channelArt: generating avatar (1:1)…");
  const avatarUrl = await generateFluxImage({
    prompt: avatarPrompt(identity),
    aspectRatio: "1:1",
  });
  log("channelArt: generating banner (16:9)…");
  const bannerUrl = await generateFluxImage({
    prompt: bannerPrompt(identity),
    aspectRatio: "16:9",
  });

  const imageKey = await pipeToR2(avatarUrl, channelKey(ownerId, slug, "art/avatar.png"));
  const bannerKey = await pipeToR2(bannerUrl, channelKey(ownerId, slug, "art/banner.png"));
  log("channelArt: uploaded to R2", { imageKey, bannerKey });
  return { imageKey, bannerKey };
}
