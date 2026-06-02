import { hydrateEnv } from "@/lib/vault";
import { embedText, cosine } from "@/lib/embeddings";

async function main() {
  if (!process.env.GEMINI_API_KEY) await hydrateEnv("gemini");
  const a = "Seneca practiced voluntary hardship, sleeping on hard floors and eating simply to rehearse loss and free himself from the fear of poverty.";
  const aDup = "Seneca deliberately endured discomfort — hard beds and plain food — to practice losing everything, so that fortune could never frighten him with poverty.";
  const b = "Marcus Aurelius wrote Meditations as private notes to himself, reminders to stay just and rational while ruling an empire.";
  const [va, vad, vb] = await Promise.all([embedText(a), embedText(aDup), embedText(b)]);
  const simDup = cosine(va, vad);
  const simDiff = cosine(va, vb);
  console.log(`dim: ${va.length}`);
  console.log(`cosine(A, near-duplicate) = ${simDup.toFixed(3)}`);
  console.log(`cosine(A, different)      = ${simDiff.toFixed(3)}`);
  const ok = simDup > simDiff && simDup > 0.8;
  console.log(ok ? "\nDEDUP SIGNAL PASSED (duplicates score higher; threshold-able)" : "\nDEDUP SIGNAL WEAK");
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
