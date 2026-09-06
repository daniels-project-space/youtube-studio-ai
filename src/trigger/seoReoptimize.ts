/**
 * `seo-reoptimize` — the publish-side half of the learning loop. The learning
 * task (learn.ts) records each published video's CTR + retention in the per-channel
 * performance ledger; this task finds the UNDERperformers and rewrites their title +
 * tags on YouTube (videos.update) to lift click-through — no re-upload, no re-render.
 *
 * Containment: the legacy performance ledger cannot prove that an observation belongs
 * to a particular published title/thumbnail package. Until the durable package-
 * attribution contract exists, even explicitly approved runs stop before Gemini or
 * YouTube calls and request manual reconciliation instead.
 */
import { schedules, task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  STUDIO_AUTOMATION_GATES,
  studioAutomationGate,
} from "@/lib/automationGate";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { loadLedger, saveLedger, type PerfEntry } from "@/lib/performance";
import { updateVideoMetadata } from "@/lib/youtube";
import { requireYouTubeConnector } from "@/lib/youtubeConnector";
import { YOUTUBE_WRITE_SCOPES } from "@/lib/publishingPolicy";
import { hasGeminiKey, geminiJson } from "@/lib/gemini";

const MS_30D = 30 * 86_400_000;
const MIN_VIEWS = 200; // legacy ranking threshold; never package-confidence evidence
const MAX_PER_CHANNEL = 3; // gentle — don't churn the whole library at once
const score = (e: PerfEntry) => e.avgViewPct * 0.7 + (e.ctr ?? 0) * 0.3;

type Logger = (m: string) => void;

function unavailablePackageAttributionAdmission() {
  // Deliberately fail closed. The current R2 ledger has no immutable package version,
  // raw impressions, freshness boundary, or fully post-package observation. Do not
  // substitute views/CTR or a run-stage title for this admission record.
  return {
    admitted: false as const,
    action: "manual_reconciliation_required" as const,
    reason: "verified_package_attribution_required" as const,
    nextAction:
      "Record or reconcile the published title/thumbnail package, then collect a fresh, fully post-package, confidence-qualified attribution observation before retrying.",
  };
}

