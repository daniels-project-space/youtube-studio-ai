/**
 * TOPICRAFT A/B — the legacy topic engine (verbatim pre-topicraft
 * optimizeTopics, scripts/ab/legacyTopicOptimizer.ts) vs the new golden
 * candidate craftTopics, side by side, on 5 synthetic channel identities.
 *
 * Both engines get identical Convex-side context (ownerId owner_daniel, a
 * non-existent channelId so history/plan degrade to empty exactly like a
 * fresh channel) and both live-fetch their own outlier/Reddit signals.
 *
 * Run on the VPS:   set -a; . .env.local; set +a; npx tsx scripts/topicraft-ab.ts
 * Output:           stdout + /tmp/topicraft-ab-report.md
 */
import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { craftTopics, type TopicBet } from "@/lib/topicraft";
import { optimizeTopicsLegacy } from "./ab/legacyTopicOptimizer";

const OWNER = "owner_daniel";
const FAKE_CHANNEL = "topicraft_ab_fake_channel";
const COUNT = 5;

interface AbChannel {
  label: string;
  channelName: string;
  niche: string;
  persona: string;
  topicPool: string[];
}

const CHANNELS: AbChannel[] = [
  {
    label: "Asian war history",
    channelName: "War Annals: East",
    niche: "asian war history",
    persona: "cinematic military historian of Asia — samurai, dynasties, steppe empires, naval sieges",
    topicPool: ["The Imjin War", "The Mongol invasions of Japan", "The Battle of Red Cliffs", "Sengoku Jidai power struggles"],
  },
  {
    label: "Film critique — Pirates of the Caribbean",
    channelName: "Cutaway Critique",
    niche: "film",
    persona: "film-literate critic dissecting the Pirates of the Caribbean franchise — craft, budgets, casting fights, the fall",
    topicPool: ["Curse of the Black Pearl's practical effects", "Why Davy Jones' CGI still holds up", "How the POTC franchise lost its way"],
  },
  {
    label: "General investment advice",
    channelName: "Plain Money",
    niche: "finance",
    persona: "calm, evidence-based investing teacher for ordinary people — no hype, no get-rich promises",
    topicPool: ["Index funds vs ETFs", "How compounding actually works", "The real cost of fund fees"],
  },
  {
    label: "Ancient history",
    channelName: "Antiquity Files",
    niche: "ancient history",
    persona: "master storyteller of the ancient world — Rome, Egypt, Mesopotamia — who keeps making the viewer smarter",
    topicPool: ["How Rome fed a million people", "The bronze age collapse", "Egypt's lost labyrinth"],
  },
  {
    label: "Stoic philosophy",
    channelName: "The Quiet Stoa",
    niche: "stoicism",
    persona: "quiet mentor applying stoic philosophy to one modern life at a time — restraint over preaching",
    topicPool: ["Marcus Aurelius on mornings you dread", "Seneca on wasted time", "The stoic response to being disliked"],
  },
];

const log = (m: string) => console.log(`  ${m}`);

function fmtBet(b: TopicBet): string {
  const s = b.scores ? ` (demand ${b.scores.demand} · fresh ${b.scores.freshness} · fit ${b.scores.fit} · pkg ${b.scores.packageability})` : "";
  return [
    `- **[${b.betType}] ${b.topic}**${s}`,
    `  - title: \`${b.provisionalTitle}\``,
    `  - hook: ${b.hookPromise}`,
    `  - thumb: ${b.thumbnailMoment}`,
    `  - evidence: ${b.evidence}`,
    `  - angle: ${b.angle}`,
  ].join("\n");
}

