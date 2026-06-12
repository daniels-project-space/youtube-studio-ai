// LEGACY BASELINE (verbatim pre-topicraft engine) — kept ONLY for the A/B
// comparison harness (scripts/topicraft-ab.ts). Not wired into any pipeline.
/**
 * Topic optimizer — the single, reusable brain for "what should this channel
 * make next?" (works for ANY channel). It fuses every available signal:
 *
 *   - Channel IDENTITY (niche / persona / topic pool / banned) — the hard guardrail.
 *   - DONE topics (topicMemory + content plan) — never repeat; always send something new.
 *   - Long-term ANALYTICS (performance ledger: which past topics actually retained
 *     viewers + earned CTR) — lean toward what works.
 *   - COMPETITOR data (top-performing competitor videos in the niche) — find gaps
 *     and proven angles.
 *   - SEO signals (power words, title templates from the niche databank).
 *
 * A Director model ranks fresh, on-identity ideas weighted by those signals.
 * Degrades gracefully: with no models or no data it falls back to the topic pool
 * minus what's already been done. All inputs are best-effort (missing data ⇒
 * skipped, never throws).
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { loadPerformanceContext } from "@/lib/performance";
import { fetchNicheOutliers } from "@/lib/outliers";
import { agentJson } from "@/agents/mastra";
import { hasAnthropicKey } from "@/lib/anthropic";
import { hasGeminiKey, geminiJson } from "@/lib/gemini";
import { z } from "zod";

export interface OptimizeTopicsOpts {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: string;
  /** Per-channel R2 key prefix (for the performance ledger). */
  keyPrefix: string;
  count: number;
  identity: {
    niche?: string;
    persona?: string;
    topicPool?: string[];
    bannedWords?: string[];
    requiredCallbacks?: string[];
  };
  /** Extra topics to treat as already-taken (e.g. the current content plan). */
  alsoAvoid?: string[];
  log?: (m: string, x?: Record<string, unknown>) => void;
}

export interface OptimizedTopic {
  topic: string;
  rationale?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export async function optimizeTopicsLegacy(opts: OptimizeTopicsOpts): Promise<OptimizedTopic[]> {
  const log = opts.log ?? (() => {});
  const niche = opts.identity.niche ?? "";
  const channelId = opts.channelId as Id<"channels">;

  // ---- gather signals (all best-effort) ----
  const [done, plan, competitors, nicheIntel, databank, perfCtx] = await Promise.all([
    opts.convex.query(api.topicMemory.listForChannel, { channelId }).catch(() => [] as { key: string }[]),
    opts.convex.query(api.contentPlan.listPlan, { ownerId: opts.ownerId, channelId }).catch(() => [] as { topic: string }[]),
    niche
      ? opts.convex.query(api.competitors.listCompetitors, { ownerId: opts.ownerId, niche }).catch(() => [])
      : Promise.resolve([] as unknown[]),
    niche ? opts.convex.query(api.seo.getNiche, { ownerId: opts.ownerId, niche }).catch(() => null) : Promise.resolve(null),
    niche ? opts.convex.query(api.seo.getDatabank, { ownerId: opts.ownerId, niche }).catch(() => null) : Promise.resolve(null),
    loadPerformanceContext(opts.keyPrefix).catch(() => ""),
  ]);

  const doneSet = new Set<string>([
    ...(done as { key: string }[]).map((d) => norm(d.key)),
    ...(plan as { topic: string }[]).map((p) => norm(p.topic)),
    ...(opts.alsoAvoid ?? []).map(norm),
  ]);
  const competitorTitles = (competitors as { topVideos?: { title: string; views: number }[] }[])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 15)
    .map((v) => v.title);
  const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
    .map((p) => p.word)
    .slice(0, 14);
  const titleTemplates = ((databank as { titleTemplates?: string[] } | null)?.titleTemplates ?? []).slice(0, 8);

  // OUTLIER signal (free, self-hosted via YouTube Data API): videos massively
  // overperforming vs their channel size = the strongest "what's hot now" signal.
  let outlierTitles: string[] = [];
  let trendLines: string[] = [];
  if (niche) {
    const q = [niche, ...(opts.identity.topicPool ?? []).slice(0, 2)].filter(Boolean).join(" ");
    const [outliers, reddit] = await Promise.all([
      fetchNicheOutliers(q, { log, maxResults: 25 }).catch(() => []),
      // PRE-saturation signal: what the niche's audience is actively discussing
      // this week (outliers show what already works ON YouTube; Reddit shows
      // what people care about BEFORE creators cover it).
      import("@/lib/trends").then((m) => m.fetchRedditTrends(niche, log)).catch(() => []),
    ]);
    outlierTitles = outliers.slice(0, 10).map((o) => `${o.title} — ${o.score.toFixed(0)}x its channel size`);
    trendLines = reddit.slice(0, 10).map((t) => `[r/${t.subreddit}, ${t.score.toLocaleString()} upvotes] ${t.title}`);
  }

