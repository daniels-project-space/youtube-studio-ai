/**
 * Before/after harness for the title module.
 *
 * Runs the real engine over real channels and real planned topics, so a change
 * to the module is judged on its output rather than on how its prompt reads.
 * Three columns matter:
 *
 *   SHIPPED TODAY  the contentPlan title — on the planned path this overrides
 *                  whatever metacraft produces, so it is what viewers see
 *   METACRAFT      what the engine actually produces for the same topic
 *   lint/judge     whether that title clears the module's own gates
 *
 * Deliberately reuses the pipeline's own inputs. Feeding it a tidied-up brief
 * would measure the brief, not the module.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { bootstrapSecrets } from "@/lib/bootstrap";
import { craftMetadata, lintTitle } from "@/lib/metacraft";

interface Channel {
  _id: string;
  name?: string;
  identity?: { niche?: string; persona?: string; topicPool?: string[] };
}
interface Plan {
  channelId?: string;
  title?: string;
  topic?: string;
  description?: string;
  sceneSeed?: string;
}

function data<T>(table: string, limit: number): T[] {
  const out = execFileSync(
    "npx",
    ["convex", "data", table, "--limit", String(limit), "--format", "json"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out.slice(out.indexOf("["))) as T[];
}

/** One planned item per channel, so the sample spans niches instead of a slate. */
function sample(count: number): { channel: Channel; plan: Plan }[] {
  const channels = new Map(data<Channel>("channels", 60).map((c) => [c._id, c]));
  const seen = new Set<string>();
  const picked: { channel: Channel; plan: Plan }[] = [];
  for (const plan of data<Plan>("contentPlan", 500)) {
    const channel = plan.channelId ? channels.get(plan.channelId) : undefined;
    if (!channel || !plan.title || !plan.topic) continue;
    if (channel.name === "Phase 1 Smoke Channel") continue; // fixture, not a real channel
    if (seen.has(channel._id)) continue;
    seen.add(channel._id);
    picked.push({ channel, plan });
    if (picked.length >= count) break;
  }
  return picked;
}

async function main(): Promise<void> {
  await bootstrapSecrets(() => {});
  const label = process.argv[2] ?? "before";
  const count = Number(process.argv[3] ?? 5);
  const only = process.argv[4];
  const picked = sample(count).filter(
    (p) => !only || (p.channel.name ?? "").toLowerCase().includes(only.toLowerCase()),
  );
  const results: Record<string, unknown>[] = [];

  for (const { channel, plan } of picked) {
    const name = channel.name ?? "";
    const niche = channel.identity?.niche ?? "";
    // The planned path has no script yet, so the topic, the plan blurb and the
    // scene seed are genuinely all the grounding that exists at this point.
    const grounding = [plan.topic, plan.description, plan.sceneSeed].filter(Boolean).join("\n");
    process.stdout.write(`\n=== ${name} · ${niche}\n    topic: ${plan.topic}\n`);
    const shipped = plan.title!.trim();
    const shippedLint = lintTitle(shipped, { grounding, channelName: name });
    console.log(`    SHIPPED TODAY (${shipped.length}) ${shipped}`);
    console.log(`      lint: ${shippedLint.pass ? "pass" : shippedLint.issues.join("; ")}`);

    try {
      const m = await craftMetadata({
        topic: plan.topic!,
        channelName: name,
        niche,
        persona: channel.identity?.persona,
        scriptExcerpt: plan.description,
        coldOpen: plan.sceneSeed,
        hookLoop: plan.description,
        // The pipeline passes this; without it the lofi lint rejects the only
        // on-brand framing a music channel has, which would make the harness
        // report a module failure that production never sees.
        isMusicNiche: /lo-?fi|music|ambien|beats/i.test(`${niche} ${channel.identity?.persona ?? ""}`),
        log: () => {},
      });
      const lint = lintTitle(m.title, { grounding, channelName: name });
      console.log(`    METACRAFT     (${m.title.length}) ${m.title}`);
      console.log(`      frame=${m.frame} click=${m.clickScore}/10 alt="${m.titleAlternate}"`);
      console.log(`      lint: ${lint.pass ? "pass" : lint.issues.join("; ")}`);
      results.push({
        channel: name, niche, topic: plan.topic, shipped,
        crafted: m.title, frame: m.frame, clickScore: m.clickScore, alternate: m.titleAlternate,
      });
    } catch (error) {
      console.log(`    METACRAFT     FAILED: ${error instanceof Error ? error.message : error}`);
      results.push({ channel: name, niche, topic: plan.topic, shipped, error: String(error) });
    }
  }

  writeFileSync(`/tmp/title-ab-${label}.json`, JSON.stringify(results, null, 2));
  console.log(`\nwrote /tmp/title-ab-${label}.json (${results.length} rows)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
