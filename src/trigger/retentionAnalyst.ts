/**
 * `retention-analyst` — the real-data learning loop.
 *
 * The pipeline knows EXACTLY what's on screen at every second of every video
 * (sentence timings, opening device, quote/insert windows, chapter cards,
 * intro/outro). YouTube knows exactly where viewers leave. This task joins the
 * two: fetch the per-second retention curve, locate the steep drops, attribute
 * each to the pipeline decision live at that moment, and have the showrunner
 * distill RULES that are written back into the channel's script playbook —
 * the system improves on real audience behavior, not judge proxies.
 *
 * Run per published video on a ≥7-day lag ({ runId }), or pointed at any run
 * by the Doctor/operator. dryRun returns the analysis without writing.
 */
import { task } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { fetchRetentionCurve, fetchVideoAnalytics, hasAnalyticsAccess } from "@/lib/youtubeAnalytics";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";
import { YOUTUBE_ANALYTICS_SCOPE } from "@/lib/publishingPolicy";
import { claudeJson } from "@/lib/anthropic";
import { ShortRetentionManifestSchema } from "@/engine/documentaryCollageShort";
import {
  describePackageOpeningRetentionAttribution,
  packageOpeningRetentionAttribution,
} from "@/lib/retentionAttribution";
import {
  deriveAudienceOpeningRetention,
  describeAudienceOpeningRetention,
} from "@/lib/audienceRetentionOpening";

interface Drop {
  atRatio: number;
  atSec: number;
  lostPctOfRemaining: number;
  /** What the pipeline had on screen at that moment. */
  context: string[];
}

