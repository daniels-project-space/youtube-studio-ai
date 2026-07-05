/**
 * One-shot repair of the 4 validation channel rows after the probe-round
 * fixes: regenerate the FLOOR pipeline with the fixed designer (length law,
 * policy gates, targetSeconds, music-before-scribe), re-apply the few
 * inception customizations worth keeping (cast voice, meditation pacing),
 * and repair the lofi/comic Style-DNA drift the assessors documented.
 */
import { config } from "dotenv"; config({ path: ".env.local" });
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { designPipeline } from "../../src/engine/designer";
import type { PipelineEntry } from "../../src/engine/types";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
const log = (m: string) => console.log(`[repair] ${m}`);

function mergeParams(pipe: PipelineEntry[], block: string, params: Record<string, unknown>): void {
  const e = pipe.find((x) => x.block === block);
  if (e) e.params = { ...(e.params ?? {}), ...params };
}

async function repair(channelId: string, fix: (ch: Record<string, any>) => { pipeline?: PipelineEntry[]; styleDNA?: unknown; identity?: unknown; qaRubric?: unknown }) {
  const ch = await convex.query(api.channels.getChannel, { channelId: channelId as Id<"channels"> });
  if (!ch) throw new Error("missing " + channelId);
  const patch = fix(ch as Record<string, any>);
  await convex.mutation(api.channels.updateChannel, { channelId: channelId as Id<"channels">, ...(patch as object) });
  log(`${(ch as any).slug}: repaired (${Object.keys(patch).join(", ")})`);
}

async function main() {
// WHITEBOARD — fresh floor (targetSeconds 180, music before scribe, gates)
await repair("j973233pdy3wbvs55jq1d4nsas89xraz", () => {
  const d = designPipeline({ family: "whiteboard", nicheKey: "finance", lengthMinutes: 3, publishMode: "draft", toggles: { shorts: false, crosspost: false } });
  return { pipeline: d.pipeline };
});

// COMIC — fresh floor + DNA motion-vocab repair (renderer-real vocabulary)
await repair("j97btry53hv0y363bwq6w69yx989wqr0", (ch) => {
  const d = designPipeline({ family: "comic", nicheKey: "history", lengthMinutes: 3, publishMode: "draft", toggles: { shorts: false, crosspost: false } });
  const dna = JSON.parse(JSON.stringify(ch.styleDNA ?? {}));
  const fixStr = (s: unknown) => typeof s === "string"
    ? s.replace(/papercraft|paper-craft|diorama/gi, "inked comic-book").replace(/parallax( layers?)?/gi, "3D page camera moves").replace(/breathing cutouts?/gi, "hand-drawn panel reveals").replace(/torn-paper transitions?/gi, "page turns")
    : s;
  for (const k of ["setting", "visualLanguage", "colorGrade", "motionLanguage", "transitions"]) if (k in dna) dna[k] = fixStr(dna[k]);
  if (Array.isArray(dna.motifs)) dna.motifs = dna.motifs.map(fixStr);
  // topicPool: drop research-query fragments + near-dupes
  const identity = JSON.parse(JSON.stringify(ch.identity ?? {}));
  const seen = new Set<string>();
  identity.topicPool = (identity.topicPool ?? []).filter((t: string) => {
    const k = t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (seen.has(k) || /channel style|deep dive|documentary style|youtube/i.test(t)) return false;
    seen.add(k); return true;
  }).slice(0, 20);
  return { pipeline: d.pipeline, styleDNA: dna, identity };
});

// LOFI — fresh floor + DNA world repair (persona is canon: neon penthouse) + bannedWords lint
await repair("j9734c02jsjc5d04ta5ax9g43n89wxwv", (ch) => {
  const d = designPipeline({ family: "music_loop", nicheKey: "lofi", lengthMinutes: 3, publishMode: "draft", toggles: { shorts: false, crosspost: false } });
  const dna = JSON.parse(JSON.stringify(ch.styleDNA ?? {}));
  dna.setting = "A luxurious penthouse apartment high above a neon-lit city at night — floor-to-ceiling windows streaked with rain, warm lamplight inside, the city glowing far below";
  dna.recurringSubject = "The rain-streaked floor-to-ceiling window wall of a neon-lit luxury penthouse, warm interior lamplight against the cold city glow";
  if (Array.isArray(dna.motifs)) dna.motifs = ["rain streaking tall windows", "neon city glow far below", "warm interior lamplight", "steam rising from a mug on a designer table", "distant aircraft lights"];
  if (dna.groundingGaps && Array.isArray(dna.groundingGaps)) dna.groundingGaps.push("2026-07-05 repair: setting re-anchored to the operator persona (was cafe drift from off-niche research)");
  const identity = JSON.parse(JSON.stringify(ch.identity ?? {}));
  const selfText = [ch.name, identity.persona, (identity.topicPool ?? []).join(" ")].join(" ").toLowerCase();
  identity.bannedWords = (identity.bannedWords ?? []).filter((w: string) => !selfText.includes(w.toLowerCase()));
  // qaRubric: re-anchor any cafe wording to the penthouse world
  const rub = JSON.parse(JSON.stringify(ch.qaRubric ?? null));
  const rubStr = JSON.stringify(rub ?? {}).replace(/café|cafe/gi, "penthouse").replace(/coffee shop/gi, "penthouse living room");
  return { pipeline: d.pipeline, styleDNA: dna, identity, ...(rub ? { qaRubric: JSON.parse(rubStr) } : {}) };
});

// MEDITATION — fresh floor + keep the cast ElevenLabs voice + slow pacing
await repair("j97eadtp9nnhj5v2q7e6c93b2989w9gb", (ch) => {
  const d = designPipeline({ family: "sleep", lengthMinutes: 3, publishMode: "draft", seriesTitle: "7 Days of Gratitude", seriesCount: 7, toggles: { shorts: false, crosspost: false } });
  const castId = ch.identity?.voiceCasting?.voiceId as string | undefined;
  mergeParams(d.pipeline, "script_gen", { sentenceGapSec: 1.8, voiceTags: true });
  mergeParams(d.pipeline, "narration_tts", { sentenceGapSec: 1.8, ttsSpeed: 0.88, ...(castId ? { ttsProvider: "elevenlabs", elevenVoiceId: castId } : {}) });
  return { pipeline: d.pipeline };
});

log("all 4 repaired");
}
main().catch((e) => { console.error(e); process.exit(1); });
