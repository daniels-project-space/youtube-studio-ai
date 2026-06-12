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
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { fetchRetentionCurve, fetchVideoAnalytics, hasAnalyticsAccess } from "@/lib/youtubeAnalytics";
import { claudeJson } from "@/lib/anthropic";

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
    await bootstrapSecrets(log, { required: ["GEMINI_API_KEY"] });
    if (!hasAnalyticsAccess()) return { ok: false, reason: "no yt-analytics OAuth access" };

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
    const durationSec = Number(out("timeline_assemble")["videoDurationSec"] ?? 0);
    const introSec = Number(out("intro_card")["introSec"] ?? 0);
    const timings = (out("narration_tts")["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    const chapterPlan = (out("narration_tts")["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined) ?? [];
    const quotes = (out("quote_overlays")["quoteOverlays"] as { startSec: number; durSec: number; text?: string }[] | undefined) ?? [];
    const inserts = (out("visual_inserts")["insertOverlays"] as { startSec: number; durSec: number }[] | undefined) ?? [];
    const topic = String(out("topic_select")["topic"] ?? "");

    // 2. The retention curve (≥3-day metric finality; caller enforces ~7d lag).
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const curve = await fetchRetentionCurve({ videoId, startDate: start, endDate: end });
    if (!curve || curve.length < 10) return { ok: false, reason: "no retention curve yet (too few views or too early)" };
    const summary = await fetchVideoAnalytics({ videoId, startDate: start, endDate: end });

    // 3. Steep drops: ≥4% of REMAINING viewers lost within one curve step.
    const describeAt = (sec: number): string[] => {
      const ctx: string[] = [];
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
    const hookHold = curve.find((p) => p.ratio >= 0.05)?.watch ?? 1; // survivors at 5%
    log(`curve: ${curve.length} pts | hook hold ${(hookHold * 100).toFixed(0)}% | ${drops.length} steep drop(s) | avgView ${summary?.avgViewPct?.toFixed(1) ?? "?"}%`);

    // 4. Channel + playbook context for attribution.
    const run = await convex.query(api.runs.getRun, { runId });
    const channelId = run?.channelId as Id<"channels"> | undefined;
    if (!channelId) return { ok: false, reason: "run has no channel" };
    const channel = await convex.query(api.channels.getChannel, { channelId });
    const playbook = (channel as { scriptPlaybook?: Record<string, unknown> } | null)?.scriptPlaybook;
    const deviceIdx = [...payload.runId].reduce((s, c) => s + c.charCodeAt(0), 0);
    const devices = (playbook?.["openingDevices"] as { name: string }[] | undefined) ?? [];
    const deviceUsed = devices.length ? devices[deviceIdx % devices.length].name : "unknown";

    // 5. Showrunner distills learnings → playbook rules.
    const analysis = await claudeJson<{
      diagnosis?: string;
      learnings?: { rule: string; evidence: string; confidence: "high" | "medium" | "low" }[];
    }>({
      maxTokens: 1600,
      temperature: 0.3,
      system: "You are a YouTube retention engineer turning REAL audience data into writing rules. Return ONLY JSON.",
      prompt:
        `Video: "${topic}" (${durationSec}s) on "${channel?.name}". Opening device used: "${deviceUsed}".\n` +
        `Hook hold at 5%: ${(hookHold * 100).toFixed(0)}% | avg view: ${summary?.avgViewPct?.toFixed(1) ?? "?"}% | views: ${summary?.views ?? "?"}.\n\n` +
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

    // 6. Persist: append to the playbook's retentionLearnings (capped, newest
    // first) — scriptGen's digest reads the playbook, so high-confidence rules
    // reach every future script.
    if (!payload.dryRun && playbook && learnings.length) {
      const existing = (playbook["retentionLearnings"] as unknown[] | undefined) ?? [];
      const updated = {
        ...playbook,
        retentionLearnings: [
          ...learnings.map((l) => ({ ...l, videoId, runId: payload.runId, deviceUsed, at: Date.now() })),
          ...existing,
        ].slice(0, 20),
      };
      await convex.mutation(api.channels.updateChannel, { channelId, scriptPlaybook: updated });
      log(`playbook updated with ${learnings.length} retention learning(s)`);
    }
    return {
      ok: true,
      videoId,
      hookHoldPct: Math.round(hookHold * 100),
      avgViewPct: summary?.avgViewPct,
      drops: drops.slice(0, 8),
      diagnosis: analysis.diagnosis,
      learnings,
    };
  },
});
