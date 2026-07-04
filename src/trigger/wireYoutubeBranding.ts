/**
 * `wire-youtube-branding` — after a channel is LINKED, push the app channel's
 * details onto the YouTube channel via the official API: description (from the
 * Show Bible positioning / persona), country, default language, keywords, and the
 * banner image (from the app's generated banner in R2). Native + reliable.
 *
 * NOTE: the AVATAR / profile picture is intentionally NOT set here — YouTube has
 * no API for it and Stagehand can't drive the file dialog, so it stays a one-time
 * manual upload. The channel NAME is set at creation; the BANNER is the API-settable
 * image we apply here.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { updateChannelBranding, uploadChannelBanner } from "@/lib/youtube";
import { getObjectBytes } from "@/lib/storage";
import { makeRunTempDir, writeBytes, readBytes } from "@/lib/files";
import { imageToJpeg } from "@/lib/ffmpeg";
import { join } from "node:path";

export interface WireBrandingArgs {
  channelId: string;
}

const LANG_COUNTRY: Record<string, string> = {
  en: "US", de: "DE", es: "ES", fr: "FR", pt: "PT", it: "IT", nl: "NL",
};

export const wireYoutubeBrandingTask = task({
  id: "wire-youtube-branding",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 4000, maxTimeoutInMs: 15000, factor: 2 },
  run: async (payload: WireBrandingArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[yt-branding] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);

    const channelId = payload.channelId as Id<"channels">;
    const [channel, auth] = await Promise.all([
      convex.query(api.channels.getChannel, { channelId }),
      convex.query(api.youtubeAuth.getForChannel, { channelId, secret: process.env.INTERNAL_QUERY_SECRET ?? "" }),
    ]);
    if (!channel) return { ok: false, error: "channel not found" };
    if (!auth?.refreshToken || !auth.ytChannelId) {
      return { ok: false, error: "channel not linked yet (no token / yt id)" };
    }

    const id = channel.identity ?? {};
    const lang = (channel.language as string | undefined) ?? "en";
    const description = (id.creativeBrief?.positioning || id.persona || "").slice(0, 950);
    const keywords = (id.topicPool ?? []).slice(0, 8).map((t) => `"${t}"`).join(" ").slice(0, 480);

    // Banner (the API-settable image): upscale the app's banner to YouTube spec
    // (min 2048x1152; use 2560x1440) before upload — smaller images are rejected.
    let bannerExternalUrl: string | undefined;
    if (id.bannerKey) {
      try {
        const tmp = await makeRunTempDir(`banner-${channelId}`);
        const src = join(tmp, "banner_src.png");
        const out = join(tmp, "banner_2560.jpg");
        await writeBytes(src, await getObjectBytes(id.bannerKey));
        await imageToJpeg(src, out, 2560, 1440); // scale-to-cover + crop to 16:9
        bannerExternalUrl = await uploadChannelBanner(auth.refreshToken, await readBytes(out), "image/jpeg");
        log("banner uploaded (2560x1440)", { bannerExternalUrl });
      } catch (e) { log(`banner upload failed (continuing): ${e instanceof Error ? e.message : e}`); }
    }

    try {
      await updateChannelBranding({
        refreshToken: auth.refreshToken,
        ytChannelId: auth.ytChannelId,
        description: description || undefined,
        country: LANG_COUNTRY[lang] ?? "US",
        defaultLanguage: lang,
        keywords: keywords || undefined,
        bannerExternalUrl,
      });
      log("branding applied", { ytChannelId: auth.ytChannelId, lang, hasBanner: Boolean(bannerExternalUrl) });
      return { ok: true, ytChannelId: auth.ytChannelId, bannerSet: Boolean(bannerExternalUrl) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
