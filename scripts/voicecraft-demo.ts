/**
 * VOICECRAFT DEMO — before/after narration for the example channels.
 *
 *   BEFORE = the current production path: Fish Audio, niche voice-map
 *            default, native speed, audio tags stripped.
 *   AFTER  = voicecraft: profiled bank → archetype casting law → judged cast
 *            → ElevenLabs v3 with narration physics (speed / stability /
 *            style / performed tags), then the take judged by Gemini's ears.
 *
 * Also profiles the operator's full ElevenLabs bank into Convex (free —
 * preview audio) as the persistent voice-card source.
 *
 * Run on the VPS:  set -a; . .env.local; set +a; npx tsx scripts/voicecraft-demo.ts
 * Output:          /tmp/voicecraft-demo/<channel>_{before|after}.mp3 + report.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthNarration, stripAudioTags } from "@/lib/tts";
import {
  profileVoiceBank,
  castVoice,
  renderNarration,
  judgeNarrationTake,
  type CastResult,
} from "@/lib/voicecraft";

const OWNER = "owner_daniel";
const OUT = "/tmp/voicecraft-demo";

interface DemoChannel {
  slug: string;
  label: string;
  channelName: string;
  niche: string;
  persona: string;
  /** ~30s script in the archetype's register, with its v3 tag palette. */
  script: string;
}

const CHANNELS: DemoChannel[] = [
  {
    slug: "stoic",
    label: "Stoic philosophy",
    channelName: "The Quiet Stoa",
    niche: "stoicism",
    persona: "quiet mentor applying stoic philosophy to one modern life at a time",
    script:
      "You already know the morning will be hard. [pause] Marcus Aurelius knew it too. At dawn, he wrote a note to " +
      "himself — when you struggle to rise, remember what you are getting up for. [long pause] The work of being " +
      "human. Not comfort. Not applause. [pause] Today you will meet resistance. Meet it the way he did — quietly, " +
      "deliberately, without complaint. [pause] Begin anyway. That is the whole practice.",
  },
  {
    slug: "finance",
    label: "Investment advice",
    channelName: "Plain Money",
    niche: "finance",
    persona: "calm, evidence-based investing teacher for ordinary people",
    script:
      "Here is the number nobody shows you. A one percent fee sounds tiny — but over thirty years it quietly eats " +
      "almost a third of your portfolio. [pause] Not because of math tricks. Because compounding starts working " +
      "against you instead of for you. Today I will show you exactly how that drain works, [emphatic] and the " +
      "three-minute check that tells you what your funds actually cost. Real numbers. No hype. No predictions.",
  },
  {
    slug: "social",
    label: "Social media commentary",
    channelName: "Spotlight Rot",
    niche: "social media commentary",
    persona: "receipts-true chaos commentator on internet meltdowns",
    script:
      "[appalled] Sixty paparazzi got a text message before SHE did. [pause] That is not a leak — that is a " +
      "marketing calendar. [sarcastic] And the apology video? Filmed before the scandal even broke. [laughs] You " +
      "cannot make this up. The receipts are time-stamped, the metadata is public, and the whole meltdown was " +
      "scheduled like a product launch. [exhales] Let me walk you through the timeline — because every public " +
      "downfall is a manufactured extraction.",
  },
  {
    slug: "meditation",
    label: "Meditation / gratitude",
    channelName: "Seven Quiet Days",
    niche: "meditation",
    persona: "a calm daily gratitude practice, one minute at a time",
    script:
      "[softly] Welcome back. [long pause] Before the day asks anything of you, take this one minute and let it be " +
      "yours. [inhales deeply] [exhales] Feel the weight of your body, exactly where it rests. [pause] Today we " +
      "practice gratitude for one small thing — the first warm sip, the quiet of this room. [long pause] Let it be " +
      "enough. [softly] Stay here as long as you like.",
  },
  {
    slug: "history",
    label: "Asian war history",
    channelName: "War Annals: East",
    niche: "asian war history",
    persona: "cinematic military historian of Asia",
    script:
      "November, fifteen ninety-seven. [pause] Thirteen Korean warships face more than a hundred Japanese vessels " +
      "in the Myeongnyang strait. [pause] Admiral Yi Sun-sin knows something the enemy does not — the tide here " +
      "turns like a trap. [thoughtful] By the end of this video you will understand exactly how thirteen ships beat " +
      "a fleet. Not with courage alone — with current, geography, and nerve. [pause] This is the battle that saved " +
      "a kingdom.",
  },
];

