// One refinement cycle: re-render the tournament winner's pattern with the
// judge's fixes applied (typography scale), then re-judge vs the same refs.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { renderCandidate, judgeTournament } from "../src/lib/thumbnailLab.ts";
import { readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://astute-camel-689.convex.cloud");
const channels = await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" });
const ch = channels.find((c) => c.name === "Investory");
const playbook = ch.thumbnailPlaybook;
if (!playbook) throw new Error("no playbook on channel");

const tmp = join(tmpdir(), "thumblab");
const refPaths = readdirSync(tmp).filter((f) => f.startsWith("ref_")).map((f) => join(tmp, f)).slice(0, 4);
const refs = refPaths.map((p) => ({ path: p, url: "", views: 0, craft: 8, why: "" }));
const title = process.env.TITLE ?? playbook.lastTournament?.title ?? "How Compound Returns Actually Work";
const winnerName = playbook.lastTournament?.winnerPattern ?? playbook.patterns[2]?.name;
const pattern = playbook.patterns.find((p) => p.name === winnerName) ?? playbook.patterns[0];
const log = (m) => console.log(`  [refine] ${m}`);

console.log(`refining winner pattern "${pattern.name}" for "${title}"`);
const out = join(tmp, "winner_refined.jpg");
await renderCandidate({ pattern, title, playbook, outJpg: out, tmpDir: tmp, idx: 9, log });
const verdict = await judgeTournament({ candidates: [{ path: out, pattern: pattern.name }], refs, title, tmpDir: tmp, log });
console.log(`refined score: ${verdict.candidates[0].clickScore}/10, beats ${verdict.candidates[0].beatsRefs} refs`);
console.log(`notes: ${verdict.candidates[0].notes}`);
copyFileSync(out, join(tmp, "winner.jpg"));
console.log(`saved: ${out}`);
