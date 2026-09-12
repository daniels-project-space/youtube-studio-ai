import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';

// Run the real block, title engine, lint, decision sealing and finishing. Only
// model responses and external reads are fixtures; this is wiring, not model QA.
const prompts: string[] = [];
let candidate = 'Roman Aqueducts Carried Water for 240 Miles';
let failAt: 'generator' | 'judge' | undefined;
let transportError: Error;
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function(request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (request.endsWith('/performance')) return { ...resolved, loadPerformanceContext: async () => '' };
  if (request.endsWith('/convexHttpClient')) return { ...resolved, convex: () => ({ query: async () => ({ estimatedViews: 0, source: 'fixture' }) }) };
  if (!request.endsWith('/anthropic')) return resolved;
  return { ...resolved, hasAnthropicKey: () => true, claudeJson: async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    if (prompt.includes('pinned comment')) return { comment: 'Which part matters to you?' };
    if (prompt.includes('description + tags')) return { description: 'A source-bound description.', tagsCsv: 'history,water,engineering,aqueduct,rome' };
    if ((failAt === 'judge' && prompt.startsWith('You are a YouTube CTR strategist')) ||
      (failAt === 'generator' && prompt.startsWith('Write SEVEN'))) throw transportError;
    if (prompt.startsWith('You are a YouTube CTR strategist')) return {
      rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, grounding: 'supported', reason: 'Fixture response, not quality evidence.' }], winner: 0, runnerUp: 0,
    };
    return { candidates: [{ frame: 'mechanism', title: candidate }] };
  } };
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.match(String(url), /^https:\/\/suggestqueries\.google\.com\//, 'No external reads beyond frozen autocomplete');
  return Response.json(['', []]);
};

function contextFrom(prompt: string) {
  const text = prompt.split('VIDEO CONTEXT JSON:\n')[1]?.split('\nEND VIDEO CONTEXT')[0];
  assert.ok(text, 'Every creative consumer must receive the shared video context');
  return JSON.parse(text);
}

