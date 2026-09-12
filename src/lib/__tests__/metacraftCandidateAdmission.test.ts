import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';

// Actual title engine; replay one saved generated title while a poisoned
// provisional title precedes it. The provider seam is controlled, not a new
// creative-quality or audience measurement.
const evidence = JSON.parse(readFileSync('test-fixtures/title-source-comparison/results.json', 'utf8'));
const finals = evidence.runs.find((arm: { arm: string }) => arm.arm === 'qualified').results;
const manifest = JSON.parse(readFileSync('test-fixtures/title-baseline/manifest.json', 'utf8'));
let title = '';
let generatorCalls = 0;
let judgeCalls = 0;
let rejectedTitle = '';
let generatedTitles: string[] | undefined;
let preferredTitle = '';
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request, ...rest) {
  const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (!request.endsWith('/anthropic')) return resolved;
  return { ...resolved, hasAnthropicKey: () => true, claudeJson: async ({ prompt }: { prompt: string }) => {
    if (prompt.includes('pinned comment')) return { comment: 'Which detail stood out?' };
    if (prompt.includes('description + tags')) return { description: 'Fixture package.', tagsCsv: 'a,b,c,d,e' };
    if (prompt.startsWith('You are a YouTube CTR strategist')) {
      judgeCalls++;
      const rows = prompt.split('CANDIDATES:\n')[1].split('\n\n')[0].split('\n');
      return { rankings: rows.map((row, idx) => ({ idx, clickScore: preferredTitle && row.endsWith(preferredTitle) ? 10 : 9, direct: 9, identityFit: 9,
        grounding: row.endsWith(rejectedTitle) && rejectedTitle ? 'insufficient' : 'supported',
        reason: 'Controlled admission response, not model-quality evidence.' })) };
    }
    generatorCalls++;
    return { candidates: (generatedTitles ?? [title]).map((value) => ({ frame: 'retained-generation', title: value })) };
  } };
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  assert.match(String(input), /^https:\/\/suggestqueries\.google\.com\//);
  return Response.json(['', []]);
};

async function main() {
  const { craftMetadata, areNearDuplicateTitles } = await import('../metacraft');
  for (const selected of finals) {
    const row = manifest.cases.find((c: { runId: string }) => c.runId === selected.runId);
    const source = JSON.parse(readFileSync(row.file, 'utf8')).source;
    const store = Object.assign({}, ...source.stages.map((stage: { outputs: unknown }) => stage.outputs));
    title = selected.title;
    generatorCalls = judgeCalls = 0;
    const output = await craftMetadata({
      topic: store.topic, channelName: source.currentChannel.name, niche: source.currentChannel.identity.niche,
      narrationText: store.narrationText, competitorTitles: [{ title: 'Frozen evidence', views: 100 }],
      warmStartTitle: `${title} 999999`,
    });
    assert.equal(output.title, title, `${selected.channel}: invalid provisional claim cannot suppress a valid generated title`);
    assert.equal(generatorCalls, 1, 'No avoidable second paid generation');
    assert.equal(judgeCalls, 1);
  }

  // Both pass mechanical lint; only the semantic judge can reject the false
  // claim. The earlier candidate must not suppress the other before review.
  title = 'Mud Preserved the Soldier Letter';
  rejectedTitle = 'Mud Preserved the Soldier Letter Forever';
  generatorCalls = judgeCalls = 0;
  const reviewed = await craftMetadata({
    topic: 'A preserved soldier letter', narrationText: 'Mud preserved the soldier letter until excavation. It remains vulnerable to air.',
    warmStartTitle: rejectedTitle, competitorTitles: [{ title: 'Frozen evidence', views: 100 }],
  });
  assert.equal(reviewed.title, title);
  assert.equal(reviewed.titleDecision.candidates.length, 2, 'Both meanings must reach the source-aware judge');
  assert.equal(generatorCalls, 1);
  assert.equal(judgeCalls, 1);

  // All valid candidates remain auditable. The runner-up skips a filler-only
  // variant only after the semantic scores establish which version is best.
  rejectedTitle = '';
  preferredTitle = 'Taxes Fund Public Schools';
  generatedTitles = ['How Taxes Actually Fund Public Schools', preferredTitle, 'Where School Tax Money Goes'];
  const variants = await craftMetadata({
    topic: 'Taxes and public schools', narrationText: 'Taxes fund public schools. School tax money goes to teachers and maintenance.',
    competitorTitles: [{ title: 'Frozen evidence', views: 100 }],
  });
  assert.equal(variants.title, preferredTitle);
  assert.equal(variants.titleAlternate, 'Where School Tax Money Goes');
  assert.equal(variants.titleDecision.candidates.length, 3, 'Retain every reviewed option in the decision receipt');
  const { readTitleReview } = await import('../titleReviewPresentation');
  const presentation = readTitleReview(variants);
  assert.equal(presentation?.state, 'recorded', 'Original candidate indexes and the sealed receipt must survive alternate filtering');
  if (presentation?.state === 'recorded') {
    assert.equal(presentation.options.find((option) => option.alternate)?.title, variants.titleAlternate);
  }

  for (const [left, right] of [
    ['The Bridge Failed After 4 Years', 'The Bridge Failed After 40 Years'],
    ['Small Investments Build Wealth', 'Small Investments Do Not Build Wealth'],
    ['Police Followed the Bank Robbers', 'Bank Robbers Followed the Police'],
    ['Taxes Fund Schools Before Roads', 'Taxes Fund Schools After Roads'],
  ]) assert.equal(areNearDuplicateTitles(left, right), false, `Do not collapse different claims: ${left} / ${right}`);
  assert.equal(areNearDuplicateTitles('How Taxes Actually Fund Public Schools', 'Taxes Fund Public Schools'), true);
  console.log('METACRAFT CANDIDATE ADMISSION PASS — four retained titles, semantic rejection, claim-sensitive alternatives, no avoidable re-generation');
}
main().finally(() => { loader._load = originalLoad; globalThis.fetch = originalFetch; }).catch((error) => { console.error(error); process.exitCode = 1; });