  log("topicOptimizer: signals", {
    done: doneSet.size,
    competitors: competitorTitles.length,
    outliers: outlierTitles.length,
    powerWords: powerWords.length,
    hasPerf: Boolean(perfCtx),
  });

  // ---- ask the Director to rank fresh, on-identity ideas ----
  if (hasAnthropicKey() || hasGeminiKey()) {
    const schema = z.object({
      topics: z.array(z.object({ topic: z.string(), rationale: z.string().optional() })).default([]),
    });
    // Anchor the model to TODAY — otherwise topics ship with stale years from
    // its training data ("…in 2024" on a 2026 channel) which reads as instant
    // staleness to viewers and to YouTube search.
    const today = new Date();
    const dateAnchor =
      `Today's date is ${today.toISOString().slice(0, 10)} (year ${today.getFullYear()}). ` +
      `If a topic references a year, use ${today.getFullYear()} (or none) — NEVER a past year.\n\n`;
    const prompt =
      dateAnchor +
      `Propose ${opts.count} NEW video topics for this channel.\n\n` +
      `CHANNEL IDENTITY (hard guardrail — every topic MUST fit this):\n` +
      `- niche: ${niche || "n/a"}\n- persona: ${opts.identity.persona || "n/a"}\n` +
      (opts.identity.topicPool?.length ? `- example on-brand topics: ${opts.identity.topicPool.slice(0, 12).join("; ")}\n` : "") +
      (opts.identity.bannedWords?.length ? `- NEVER use: ${opts.identity.bannedWords.join(", ")}\n` : "") +
      `\nDO NOT repeat anything already covered (normalized): ${[...doneSet].slice(0, 60).join(" | ") || "none yet"}\n` +
      (perfCtx ? `\nWHAT HAS WORKED (long-term analytics — lean toward these patterns):\n${perfCtx}\n` : "") +
      (outlierTitles.length ? `\nBREAKOUT / OUTLIER VIDEOS in this niche (massively overperforming vs their channel size — the strongest signal of what audiences want RIGHT NOW; steal the angle, not the exact title):\n${outlierTitles.join("\n")}\n` : "") +
      (trendLines.length ? `\nLIVE AUDIENCE DISCUSSIONS this week (Reddit — what the niche cares about BEFORE YouTube saturates it; mine for questions/anxieties/angles, never copy):\n${trendLines.join("\n")}\n` : "") +
      (competitorTitles.length ? `\nTOP COMPETITOR VIDEOS (proven demand / find gaps & better angles):\n${competitorTitles.join("\n")}\n` : "") +
      (powerWords.length ? `\nHIGH-CTR POWER WORDS for this niche: ${powerWords.join(", ")}\n` : "") +
      (titleTemplates.length ? `\nTITLE PATTERNS that rank here:\n${titleTemplates.join("\n")}\n` : "") +
      `\nReturn ${opts.count} DISTINCT, specific, genuinely interesting topics that (a) stay strictly within the ` +
      `channel identity, (b) are fresh vs the done list, (c) are weighted toward what the analytics + competitor ` +
      `signals show people want, and (d) each carry a one-line rationale. Return STRICT JSON ` +
      `{"topics":[{"topic":string,"rationale":string}]}.`;
    try {
      const out = await agentJson({
        role: "director",
        schema,
        log,
        maxTokens: 1200,
        temperature: 0.85,
        system:
          "You are the channel's content strategist. You optimize for long-term growth using real performance + " +
          "competitor + SEO signals, but you NEVER drift outside the channel's identity. Return ONLY JSON.",
        prompt,
      });
      const picks = (out.topics ?? [])
        .filter((t) => t && typeof t.topic === "string" && t.topic.trim().length > 3)
        .filter((t) => !doneSet.has(norm(t.topic)))
        .slice(0, opts.count);
      if (picks.length > 0) return picks;
    } catch (e) {
      log(`topicOptimizer: director failed (${e instanceof Error ? e.message : e}) — fallback`);
    }

    // single-model fallback
    if (hasGeminiKey()) {
      try {
        const out = await geminiJson<{ topics?: string[] }>({
          prompt:
            `${opts.count} fresh, specific video topics for a ${niche || "YouTube"} channel ` +
            `(persona: ${opts.identity.persona || "n/a"}), strictly on-brand, NOT repeating: ` +
            `${[...doneSet].slice(0, 40).join(" | ")}. Return STRICT JSON {"topics":string[]}.`,
          maxTokens: 600,
          temperature: 0.9,
        });
        const picks = (out.topics ?? [])
          .filter((t): t is string => typeof t === "string" && t.trim().length > 3)
          .filter((t) => !doneSet.has(norm(t)))
          .slice(0, opts.count)
          .map((topic) => ({ topic }));
        if (picks.length > 0) return picks;
      } catch {
        /* fall through */
      }
    }
  }

  // ---- deterministic fallback: topic pool minus done ----
  return (opts.identity.topicPool ?? [])
    .filter((t) => !doneSet.has(norm(t)))
    .slice(0, opts.count)
    .map((topic) => ({ topic }));
}