async function main() {
  const { metadataOptimized } = await import('../intelligenceBlocks');
  const { craftMetadata } = await import('../../../lib/metacraft');
  const baseStore = {
    topic: 'Roman aqueduct engineering', channelName: 'Water Archive', niche: 'history',
    persona: 'Patient engineering historian', competitors: [{ topVideos: [{ title: 'Roman water systems', views: 200 }] }],
    styleDNA: { seo: { titleFormula: 'State the engineering consequence' } },
  };
  const full = '  ' + 'Roman aqueducts moved water across difficult terrain. '.repeat(50) + '\nThe route carried water for 240 miles. 尾声 🌊\n';
  async function run(store: Record<string, unknown>) {
    prompts.length = 0;
    return metadataOptimized.run({
      ownerId: 'owner-fixture', runId: 'run-fixture', channelId: 'channel-fixture',
      keyPrefix: 'test/metadata-source/', params: { language: 'en' },
      store: { ...baseStore, ...store }, log: () => {},
    } as never);
  }
  // This claim is only at the tail, beyond both old excerpt limits.
  let output: Record<string, unknown> | undefined;
  let error: unknown;
  try { output = await run({ narrationText: full }); } catch (caught) { error = caught; }
  assert.ok(prompts[0]?.includes(JSON.stringify(full)), 'Generator lost exact full narration at the production caller');
  assert.ifError(error);
  assert.equal(output?.title, candidate, 'Late-source claim must survive the actual lint and finishing path');
  const contexts = prompts.map(contextFrom);
  assert.equal(contexts.length, 4);
  for (const context of contexts) {
    assert.deepEqual(context, contexts[0], 'Generation, judge, description and comment must share source and identity');
    assert.equal(context.source.text, full);
    assert.equal(context.source.kind, 'full_narration');
    assert.equal(context.channel.persona, baseStore.persona);
    assert.equal(context.channel.titleFormula, baseStore.styleDNA.seo.titleFormula);
  }
  assert.deepEqual((output?.titleDecision as { sourceCoverage: unknown }).sourceCoverage, {
    kind: 'full_narration', providedChars: full.length, totalChars: full.length,
  });
  await run({ narrationText: ' ', script: { narrationText: full } });
  assert.equal(contextFrom(prompts[0]).source.text, full, 'Script-owned narration remains full source when top-level narration is absent');

  // Exact quantities survive the real caller, judge, finishing and sealed UI
  // receipt. The controlled judge would approve anything it sees, so a bad
  // numeric promise must be removed BEFORE that paid semantic review.
  const priorCandidate = candidate;
  candidate = 'Returns of 10.2 Percent Change the Outcome';
  const numericSource = 'Returns of ten point two percent change the outcome.';
  const numeric = await run({ topic: 'Returns and outcomes', narrationText: numericSource, script: { hook: numericSource } });
  assert.equal(numeric.title, candidate);
  const { readTitleReview: readNumericReview } = await import('../../../lib/titleReviewPresentation');
  assert.equal(readNumericReview(numeric)?.state, 'recorded');
  for (const badSource of ['Returns of one hundred two percent change the outcome.', 'Returns of ten point zero two percent change the outcome.']) {
    await assert.rejects(() => run({ topic: 'Returns and outcomes', narrationText: badSource, script: { hook: badSource } }), /ungrounded number|opening promise mismatch/);
    assert.equal(prompts.filter((prompt) => prompt.startsWith('You are a YouTube CTR strategist')).length, 0);
    assert.equal(prompts.filter((prompt) => prompt.includes('description + tags') || prompt.includes('pinned comment')).length, 0);
  }
  candidate = priorCandidate;

  // Five retained narrations cross the block unchanged, even when the controlled
  // candidate fails lint. No corpus text or expected creative answer is edited.
  const manifest = JSON.parse(readFileSync('test-fixtures/title-baseline/manifest.json', 'utf8'));
  for (const row of manifest.cases.filter((c: { narration: unknown[] }) => c.narration.length)) {
    const source = JSON.parse(readFileSync(row.file, 'utf8')).source;
    const text = source.stages.find((s: { outputs: { narrationText?: string } }) => s.outputs.narrationText)?.outputs.narrationText;
    await run({ narrationText: text }).catch(() => {});
    assert.equal(contextFrom(prompts[0]).source.text, text, `${row.channelName}: source handoff must preserve exact bytes`);
  }
  candidate = 'Roman Aqueducts Changed City Life';
  for (const [args, kind, text, total] of [
    [{ scriptExcerpt: 'Roman aqueducts changed city life.' }, 'script_excerpt', 'Roman aqueducts changed city life.', null],
    [{}, 'topic_only', '', null],
  ] as const) {
    prompts.length = 0;
    const out = await craftMetadata({ topic: baseStore.topic, competitorTitles: [{ title: 'Water systems', views: 200 }], ...args });
    assert.deepEqual(out.titleDecision.sourceCoverage, { kind, providedChars: text.length, totalChars: total });
    assert.equal(contextFrom(prompts[0]).source.text, text);
  }
  const { OpenRouterGenerationOutcomeUnknownError } = await import('../../../lib/openRouter');
  const { classifyExecutionError } = await import('../../../engine/executionErrors');
  for (const phase of ['generator', 'judge'] as const) {
    prompts.length = 0;
    failAt = phase;
    transportError = new OpenRouterGenerationOutcomeUnknownError('HTTP 503 after paid dispatch', { status: 503 });
    await assert.rejects(() => craftMetadata({ topic: baseStore.topic, competitorTitles: [{ title: 'Water systems', views: 200 }] }),
      (error) => error === transportError);
    assert.equal(prompts.length, phase === 'generator' ? 1 : 2, 'Ambiguous paid outcome must not buy another attempt or optional package');
    await assert.rejects(() => run({ narrationText: full }), (error) => {
      assert.equal(error, transportError, 'The real block must preserve provider retry metadata for the engine');
      assert.equal(classifyExecutionError(error).retryable, false, 'An ambiguous paid 503 must not be reclassified as safe to retry');
      return true;
    });
    assert.equal(prompts.length, phase === 'generator' ? 1 : 2);
  }
  // Replay actual paid decisions through the production UI adapter. This
  // validates integrity/presentation, not the correctness of model scores.
  const { readTitleReview } = await import('../../../lib/titleReviewPresentation');
  const comparison = JSON.parse(readFileSync('test-fixtures/title-source-comparison/results.json', 'utf8'));
  for (const arm of comparison.runs) {
    for (const result of arm.results) {
      const review = readTitleReview(result);
      assert.equal(review?.state, 'recorded', `${arm.arm}/${result.channel}: real decision must remain inspectable`);
      if (review?.state === 'recorded') assert.equal(review.source, arm.arm === 'before' ? 'Script excerpt' : 'Full narration');
      const tampered = structuredClone(result);
      tampered.titleDecision.sourceCoverage.providedChars += 1;
      assert.equal(readTitleReview(tampered)?.state, 'unavailable', 'Edited source coverage must invalidate the sealed receipt');
    }
  }
  console.log('METADATA SOURCE HANDOFF PASS — real caller, all creative consumers, tail claims, five retained narrations, truthful coverage');
}

main().finally(() => { loader._load = originalLoad; globalThis.fetch = originalFetch; }).catch((error) => { console.error(error); process.exitCode = 1; });