async function main() {
  await bootstrapSecrets((m) => console.log(`[bootstrap] ${m}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL missing");
  const convex = new ConvexHttpClient(url);

  const lines: string[] = [
    `# Topicraft A/B — legacy optimizeTopics vs craftTopics`,
    ``,
    `Run: ${new Date().toISOString()} · ${COUNT} topics per engine · identical identities, fresh-channel history.`,
    ``,
  ];

  const only = process.env.AB_ONLY?.toLowerCase();
  const channels = only ? CHANNELS.filter((c) => c.label.toLowerCase().includes(only)) : CHANNELS;

  for (const ch of channels) {
    console.log(`\n=== ${ch.label} ===`);
    lines.push(`## ${ch.label} — "${ch.channelName}" (${ch.niche})`, ``);

    // Shared Convex context for fairness (legacy reads these internally too).
    const [competitors, nicheIntel] = await Promise.all([
      convex.query(api.competitors.listCompetitors, { ownerId: OWNER, niche: ch.niche }).catch(() => []),
      convex.query(api.seo.getNiche, { ownerId: OWNER, niche: ch.niche }).catch(() => null),
    ]);
    const competitorTitles = (competitors as { topVideos?: { title: string; views: number }[] }[])
      .flatMap((c) => c.topVideos ?? [])
      .sort((a, b) => b.views - a.views)
      .slice(0, 12);
    const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
      .map((p) => p.word)
      .slice(0, 12);
    lines.push(`Convex databank: ${competitorTitles.length} competitor titles, ${powerWords.length} power words.`, ``);

    // OLD ENGINE
    console.log(`--- OLD (legacy optimizeTopics) ---`);
    let oldMs = 0;
    let oldOut: { topic: string; rationale?: string }[] = [];
    let oldErr = "";
    {
      const t0 = Date.now();
      try {
        oldOut = await optimizeTopicsLegacy({
          convex,
          ownerId: OWNER,
          channelId: FAKE_CHANNEL,
          keyPrefix: "abtest/none/",
          count: COUNT,
          identity: { niche: ch.niche, persona: ch.persona, topicPool: ch.topicPool },
          log: (m) => log(`old: ${m}`),
        });
      } catch (e) {
        oldErr = e instanceof Error ? e.message : String(e);
      }
      oldMs = Date.now() - t0;
    }

    // NEW ENGINE
    console.log(`--- NEW (topicraft craftTopics) ---`);
    let newMs = 0;
    let newBets: TopicBet[] = [];
    let newBench = 0;
    let newErr = "";
    let evidenceLine = "";
    {
      const t0 = Date.now();
      try {
        const crafted = await craftTopics({
          channelName: ch.channelName,
          niche: ch.niche,
          persona: ch.persona,
          topicPool: ch.topicPool,
          count: COUNT,
          avoid: [],
          competitorTitles,
          powerWords,
          log: (m) => log(`new: ${m}`),
        });
        newBets = crafted.bets;
        newBench = crafted.bench.length;
        evidenceLine =
          `${crafted.evidence.outliers.length} outliers · ${crafted.evidence.trends.length} reddit · ` +
          `${crafted.evidence.suggests.length} search queries · ${crafted.evidence.competitors.length} competitor titles`;
      } catch (e) {
        newErr = e instanceof Error ? e.message : String(e);
      }
      newMs = Date.now() - t0;
    }

    lines.push(`### OLD — legacy optimizeTopics (${(oldMs / 1000).toFixed(1)}s)`, ``);
    if (oldErr) lines.push(`**FAILED:** ${oldErr}`, ``);
    else if (oldOut.length === 0) lines.push(`(returned nothing)`, ``);
    else lines.push(...oldOut.map((t) => `- **${t.topic}**${t.rationale ? `\n  - rationale: ${t.rationale}` : ""}`), ``);

    lines.push(`### NEW — topicraft (${(newMs / 1000).toFixed(1)}s · evidence: ${evidenceLine || "n/a"} · bench +${newBench})`, ``);
    if (newErr) lines.push(`**FAILED:** ${newErr}`, ``);
    else lines.push(...newBets.map(fmtBet), ``);
  }

  const report = lines.join("\n");
  writeFileSync(only ? `/tmp/topicraft-ab-report-${only.replace(/\W+/g, "_")}.md` : "/tmp/topicraft-ab-report.md", report);
  console.log(`\n\nreport → /tmp/topicraft-ab-report.md (${report.length} chars)`);
}

main().catch((e) => {
  console.error("A/B failed:", e);
  process.exit(1);
});
