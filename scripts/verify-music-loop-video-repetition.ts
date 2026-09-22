import { writeFile } from "node:fs/promises";
import { verifyMusicLoopVideoRepetition } from "../src/lib/musicLoopVideoRepetition";

async function main() {
  const [master, duration, receipt] = process.argv.slice(2);
  if (!master || !duration) throw new Error("Usage: verify-music-loop-video-repetition.ts MASTER.mp4 DURATION_SECONDS [RECEIPT.json]");
  const result = await verifyMusicLoopVideoRepetition(master, Number(duration));
  if (receipt) await writeFile(receipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
