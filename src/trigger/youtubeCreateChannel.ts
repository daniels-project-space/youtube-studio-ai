/**
 * `youtube-create-channel` — headless creation of a YouTube Brand-Account channel
 * via Browserbase + Stagehand's CUA agent, using a pre-authenticated Browserbase
 * context (BROWSERBASE_CONTEXT_ID). YouTube has NO channel-create API and the flow
 * is BotGuard-gated, so a real browser (running Google's JS) is required — this is
 * the right tool, not a workaround.
 *
 * The create dialog ("Your profile") exposes a NAME field and an @HANDLE field as
 * plain inputs, so we set a clean handle at birth. The avatar/photo, however, goes
 * through Google's cross-origin OneGoogle photo-picker iframe whose file input is
 * unreachable from this stack (proven exhaustively: deepLocator, raw CDP
 * setFileInputFiles, fileChooser interception, and Browserbase's upload-inject all
 * fail to reach it). So the avatar is NOT set here — it's a one-time, ~15s step in
 * the operator's own (trusted) browser. Description/banner/country come via the
 * official API after Link.
 *
 * After creating + switching, it reads the channel id from the Studio URL and
 * records it on the app channel (youtubeCreated) so the UI can prompt the operator
 * to Connect (the OAuth grant is the one step Google forces a human through).
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { withStagehand, hasBrowserbase } from "@/lib/browserbase";
import { CLAUDE_THUMBNAIL_MODEL } from "@/lib/anthropic";

export interface CreateChannelArgs {
  /** Display name for the new YouTube channel. */
  name: string;
  /** App channelId to wire the created channel back to. */
  channelId?: string;
  /** Desired @handle (without the @). Defaults to a slug of the name. */
  handle?: string;
}

interface SHPage {
  url: () => string;
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
}
interface SHAgent {
  execute: (instr: string | Record<string, unknown>) => Promise<{ success?: boolean; completed?: boolean; message?: string }>;
}
interface SH {
  context: { newPage: (url?: string) => Promise<SHPage> };
  agent: (opts: Record<string, unknown>) => SHAgent;
}

/** Extract a UC… channel id from a studio/youtube URL. */
function channelIdFromUrl(u: string): string | undefined {
  const m = u.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/);
  return m?.[1];
}

/** A clean, valid-ish YouTube handle from a display name. */
function suggestHandle(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 28);
  return base.length >= 3 ? base : `${base}channel`.slice(0, 28);
}

export const youtubeCreateChannelTask = task({
  id: "youtube-create-channel",
  maxDuration: 1200,
  // Browser flows are flaky (timeouts, transient nav) — retry the whole thing.
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 20000, factor: 2 },
  run: async (payload: CreateChannelArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[yt-create] ${m}`, x ?? "");
    await bootstrapSecrets(log);

    if (!hasBrowserbase()) return { ok: false, error: "Browserbase not configured." };
    if (!process.env.BROWSERBASE_CONTEXT_ID) {
      return { ok: false, needsAuth: true, error: "No authenticated Browserbase context (BROWSERBASE_CONTEXT_ID)." };
    }
    const name = payload.name.trim();
    const handle = (payload.handle?.trim() || suggestHandle(name)).replace(/^@/, "");
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;
    const setStatus = async (patch: Record<string, unknown>) => {
      if (!convex || !payload.channelId) return;
      try {
        await convex.mutation(api.channels.updateChannel, {
          channelId: payload.channelId as Id<"channels">,
          youtubeCreated: { createdAt: Date.now(), ...patch },
        });
      } catch (e) { log(`status update failed: ${e instanceof Error ? e.message : e}`); }
    };
    // Live, reactive status the channel card reads (no debug viewer needed).
    await setStatus({ status: "creating" });

    try {
      const { value, sessionId } = await withStagehand(async (shU) => {
        const sh = shU as SH;
        const page = await sh.context.newPage("https://www.youtube.com/channel_switcher");
        await page.waitForTimeout(3500);
        // Hybrid mode (DOM + vision): faster + more reliable than CUA vision-only,
        // so the session finishes well within the timeout.
        const agent = sh.agent({ mode: "hybrid", model: `anthropic/${CLAUDE_THUMBNAIL_MODEL}` });

        // Create the channel with a name + clean @handle (both plain text fields in
        // the "Your profile" dialog). Skip the photo (its picker is unreachable).
        const res = await agent.execute({
          instruction:
            `Goal: create a NEW YouTube channel and switch to it. On this channel-switcher page click ` +
            `"Create a channel" / "+ Create a channel" / "Kanal erstellen". A dialog titled "Your profile"/"Dein ` +
            `Profil" opens with a NAME field, an @handle/Alias field, a "Choose picture" button, and a final ` +
            `"Create channel"/"Kanal erstellen" button. Type the name "${name}" into the NAME field. Set the ` +
            `@handle/Alias field to "${handle}" (clear any prefilled value first). If YouTube says that handle is ` +
            `taken, accept its suggested handle or append 1-2 digits until accepted. Do NOT click "Choose ` +
            `picture"/skip the photo. Click "Create channel"/"Kanal erstellen". Then make "${name}" the ACTIVE ` +
            `channel and skip any later optional step (Set-up-later/Save-and-continue). Stop once "${name}" exists ` +
            `and is active. Do NOT touch other existing channels.`,
          maxSteps: 24,
        });
        await page.waitForTimeout(2500);

        // Land on the ACTIVE channel's Studio so the URL carries its UC… id.
        let channelId: string | undefined;
        try {
          await page.goto("https://studio.youtube.com/channel/switch", { timeout: 45000 }).catch(() => {});
          await page.waitForTimeout(2000);
          await page.goto("https://studio.youtube.com", { timeout: 45000 });
          await page.waitForTimeout(3500);
          channelId = channelIdFromUrl(page.url());
        } catch { /* best-effort */ }

        return {
          url: page.url(),
          channelId,
          success: Boolean(res?.success ?? res?.completed),
          message: res?.message ?? "",
        };
      }, log);

      // Wire the created channel back to the app channel (reactive — the card
      // updates itself; no debug viewer needed).
      if (value.channelId) {
        await setStatus({
          status: "created",
          ytChannelId: value.channelId,
          handle: `@${handle}`,
          url: `https://www.youtube.com/channel/${value.channelId}`,
        });
      } else {
        await setStatus({ status: value.success ? "created" : "failed" });
      }

      const liveView = sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined;
      const ok = Boolean(value.channelId) || value.success;
      log("yt-create finished", { ok, ytChannelId: value.channelId, handle, url: value.url, liveView });
      return {
        ok,
        name,
        handle: `@${handle}`,
        channelId: payload.channelId,
        ytChannelId: value.channelId ?? null,
        agentMessage: value.message,
        finalUrl: value.url,
        sessionId,
        liveView,
      };
    } catch (e) {
      await setStatus({ status: "failed" });
      return { ok: false, name, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