const log = (m: string) => console.log(`  ${m}`);

async function main() {
  await bootstrapSecrets((m) => console.log(`[bootstrap] ${m}`));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL missing");
  const convex = new ConvexHttpClient(url);
  mkdirSync(OUT, { recursive: true });

  // 1. Profile the operator's full bank (free — preview audio) into Convex.
  console.log("\n=== PROFILING THE VOICE BANK ===");
  const cards = await profileVoiceBank({ convex, ownerId: OWNER, log });
  console.log(`bank ready: ${cards.length} profiled voices`);

  const lines: string[] = [
    `# Voicecraft demo — before (current Fish path) vs after (cast + physics)`,
    ``,
    `Bank: ${cards.length} profiled voices. Run: ${new Date().toISOString()}`,
    ``,
  ];

  const only = process.env.DEMO_ONLY?.toLowerCase();
  const channels = only ? CHANNELS.filter((c) => c.slug.includes(only)) : CHANNELS;

  for (const ch of channels) {
    console.log(`\n=== ${ch.label} (${ch.channelName}) ===`);
    lines.push(`## ${ch.label} — "${ch.channelName}" (${ch.niche})`, ``);

    // BEFORE — exact current production defaults (Fish, tags stripped, native pace).
    try {
      const before = await synthNarration({ text: stripAudioTags(ch.script), niche: ch.niche, speed: 1 });
      writeFileSync(join(OUT, `${ch.slug}_before.mp3`), Buffer.from(before));
      log(`BEFORE rendered (${(before.length / 1024).toFixed(0)} KB, Fish niche default)`);
      lines.push(`- BEFORE: Fish niche-map default voice, native pace, tags stripped.`);
    } catch (e) {
      log(`BEFORE failed: ${e instanceof Error ? e.message : e}`);
      lines.push(`- BEFORE: FAILED — ${e instanceof Error ? e.message : e}`);
    }

    // AFTER — voicecraft cast + physics + judged take.
    try {
      const cast: CastResult = await castVoice({
        convex,
        ownerId: OWNER,
        channelName: ch.channelName,
        niche: ch.niche,
        persona: ch.persona,
        log,
      });
      const after = await renderNarration({
        text: ch.script,
        elevenVoiceId: cast.voiceId,
        physics: cast.physics,
      });
      writeFileSync(join(OUT, `${ch.slug}_after.mp3`), Buffer.from(after));
      const verdict = await judgeNarrationTake({ mp3: after, physics: cast.physics, text: ch.script, log });
      log(`AFTER rendered (${(after.length / 1024).toFixed(0)} KB) — ${cast.name}, ${cast.physics.speed}x, stability ${cast.physics.stability}`);
      lines.push(
        `- AFTER: **${cast.name}** (cast ${cast.score}/10 — ${cast.why})`,
        `  - physics: ${cast.physics.speed}x speed · stability ${cast.physics.stability}${cast.physics.style ? ` · style ${cast.physics.style}` : ""} · tags ${cast.physics.tagDensity} · archetype ${cast.physics.archetype}`,
        `  - auditioned: ${cast.auditioned.map((a) => `${a.name.split(" - ")[0]} ${a.score}`).join(" · ")}`,
        `  - take judge: register ${verdict.register} · pace ${verdict.pace} · performance ${verdict.performance} · clean ${verdict.clean}${verdict.pass ? " — PASS" : ` — FAIL (${verdict.why})`}`,
      );
    } catch (e) {
      log(`AFTER failed: ${e instanceof Error ? e.message : e}`);
      lines.push(`- AFTER: FAILED — ${e instanceof Error ? e.message : e}`);
    }
    lines.push(``);
  }

  writeFileSync(join(OUT, only ? `report-${only}.md` : "report.md"), lines.join("\n"));
  console.log(`\nreport → ${OUT}/report${only ? `-${only}` : ""}.md`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
