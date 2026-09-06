/**
 * Does the topic bet's provisional title deserve a seat in the title pool?
 *
 * topic_select writes `provisionalTitle` — a judge-linted 40-70 character title
 * produced with the full topic evidence in hand — and its own comment says the
 * bet's fields "are judged warm starts for metacraft, banana and hookcraft
 * downstream". metadata passed only the SCHEDULED plan's title as a warm start,
 * so on the unscheduled path the bet title was written, judged, logged and
 * thrown away.
 *
 * Adding it is cheap and safe by construction — it enters the pool under its own
 * frame and only wins if the lint and the CTR judge prefer it — but "safe" is
 * not "worth doing". This measures whether it is worth doing, on the real
 * metacraft: same topic, same evidence, same judge, run with and without.
 *
 * The three outcomes and what each would mean:
 *
 *   the bet title WINS sometimes      it was supplying titles the generator did
 *                                     not produce, and discarding it cost those
 *   it never wins but never harms     harmless; the pool is one candidate wider
 *   the winner gets WORSE with it     it is crowding out better candidates and
 *                                     the change should be reverted
 *
 * REAL: craftTopics (the shipping topic bettor, so the provisional titles are
 * genuine judged output, not invented), craftMetadata, its lint, and its CTR
 * judge. Nothing here is a reimplementation.
 *
 * Usage:
 *   ai-vault openrouter OPENROUTER_API_KEY=OPENROUTER_API_KEY -- \
 *     ./node_modules/.bin/tsx scripts/metacraft-bet-title-value.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { craftMetadata } from "@/lib/metacraft";
import { craftTopics, type TopicBet } from "@/lib/topicraft";

const CACHE = "/tmp/metacraft-bet-titles.json";

interface Case {
  readonly channelName: string;
  readonly niche: string;
  readonly persona: string;
}

/** Four live channel voices, so one niche's habits cannot carry the result. */
const CASES: readonly Case[] = [
  { channelName: "Lorecraft", niche: "folklore and local legend", persona: "hushed, unhurried folklore reader" },
  { channelName: "Casefile", niche: "unsolved cases, evidence-led", persona: "cold, procedural narrator" },
  { channelName: "How It Holds", niche: "civil engineering explained", persona: "bright, brisk, curious" },
  { channelName: "Stoic Truths", niche: "practical ancient philosophy", persona: "steady, grounded, adult" },
];

async function bets(): Promise<Array<{ channel: Case; bet: TopicBet }>> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8")) as Array<{ channel: Case; bet: TopicBet }>;
  const out: Array<{ channel: Case; bet: TopicBet }> = [];
  for (const channel of CASES) {
    const { bets: slate } = await craftTopics({
      channelName: channel.channelName,
      niche: channel.niche,
      persona: channel.persona,
      count: 2,
      avoid: [],
      log: (m) => console.log(`    [topicraft] ${m}`),
    });
    for (const bet of slate.slice(0, 2)) out.push({ channel, bet });
    console.log(`  ${channel.channelName}: ${slate.length} bets`);
  }
  writeFileSync(CACHE, JSON.stringify(out, null, 2));
  return out;
}

interface Row {
  channel: string;
  topic: string;
  betTitle: string;
  withoutTitle: string;
  withTitle: string;
  betTitleWon: boolean;
  changed: boolean;
  /** Two identical runs disagreeing — the noise floor this must be read against. */
  controlChanged: boolean;
}

async function main(): Promise<void> {
  const slate = await bets();
  if (!slate.length) {
    console.log("no bets — cannot measure. (Is OPENROUTER_API_KEY injected?)");
    return;
  }

  const rows: Row[] = [];
  for (const { channel, bet } of slate) {
    const common = {
      topic: bet.topic,
      channelName: channel.channelName,
      niche: channel.niche,
      persona: channel.persona,
      log: () => {},
    };
    // Same topic, same evidence, same judge — the ONLY difference is whether the
    // bet's provisional title is allowed to compete.
    // A SECOND control run with identical inputs. craftMetadata generates at
    // temperature 0.8, so two identical calls do not agree — without this the
    // "winner changed" column measures sampling noise and reads like an effect.
    const without = await craftMetadata({ ...common });
    const controlB = await craftMetadata({ ...common });
    const with_ = await craftMetadata({ ...common, betTitle: bet.provisionalTitle });
    const betTitleWon = with_.title.trim() === bet.provisionalTitle.trim();
    rows.push({
      channel: channel.channelName,
      topic: bet.topic,
      betTitle: bet.provisionalTitle,
      withoutTitle: without.title,
      withTitle: with_.title,
      betTitleWon,
      changed: without.title.trim() !== with_.title.trim(),
      controlChanged: without.title.trim() !== controlB.title.trim(),
    });
    console.log(
      `\n${channel.channelName} — "${bet.topic.slice(0, 60)}"\n` +
        `  bet title : ${bet.provisionalTitle}\n` +
        `  without   : ${without.title}\n` +
        `  control   : ${controlB.title}${without.title.trim() !== controlB.title.trim() ? "   (differs from without — noise)" : ""}\n` +
        `  with      : ${with_.title}${betTitleWon ? "   <- the bet title won" : ""}`,
    );
  }

  const won = rows.filter((r) => r.betTitleWon).length;
  const changed = rows.filter((r) => r.changed).length;
  const noise = rows.filter((r) => r.controlChanged).length;
  console.log(
    `\n=== ${rows.length} videos ===\n` +
      `  bet title won outright        : ${won}\n` +
      `  winner changed WITH the bet   : ${changed}\n` +
      `  winner changed between two\n` +
      `  IDENTICAL control runs        : ${noise}   <- the noise floor`,
  );
  console.log(
    `\nReading: ONLY the outright-win column is causal. "Winner changed" must be read\n` +
      `against the control column beside it — craftMetadata generates at temperature\n` +
      `0.8, so two identical calls disagree, and an earlier version of this harness\n` +
      `reported 7/7 changed as though the bet title had caused it.\n\n` +
      `A win means the bet title was supplying something the generator did not, and\n` +
      `discarding it cost exactly that. Harm is structurally bounded: the title only\n` +
      `wins by passing the same lint and being ranked highest by the same judge as\n` +
      `every other candidate.`,
  );
  writeFileSync("/tmp/metacraft-bet-title-value.json", JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
