/**
 * Measures the titles this studio actually ships.
 *
 * The thumbnail work established that measurement beats assertion: the palette
 * and sameness guards only became credible once the drift was a number next to
 * the approved reference. The same question applies to titles — are they varied,
 * or is one shape repeating across a channel's whole slate? — and it is
 * answerable from the real content plan rather than by reading prompts.
 */
import { execFileSync } from "node:child_process";

interface PlanRow { title?: string; topic?: string; channelId?: string }

function load(): PlanRow[] {
  const out = execFileSync(
    "npx",
    ["convex", "data", "contentPlan", "--limit", "500", "--format", "json"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = out.indexOf("[");
  return JSON.parse(out.slice(start)) as PlanRow[];
}

function shape(title: string): string {
  const t = title.trim();
  const first = t.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  return first;
}

function main(): void {
  const rows = load().filter((r) => typeof r.title === "string" && r.title.trim());
  const byChannel = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.channelId ?? "unknown";
    byChannel.set(key, [...(byChannel.get(key) ?? []), row.title!.trim()]);
  }

  const all = rows.map((r) => r.title!.trim());
  const lens = all.map((t) => t.length).sort((a, b) => a - b);
  const withNumber = all.filter((t) => /\d/.test(t)).length;
  const openers = new Map<string, number>();
  for (const t of all) openers.set(shape(t), (openers.get(shape(t)) ?? 0) + 1);
  const topOpeners = [...openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  console.log(`titles analysed: ${all.length} across ${byChannel.size} channels\n`);
  console.log(`length  min=${lens[0]} p50=${lens[Math.floor(lens.length / 2)]} max=${lens[lens.length - 1]}`);
  console.log(`        in the 40-70 target band: ${all.filter((t) => t.length >= 40 && t.length <= 70).length}/${all.length}`);
  console.log(`contains a number: ${withNumber}/${all.length} (${Math.round((withNumber / all.length) * 100)}%)`);
  console.log(`\nmost common opening word (title shape concentration):`);
  for (const [word, n] of topOpeners) {
    console.log(`  ${String(n).padStart(3)}  ${(n / all.length * 100).toFixed(0).padStart(3)}%  "${word}"`);
  }

  console.log(`\nper-channel opener concentration (how much one shape dominates a slate):`);
  const rowsOut: { channel: string; n: number; top: string; share: number }[] = [];
  for (const [channel, titles] of byChannel) {
    if (titles.length < 4) continue;
    const counts = new Map<string, number>();
    for (const t of titles) counts.set(shape(t), (counts.get(shape(t)) ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    rowsOut.push({ channel: channel.slice(0, 10), n: titles.length, top, share: n / titles.length });
  }
  rowsOut.sort((a, b) => b.share - a.share);
  for (const r of rowsOut) {
    console.log(`  ${r.channel}  ${String(r.n).padStart(3)} titles  ${(r.share * 100).toFixed(0).padStart(3)}% start with "${r.top}"`);
  }

  console.log(`\nsample of the most repeated shape:`);
  const dominant = topOpeners[0][0];
  for (const t of all.filter((t) => shape(t) === dominant).slice(0, 8)) console.log(`  ${t}`);
}

main();
