/**
 * Output harness for the metadata module.
 *
 * The same principle that found three real defects in visual_inserts: run the
 * SHIPPING engine over real channels and real planned topics, then check every
 * field it produces against the constraints the platform and the module itself
 * claim to enforce. A unit test only contains the cases its author imagined;
 * this contains whatever the module actually does.
 *
 * REAL  the channels, their identities/niches/personas/languages, their planned
 *       topics, and craftMetadata itself — the same function the block calls.
 * NOT   the script. craftMetadata reads scriptExcerpt/coldOpen/hookLoop for
 *       grounding, and generating real ones would bill hookcraft per topic. The
 *       excerpt is left empty, which is also what the module sees on a channel
 *       whose pipeline has no script block — so this measures the weaker of the
 *       two grounding conditions, never a flattering one.
 *
 * Checks applied to every result:
 *   title        <=100 (YouTube hard limit), non-empty, no channel name
 *   description  <=5000, has a CTA, has keywords, has hashtags
 *   tags         count, effective character cost against YouTube's ~500 budget
 *   language     non-English channels must not receive English metadata
 *   lofi leak    only music niches may use lofi/study/relax framing
 *   judged       whether the feed judge actually ran, and its score
 */
import { readFileSync, writeFileSync } from "node:fs";

import { craftMetadata, lintTitle } from "@/lib/metacraft";
import { clampTags } from "@/lib/youtube";

interface Channel {
  _id: string;
  name?: string;
  identity?: { niche?: string; persona?: string; language?: string };
  pipeline?: { block?: string; params?: Record<string, unknown> }[];
}
interface Plan { channelId?: string; topic?: string }

const LOFI_LEAK = /\b(lo-?fi|study (beats|music)|beats to (relax|study)|chillhop)\b/i;
const MUSIC_NICHE = /lofi|lo-?fi|study|chill|ambient|sleep|relax|music|beats/i;

const effectiveTagCost = (tags: string[]): number =>
  tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0) + 1, 0);

function json<T>(path: string): T[] {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw.slice(raw.indexOf("["))) as T[];
}

interface Finding { channel: string; topic: string; issue: string }

async function main(): Promise<void> {
  const channels = json<Channel>("/tmp/ch.json");
  const plans = json<Plan>("/tmp/cp.json");
  const limit = Number(process.env.HARNESS_LIMIT ?? 4);

  // One topic per channel that runs the metadata block, preferring channels
  // that differ in niche and language so the sample is not four of one thing.
  const picks: { channel: Channel; topic: string }[] = [];
  const seenNiche = new Set<string>();
  for (const c of channels) {
    if (!(c.pipeline ?? []).some((e) => e.block === "metadata")) continue;
    const topic = plans.find((p) => p.channelId === c._id && p.topic)?.topic;
    if (!topic) continue;
    const key = `${c.identity?.niche ?? ""}|${c.identity?.language ?? "en"}`;
    if (seenNiche.has(key)) continue;
    seenNiche.add(key);
    picks.push({ channel: c, topic });
    if (picks.length >= limit) break;
  }
  console.log(`sampling ${picks.length} channels (one topic each, distinct niche/language)\n`);

  const findings: Finding[] = [];
  const results: unknown[] = [];

  for (const { channel, topic } of picks) {
    const niche = channel.identity?.niche ?? "";
    const language =
      (channel.pipeline ?? []).find((e) => e.block === "metadata")?.params?.["language"] as string | undefined;
    const label = `${channel.name} [${niche}${language && language !== "en" ? ` /${language}` : ""}]`;
    const note = (issue: string): void => { findings.push({ channel: channel.name ?? "?", topic, issue }); };

    let m;
    try {
      m = await craftMetadata({
        topic,
        channelName: channel.name ?? "",
        niche,
        persona: channel.identity?.persona ?? "",
        language,
        isMusicNiche: MUSIC_NICHE.test(niche),
        log: () => {},
      });
    } catch (e) {
      note(`craftMetadata THREW: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      console.log(`\n=== ${label}\n    THREW: ${e instanceof Error ? e.message.slice(0, 150) : e}`);
      continue;
    }

    const tagCost = effectiveTagCost(m.tags);
    const kept = clampTags(m.tags);
    console.log(`\n=== ${label}`);
    console.log(`    topic:  ${topic.slice(0, 90)}`);
    console.log(`    TITLE:  "${m.title}"  (${m.title.length} chars, frame=${m.frame}, ` +
      `${m.judged ? `click ${m.clickScore}/10` : "UNJUDGED"})`);
    console.log(`    ALT:    "${m.titleAlternate}"`);
    console.log(`    TAGS:   ${m.tags.length} tags, ${tagCost} effective chars, ${kept.length} survive upload`);
    console.log(`    DESC:   ${m.description.length} chars`);
    console.log(`    ${m.description.split("\n").filter(Boolean).slice(0, 3).map((l) => l.slice(0, 96)).join("\n    ")}`);
    console.log(`    PINNED: ${m.pinnedComment.slice(0, 96)}`);

    // ---- constraints ------------------------------------------------------
    if (!m.title.trim()) note("empty title");
    if (m.title.length > 100) note(`title ${m.title.length} chars exceeds YouTube's 100 limit`);
    if (channel.name && new RegExp(`\\b${channel.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.title)) {
      note("title contains the channel name");
    }
    if (!m.titleAlternate.trim()) note("no alternate title — the CTR swap loop has nothing to test against");
    if (m.titleAlternate.trim() && m.titleAlternate.trim() === m.title.trim()) note("alternate title is identical to the winner");
    if (!m.judged) note("title was never judged against the feed");

    if (m.description.length > 5000) note(`description ${m.description.length} chars exceeds YouTube's 5000 limit`);
    if (m.description.length < 120) note(`description only ${m.description.length} chars — too thin to rank`);
    if (!/subscribe/i.test(m.description)) note("description has no subscribe CTA");
    if (!/#\w/.test(m.description)) note("description has no hashtags");

    if (!m.tags.length) note("no tags");
    if (kept.length < m.tags.length) note(`${m.tags.length - kept.length} tags silently dropped at upload (${tagCost} effective chars)`);
    if (!m.pinnedComment.trim()) note("no pinned comment — the comment-seeding surface is empty");

    if (!MUSIC_NICHE.test(niche) && LOFI_LEAK.test(`${m.title} ${m.description}`)) {
      note("lofi/study framing leaked into a non-music channel");
    }
    // A non-English channel receiving ASCII-only metadata with English stopwords
    // is the module ignoring its language directive.
    if (language && language !== "en" && /\b(the|and|your|with|this|how)\b/i.test(m.title)) {
      note(`language is ${language} but the title reads as English: "${m.title}"`);
    }

    // The module's own gate, re-run on its own winner. grounding is the topic
    // alone here — the harness supplies no script — so a claim the title makes
    // that the topic cannot support is exactly what should surface.
    const lint = lintTitle(m.title, {
      grounding: topic,
      channelName: channel.name,
      isMusicNiche: MUSIC_NICHE.test(niche),
    });
    if (!lint.pass) note(`the module's OWN title lint rejects its winner: ${lint.issues.join("; ")}`);

    results.push({ channel: channel.name, topic, ...m });
  }

  writeFileSync("/tmp/metadata-harness-results.json", JSON.stringify(results, null, 2));
  console.log(`\n\n===== FINDINGS =====`);
  if (!findings.length) console.log("none — every field met every checked constraint");
  for (const f of findings) console.log(`  ${f.channel}: ${f.issue}`);
  console.log(`\n${findings.length} finding(s) across ${picks.length} channels`);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
