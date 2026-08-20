/**
 * `provision-youtube` — fully autonomous: in ONE authenticated Browserbase
 * session, the computer-use agent (1) creates a brand-account YouTube channel,
 * (2) switches to it so it's active, then (3) walks our OAuth consent screen and
 * clicks Allow. Google redirects to /api/youtube-callback, which stores the
 * per-channel refresh token server-side — so the app channel ends up linked with
 * no human in the loop. All cloud (Trigger + Browserbase), nothing local.
 *
 * Requires BROWSERBASE_CONTEXT_ID (a context pre-authed with Google login).
 */
import { task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { withStagehand, hasBrowserbase } from "@/lib/browserbase";
import { runStagehandAgentLoop } from "@/lib/stagehandAgentLoop";

export interface ProvisionYoutubeArgs {
  /** App channel id to link the new YouTube channel to. */
  appChannelId: string;
  /** Display name for the new YouTube channel. */
  name: string;
}

const BASE = process.env.OAUTH_REDIRECT_BASE ?? "https://youtube-studio-ai.vercel.app";

interface SHPage {
  /** Stagehand 4.x: page accessors are async (they round-trip over CDP). */
  url: () => Promise<string>;
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
}
interface SH {
  context: { newPage: (url?: string) => Promise<SHPage> };
  /** Stagehand 4.x instance exposing act/observe/extract; driven by the step-loop. */
  stagehand: unknown;
}

/**
 * Extra per-step constraints for the hand-rolled agent loop. Stagehand 4.x
 * removed the built-in agent, so these are re-asserted on EVERY decision rather
 * than stated once in the top-level instruction.
 */
const channelSafetyRules = (name: string): string[] => [
  `The ONLY channel you may create, select, or authorize is exactly "${name}".`,
  "NEVER delete or rename an existing channel, under any circumstances.",
  "If you cannot tell which option is the exact target channel, stop instead of guessing.",
];

export const provisionYoutubeTask = task({
  id: "provision-youtube",
  maxDuration: 900,
  run: async (payload: ProvisionYoutubeArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[yt-provision] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    if (!hasBrowserbase()) return { ok: false, error: "Browserbase not configured." };
    if (!process.env.BROWSERBASE_CONTEXT_ID) {
      return { ok: false, needsAuth: true, error: "No authenticated Browserbase context (BROWSERBASE_CONTEXT_ID)." };
    }
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
    const convex = new ConvexHttpClient(url);
    const name = payload.name.trim();
    const appChannelId = payload.appChannelId as Id<"channels">;
    const appChannel = await convex.query(api.channels.getChannel, {
      channelId: appChannelId,
    });
    if (!appChannel) return { ok: false, error: "app channel not found" };

    try {
      const { value, sessionId } = await withStagehand(async (shU) => {
        const sh = shU as SH;
        const page = await sh.context.newPage("https://www.youtube.com/channel_switcher");
        await page.waitForTimeout(3000);

        // 1+2: create the brand channel (if needed) and make it the ACTIVE channel.
        // Inherits the non-Google Stagehand model pinned by withStagehand() for
        // act/observe; the per-step decision uses the pinned OpenRouter route.
        const create = await runStagehandAgentLoop(
          sh.stagehand,
          `You are on YouTube, signed in. Ensure a brand-new YouTube channel named "${name}" exists, then ` +
            `SWITCH to it so it becomes the ACTIVE channel. If "${name}" already exists, just switch to it. To ` +
            `create: from the channel switcher click "Create a channel"/"Create a new channel", enter the name ` +
            `"${name}", accept terms, click Create, skip optional photo/handle. NEVER delete/rename existing ` +
            `channels. Finish once "${name}" is the active channel (its name shows as the current account).`,
          { maxSteps: 35, log, extraRules: channelSafetyRules(name) },
        );
        log("create+switch done", { msg: create?.message?.slice(0, 200), steps: create.steps });

        // 3: walk OUR consent screen; the callback stores the token server-side.
        await page.goto(`${BASE}/api/youtube-connect?channelId=${appChannelId}`, { timeout: 60000 });
        await page.waitForTimeout(3000);
        const consent = await runStagehandAgentLoop(
          sh.stagehand,
          `You are on a Google OAuth consent flow for an app called "YouTube Studio AI". Complete it: if asked to ` +
            `choose an account or a channel, choose "${name}" (NOT any other channel). Click Continue / Allow / ` +
            `Authorize through every screen, including any "Google hasn't verified this app" → Advanced → Continue. ` +
            `Finish once the browser is redirected back to the youtube-studio-ai app (URL contains "youtube-studio-ai" ` +
            `or "yt=connected").`,
          { maxSteps: 30, log, extraRules: channelSafetyRules(name) },
        );
        const finalUrl = await page.url();
        log("consent done", { url: finalUrl, msg: consent?.message?.slice(0, 200), steps: consent.steps });
        return { finalUrl, createMsg: create?.message ?? "", consentMsg: consent?.message ?? "" };
      }, log);

      // Verify the callback actually stored a token for this channel.
      let linked = null as { ytTitle?: string; ytChannelId?: string } | null;
      for (let i = 0; i < 6; i++) {
        const row = await convex.query(api.youtubeAuth.getForChannel, {
          channelId: appChannelId,
          ownerId: appChannel.ownerId,
          secret: requireInternalQuerySecret(),
        }).catch(() => null);
        if (row) { linked = { ytTitle: row.ytTitle ?? undefined, ytChannelId: row.ytChannelId ?? undefined }; break; }
        await new Promise((r) => setTimeout(r, 2500));
      }
      const matched = !!linked && (linked.ytTitle ?? "").toLowerCase().includes(name.toLowerCase());
      log("provision result", { linked: !!linked, ytTitle: linked?.ytTitle, matched, sessionId });
      return {
        ok: !!linked,
        name,
        appChannelId: payload.appChannelId,
        linkedTo: linked?.ytTitle ?? null,
        nameMatched: matched,
        warning: linked && !matched ? `Linked to "${linked.ytTitle}" — may not be the new "${name}" channel; switch to it on YouTube and Reconnect.` : undefined,
        finalUrl: value.finalUrl,
        sessionId,
        liveView: sessionId ? `https://www.browserbase.com/sessions/${sessionId}` : undefined,
      };
    } catch (e) {
      return { ok: false, name, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