export const retentionAnalystTask = task({
  id: "retention-analyst",
  maxDuration: 600,
  run: async (payload: { runId: string; dryRun?: boolean }) => {
    const log = (m: string) => console.log(`[retention] ${m}`);
    // Retention learning is distilled with the declared non-Google text model;
    // do not make it dependent on the thumbnail-only Gemini capability.
    await bootstrapSecrets(log);

    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    // 1. The run's ground-truth timeline from its persisted stage outputs.
    const runId = payload.runId as Id<"runs">;
    const stages = await convex.query(api.runStages.listRunStages, { runId });
    const out = (block: string) =>
      (stages.find((s: { block: string; status: string }) => s.block === block && s.status === "ok") as
        | { outputs?: Record<string, unknown> }
        | undefined)?.outputs ?? {};
    const videoId = String(out("upload_draft")["youtubeVideoId"] ?? "");
    if (!videoId) return { ok: false, reason: "run has no uploaded video" };
    const run = await convex.query(api.runs.getRun, { runId });
    const channelId = run?.channelId as Id<"channels"> | undefined;
    if (!channelId) return { ok: false, reason: "run has no channel" };
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel) return { ok: false, reason: "channel not found" };
    const connector = await requireYouTubeConnector(convex, {
      channelId,
      ownerId: channel.ownerId,
      requiredScopes: [YOUTUBE_ANALYTICS_SCOPE],
    });
    if (!hasAnalyticsAccess(connector.refreshToken)) {
      return { ok: false, reason: "no channel-bound yt-analytics OAuth access" };
    }
    const shortRetention = ShortRetentionManifestSchema.safeParse(
      out("short_strategy")["shortRetentionManifest"],
    );
    // Native documentary Shorts have no timeline_assemble stage. Their locked
    // beat map is the ground truth, and must win over the long-form fallback.
    const durationSec = Number(
      shortRetention.success
        ? shortRetention.data.durationSec
        : out("documotion_short")["videoDurationSec"] ?? out("timeline_assemble")["videoDurationSec"] ?? 0,
    );
    const introSec = Number(out("intro_card")["introSec"] ?? 0);
    const timings = (out("narration_tts")["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    const chapterPlan = (out("narration_tts")["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined) ?? [];
    const quotes = (out("quote_overlays")["quoteOverlays"] as { startSec: number; durSec: number; text?: string }[] | undefined) ?? [];
    const inserts = (out("visual_inserts")["insertOverlays"] as { startSec: number; durSec: number }[] | undefined) ?? [];
    const topic = String(out("topic_select")["topic"] ?? "");
    const packageOpeningAttribution = packageOpeningRetentionAttribution({
      plan: out("package_to_opening_plan")["packageToOpeningPlan"],
      receipt: out("qa_visual")["packageToOpening"],
    });

    // 2. The retention curve (≥3-day metric finality; caller enforces ~7d lag).
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const curve = await fetchRetentionCurve({
      videoId,
      startDate: start,
      endDate: end,
      refreshToken: connector.refreshToken,
    });
    if (!curve || curve.length < 10) return { ok: false, reason: "no retention curve yet (too few views or too early)" };
    const openingRetention = deriveAudienceOpeningRetention({ durationSec, curve });
    const openingRetentionSummary = describeAudienceOpeningRetention(openingRetention);
    const summary = await fetchVideoAnalytics({
      videoId,
      startDate: start,
      endDate: end,
      refreshToken: connector.refreshToken,
    });

    // 3. Steep drops: ≥4% of REMAINING viewers lost within one curve step.
    const describeAt = (sec: number): string[] => {
      const ctx: string[] = [];
      if (shortRetention.success) {
        const frame = Math.round(sec * shortRetention.data.fps);
        const beat = shortRetention.data.beats.find(
          (candidate) => frame >= candidate.startFrame && frame < candidate.endFrame,
        );
        if (beat) {
          ctx.push(`beat:${beat.id}`);
          ctx.push(`purpose:${beat.purpose}`);
          ctx.push(`motion:${beat.motionRecipe}`);
          if (beat.claimIds.length) ctx.push(`claims:${beat.claimIds.join(",")}`);
          if (beat.assetProvenanceIds.length) ctx.push(`asset-provenance:${beat.assetProvenanceIds.join(",")}`);
        }
      }
      if (sec < introSec) ctx.push("intro title card");
      const sent = timings.find((t) => sec >= introSec + t.start && sec <= introSec + t.end);
      if (sent) ctx.push(`narration: "${sent.text.slice(0, 90)}"`);
      const q = quotes.find((o) => sec >= o.startSec && sec <= o.startSec + o.durSec);
      if (q) ctx.push("quote card on screen");
      const ins = inserts.find((o) => sec >= o.startSec && sec <= o.startSec + o.durSec);
      if (ins) ctx.push("data insert on screen");
      let cursor = introSec;
      for (const w of chapterPlan) {
        if (w.kind === "card" && sec >= cursor && sec <= cursor + w.durSec) ctx.push(`chapter card "${w.heading ?? ""}"`);
        cursor += w.durSec;
      }
      if (durationSec && sec > durationSec - 20) ctx.push("outro window");
      return ctx.length ? ctx : ["plain footage + narration"];
    };
    const drops: Drop[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1].watch;
      const cur = curve[i].watch;
      if (prev <= 0) continue;
      const lost = ((prev - cur) / prev) * 100;
      if (lost >= 4) {
        const atSec = Math.round(curve[i].ratio * durationSec);
        drops.push({ atRatio: curve[i].ratio, atSec, lostPctOfRemaining: Math.round(lost * 10) / 10, context: describeAt(atSec) });
      }
    }
    drops.sort((a, b) => b.lostPctOfRemaining - a.lostPctOfRemaining);
    const affectedShortBeatIds = [...new Set(
      drops.flatMap((drop) => drop.context
        .filter((entry) => entry.startsWith("beat:"))
        .map((entry) => entry.slice("beat:".length))),
    )];
    const hookHold = curve.find((p) => p.ratio >= 0.05)?.watch ?? 1; // survivors at 5%
    log(`curve: ${curve.length} pts | hook hold ${(hookHold * 100).toFixed(0)}% | ${openingRetentionSummary} | ${drops.length} steep drop(s) | avgView ${summary?.avgViewPct?.toFixed(1) ?? "?"}%`);

    // 4. Channel + playbook context for attribution.
    const playbook = (channel as { scriptPlaybook?: Record<string, unknown> } | null)?.scriptPlaybook;
    const openingAttribution = describePackageOpeningRetentionAttribution(packageOpeningAttribution);

    // 5. Showrunner distills learnings → playbook rules.
    const analysis = await claudeJson<{
      diagnosis?: string;
      learnings?: { rule: string; evidence: string; confidence: "high" | "medium" | "low" }[];
    }>({
      tier: "pro",
      maxTokens: 1600,
      temperature: 0.3,
      system: "You are a YouTube retention engineer turning REAL audience data into writing rules. Return ONLY JSON.",
      prompt:
        `Video: "${topic}" (${durationSec}s) on "${channel?.name}". Opening evidence: ${openingAttribution}.\n` +
        `Hook hold at 5%: ${(hookHold * 100).toFixed(0)}% | opening measure: ${openingRetentionSummary} | avg view: ${summary?.avgViewPct?.toFixed(1) ?? "?"}% | views: ${summary?.views ?? "?"}.\n\n` +
        `STEEP DROPS (≥4% of remaining viewers, worst first) with what the pipeline had on screen:\n` +
        drops.slice(0, 8).map((d) => `- ${d.atSec}s (${(d.atRatio * 100).toFixed(0)}%): -${d.lostPctOfRemaining}% — ${d.context.join("; ")}`).join("\n") +
        `\n\nDistill: diagnosis (2-3 sentences, what actually loses viewers on THIS channel) + learnings: 1-4 RULES ` +
        `for future scripts/structure, each with the evidence line and a confidence. Rules must be actionable by a ` +
        `writer/editor (pacing, device choice, card timing, segment length) — never generic advice. ` +
        `If the data is too thin for a confident rule, return fewer or none.\n` +
        `Return STRICT JSON {"diagnosis":string,"learnings":[{"rule","evidence","confidence"}]}.`,
    });
    const learnings = (analysis.learnings ?? []).filter((l) => l.rule);
    log(`diagnosis: ${analysis.diagnosis ?? "n/a"} | ${learnings.length} learning(s)`);

    // 6. Propose a versioned policy change. No audience-derived rule enters the
    // active playbook until its offline evidence gate passes and an operator
    // explicitly approves activation.
    if (!payload.dryRun && playbook) {
      const entries = learnings.length
        ? learnings.map((l) => ({
            ...l,
            videoId,
            runId: payload.runId,
            packageOpeningAttribution,
            openingRetention,
            ...(shortRetention.success
              ? { lane: shortRetention.data.lane, shortBeatIds: affectedShortBeatIds }
              : {}),
            at: Date.now(),
          }))
        : [{ rule: "(no confident rule — data too thin)", evidence: "analysis ran; digest ignores low confidence", confidence: "low" as const, videoId, runId: payload.runId, packageOpeningAttribution, openingRetention, at: Date.now() }];
      const existing = (playbook["retentionLearnings"] as unknown[] | undefined) ?? [];
      const updated = {
        ...playbook,
        retentionLearnings: [...entries, ...existing].slice(0, 20),
      };
      const now = Date.now();
      await convex.mutation(api.learningGovernance.propose, {
        secret: requireInternalQuerySecret(),
        ownerId: channel.ownerId,
        channelId,
        connectorId: connector.connectorId,
        connectorVersion: connector.tokenVersion,
        recommendationKey: `retention:${String(channelId)}:${videoId}`,
        kind: "retention_rule",
        target: "script_playbook",
        sourceVideoIds: [videoId],
        dataWindowStart: start,
        dataWindowEnd: end,
        proposal: {
          nextValue: updated,
          diagnosis: analysis.diagnosis,
          runId: payload.runId,
          packageOpeningAttribution,
          openingRetention,
          ...(shortRetention.success
            ? {
                lane: shortRetention.data.lane,
                shortBeatIds: affectedShortBeatIds,
                shortBeatRetention: shortRetention.data.beats,
              }
            : {}),
        },
        offlineEvaluation: {
          method: "settled_retention_curve_evidence_v1",
          sampleSize: summary?.views ?? 0,
          baselineScore: summary?.avgViewPct,
          passed: curve.length >= 10 && (summary?.views ?? 0) >= 100,
          notes:
            curve.length >= 10 && (summary?.views ?? 0) >= 100
              ? "Settled retention curve with at least 100 observed views."
              : "Evidence sample is too small; activation is blocked.",
        },
        createdAt: now,
      });
      log(`retention recommendation proposed with ${learnings.length} learning(s); operator approval required`);
    }
    return {
      ok: true,
      videoId,
      hookHoldPct: Math.round(hookHold * 100),
      avgViewPct: summary?.avgViewPct,
      packageOpeningAttribution,
      openingRetention,
      drops: drops.slice(0, 8),
      diagnosis: analysis.diagnosis,
      learnings,
    };
  },
});