export async function reoptimize(
  ownerId: string,
  log: Logger,
  approvedForMetadataChanges = false,
) {
  if (!approvedForMetadataChanges) {
    log("seo-reopt: external metadata changes require explicit operator approval — skip");
    return { ok: true, skipped: "approval_required", updated: 0 };
  }
  const admission = unavailablePackageAttributionAdmission();
  if (!admission.admitted) {
    log(
      `seo-reopt: blocked — ${admission.reason}; ${admission.nextAction}`,
    );
    return { ok: false, updated: 0, ...admission };
  }
  await bootstrapSecrets((m) => log(m));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  // UNREACHABLE, and deliberately so — do not "fix" this by porting the rewrite
  // to another provider.
  //
  // unavailablePackageAttributionAdmission() above returns admitted:false
  // unconditionally ("Deliberately fail closed"), so this line is never reached.
  // hasGeminiKey() is separately hard-wired to false by policy, which made the
  // old message ("no Gemini key — skip") read like a missing configuration and
  // an invitation to swap in claudeJson. It is not: the containment is the
  // attribution requirement, not the provider, and src/lib/titleCtrSwap.ts says
  // of it "that containment is correct and this must not route around it".
  //
  // The sanctioned path is the TITLE SWAP, which can satisfy the attribution
  // record a general rewrite cannot, because it knows exactly which title was
  // live and from when.
  if (!hasGeminiKey()) {
    log(
      "seo-reopt: the general rewrite has no permitted provider AND is behind the " +
        "package-attribution containment — use the title swap (lib/titleCtrSwap.ts) instead",
    );
    return { ok: true, skipped: "no_llm", updated: 0 };
  }
  const convex = new ConvexHttpClient(url);
  const channels = (await convex.query(api.channels.listChannels, { ownerId })) as Array<{
    _id: Id<"channels">; slug: string; name: string; identity?: { niche?: string };
  }>;

  let updated = 0;
  const now = Date.now();
  for (const ch of channels) {
    const prefix = channelPrefix(ownerId, ch.slug);
    const ledger = await loadLedger(prefix);
    const settled = ledger.filter((e) => e.views >= MIN_VIEWS && e.avgViewPct > 0);
    if (settled.length < 4) continue; // not enough signal to know what "under" means

    const sorted = [...settled].sort((a, b) => score(b) - score(a));
    const top = sorted.slice(0, 3).map((e) => e.title).filter(Boolean);
    const median = score(sorted[Math.floor(sorted.length / 2)]);
    // Weakest below-median videos not re-optimized in the last 30 days.
    const cands = sorted
      .filter((e) => score(e) < median && (!e.reoptimizedAt || now - e.reoptimizedAt > MS_30D))
      .slice(-MAX_PER_CHANNEL);
    if (cands.length === 0) continue;

    let refreshToken: string;
    try {
      refreshToken = (
        await requireYouTubeConnector(convex, {
          channelId: ch._id,
          ownerId,
          requiredScopes: YOUTUBE_WRITE_SCOPES,
        })
      ).refreshToken;
    } catch (error) {
      log(
        `seo-reopt: ${ch.name} skipped — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const c of cands) {
      try {
        const o = await geminiJson<{ title?: string; tags?: string[] }>({
          prompt:
            `Rewrite the TITLE + TAGS of an UNDERPERFORMING YouTube video to boost click-through — WITHOUT clickbait ` +
            `and without changing what the video is actually about.\n` +
            `Topic: ${c.topic || c.title}\nCurrent title: "${c.title}"\n` +
            (ch.identity?.niche ? `Niche: ${ch.identity.niche}\n` : "") +
            (top.length ? `This channel's BEST-performing titles (match this energy/structure):\n${top.join("\n")}\n` : "") +
            `Return STRICT JSON {"title": string (<=70 chars, compelling + accurate), "tags": string[] (8-12 SEO tags)}.`,
          maxTokens: 400,
          temperature: 0.8,
        });
        const newTitle = (typeof o.title === "string" ? o.title : "").replace(/\s+/g, " ").trim();
        const tags = Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 12) : [];
        if (!newTitle || newTitle === c.title) continue;
        await updateVideoMetadata({ refreshToken, videoId: c.videoId, title: newTitle, tags: tags.length ? tags : undefined });
        c.reoptimizedAt = now;
        c.title = newTitle;
        updated++;
        log(`seo-reopt: ${ch.name} ${c.videoId} → "${newTitle}"`);
      } catch (e) {
        log(`seo-reopt: ${c.videoId} failed (${e instanceof Error ? e.message : e})`);
      }
    }
    await saveLedger(prefix, ledger);
  }
  log(`seo-reopt: done — ${updated} video(s) re-optimized across ${channels.length} channel(s)`);
  return { ok: true, updated };
}

export const seoReoptimizeSchedule = schedules.task({
  id: "seo-reoptimize",
  cron: "0 9 * * 1", // weekly, Monday 09:00 — after the weekend's metrics settle
  run: async () => {
    const gate = studioAutomationGate(STUDIO_AUTOMATION_GATES.insights);
    if (!gate.enabled) return gate;

    return reoptimize(
      process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      (m) => console.log(`[seo-reopt] ${m}`),
      false,
    );
  },
});

export const seoReoptimizeTask = task({
  id: "seo-reoptimize-now",
  run: async (payload: { ownerId?: string; approvedForMetadataChanges?: boolean }) =>
    reoptimize(
      payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel",
      (m) => console.log(`[seo-reopt] ${m}`),
      payload?.approvedForMetadataChanges === true,
    ),
});
