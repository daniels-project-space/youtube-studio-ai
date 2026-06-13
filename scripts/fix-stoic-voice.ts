/**
 * Evict the low-quality "Deep American Male Accent" add (operator verdict:
 * bad audio) from the account + bank, then RECRUIT a replacement through the
 * full quality gates (professional + popular + preview fit/quality ≥8 +
 * post-add validation on our own render).
 *
 * Run:  set -a; . .env.local; set +a; npx tsx scripts/fix-stoic-voice.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { recruitVoice, removeAccountVoice, NARRATION_PHYSICS } from "@/lib/voicecraft";

const OWNER = "owner_daniel";
const BAD_VOICE_ID = "AdaGJw8VJvTzPhmdAI4F"; // "Deep American Male Accent" — low quality

async function main() {
  await bootstrapSecrets();
  const convex = new ConvexHttpClient((process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL)!);
  const log = (m: string) => console.log(`  ${m}`);

  // 1. Evict.
  await removeAccountVoice(BAD_VOICE_ID).catch((e) => log(`account removal: ${e instanceof Error ? e.message : e}`));
  const hadRow = await convex.mutation(api.voiceBank.deleteProfile, { ownerId: OWNER, voiceId: BAD_VOICE_ID });
  console.log(`evicted ${BAD_VOICE_ID} (bank row existed: ${hadRow})`);

  // 2. Recruit through the quality gates.
  const physics = { ...NARRATION_PHYSICS["quiet-mentor"], archetype: "quiet-mentor" };
  const card = await recruitVoice({
    convex,
    ownerId: OWNER,
    physics,
    searchTerms: ["deep narrator", "deep calm"],
    log,
  });
  console.log(`RECRUITED: ${card.name} (${card.voiceId}) — ${card.profile.character}`);
}

main().catch((e) => {
  console.error("fix failed:", e);
  process.exit(1);
});
