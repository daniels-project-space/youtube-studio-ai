/**
 * Paid, read-only comparison on frozen retained narration and current identity.
 * Not a replay of historical model requests and not an audience/CTR experiment.
 * Run only with the scoped OpenRouter vault key; no YouTube or Convex writes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { craftMetadata, resolveTitleProfile } from "../src/lib/metacraft";
import { createModelUsageScope } from "../src/lib/modelUsage";

async function main() {
  const [mode, outputDir] = process.argv.slice(2);
  if (!['before', 'after'].includes(mode) || !outputDir?.startsWith('/tmp/')) {
    throw new Error('Usage: title-source-comparison.ts before|after /tmp/<new-evidence-directory>');
  }
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Scoped OpenRouter key required');
  mkdirSync(outputDir, { recursive: false });
  const manifest = JSON.parse(readFileSync('test-fixtures/title-baseline/manifest.json', 'utf8'));
  const selected = [0, 1, 2, 4];
  const realFetch = globalThis.fetch;
  let stopped = false;
  let paidCalls = 0;
  let reportedCost = 0;
  const transport: unknown[] = [];
  const results: unknown[] = [];
  const save = () => writeFileSync(join(outputDir, 'evidence.json'), JSON.stringify({
    mode, purpose: 'Saved-narration current-identity experiment; frozen competitors, no autocomplete',
    paidCalls, reportedCost, stopped, results, transport,
  }, null, 2));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://suggestqueries.google.com/')) return Response.json(['', []]);
    if (url !== 'https://openrouter.ai/api/v1/chat/completions') {
      throw new Error(`Comparison prohibits network request: ${new URL(url).origin}`);
    }
    // The cap covers this bounded corpus/unchanged 2500-token generation ceiling.
    // Missing/ambiguous billing closes the harness before any further purchase.
    if (stopped || paidCalls >= 24 || reportedCost >= 0.70) throw new Error('Comparison spend/receipt stop');
    paidCalls++;
    const request = JSON.parse(String(init?.body));
    const start = Date.now();
    try {
      const response = await realFetch(input, init);
      const raw = await response.clone().text();
      const parsed = JSON.parse(raw);
      const charge = parsed.usage?.cost;
      if (!response.ok || typeof charge !== 'number' || !Number.isFinite(charge) || charge < 0) stopped = true;
      else reportedCost += charge;
      transport.push({ request, response: parsed, status: response.status, elapsedMs: Date.now() - start });
      save();
      return response;
    } catch (error) {
      stopped = true;
      transport.push({ request, error: error instanceof Error ? error.message : String(error) });
      save();
      throw error;
    }
  };
  try {
    for (const index of selected) {
      if (stopped) break;
      const row = manifest.cases[index];
      const source = JSON.parse(readFileSync(row.file, 'utf8')).source;
      const channel = source.currentChannel;
      const outputs = Object.assign({}, ...source.stages.filter((s: { block: string }) => s.block !== 'metadata').map((s: { outputs: unknown }) => s.outputs));
      const narration = outputs.narrationText;
      if (typeof narration !== 'string' || !narration) throw new Error('Full retained narration required');
      const scope = createModelUsageScope();
      const logs: string[] = [];
      const started = Date.now();
      try {
        const result = await scope.run(() => craftMetadata({
          topic: outputs.topic,
          channelName: channel.name,
          niche: channel.identity.niche,
          persona: channel.identity.persona,
          language: channel.metadataParams?.[0]?.language,
          scriptExcerpt: narration.slice(0, 800),
          ...(mode === 'after' ? { narrationText: narration } : {}),
          coldOpen: outputs.script?.hook,
          hookLoop: outputs.script?.hookLoop,
          quote: outputs.script?.closingLine,
          titleFormula: channel.styleSeo?.titleFormula,
          descriptionStructure: channel.styleSeo?.descriptionStructure,
          competitorTitles: (outputs.competitors ?? []).flatMap((c: { topVideos: unknown[] }) => c.topVideos)
            .sort((a: { views: number }, b: { views: number }) => b.views - a.views).slice(0, 12),
          powerWords: outputs.nicheIntel?.powerWords?.map((p: { word: string }) => p.word).slice(0, 12),
          betTitle: outputs.topicBet?.provisionalTitle,
          titleProfile: resolveTitleProfile(undefined, { family: channel.family, niche: channel.identity.niche, contentLane: channel.contentLane?.key }),
          log: (message) => logs.push(message),
        }));
        results.push({ channel: channel.name, runId: row.runId, sourceChars: narration.length, result, logs, usage: scope.snapshot(), elapsedMs: Date.now() - started });
        console.log(JSON.stringify({ channel: channel.name, title: result.title, alternate: result.titleAlternate, costUsd: scope.snapshot().costUsd }));
      } catch (error) {
        results.push({ channel: channel.name, error: error instanceof Error ? error.message : String(error), logs, usage: scope.snapshot() });
        console.log(JSON.stringify({ channel: channel.name, result: 'failed; evidence retained', stopped }));
      }
      save();
    }
  } finally {
    globalThis.fetch = realFetch;
    save();
  }
  console.log(JSON.stringify({ paidCalls, reportedCost, stopped, outputDir }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
