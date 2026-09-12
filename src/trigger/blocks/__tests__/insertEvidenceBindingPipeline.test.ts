import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dataStorySourceLedgerFingerprint } from '@/engine/dataStorySourceLedger';
import { evidenceVisualManifestAllowsNumbers, evidenceVisualManifestFingerprint, type EvidenceVisualManifest } from '@/engine/evidenceVisualManifest';
import { DATA_STORY_CONTRACT_VERSION } from '@/engine/dataStory';
import type { InsertPlanItem } from '../insertBlocks';

// Declared synthetic evidence, not a live source review or model-quality proof.
const source = { id: 'source-fixture', name: 'Example Statistics Office', url: 'https://example.org/statistics', snapshotSha256: 'a'.repeat(64) };
const sentence = 'According to the Example Statistics Office, output moved from 2% to 4% over 5 years.';
const otherSentence = 'According to the Example Statistics Office, participation was 9%.';
const timings = [{ text: sentence, start: 0, end: 12 },
  { text: 'According to the Example Statistics Office, there were 77 records.', start: 12, end: 20 },
  { text: otherSentence, start: 20, end: 30 }];
const baseLedger = { version: 'data-story-source-ledger/v1' as const, topic: 'Synthetic contract test', sources: [source],
  claims: [{ id: 'output', sourceId: source.id, numericAnchor: '2%', context: 'Output comparison' },
    { id: 'records', sourceId: source.id, numericAnchor: '77', context: 'Record count' },
    { id: 'participation', sourceId: source.id, numericAnchor: '9%', context: 'Participation rate' }] };
const dataStorySourceLedger = { ...baseLedger, review: { decision: 'approved', reviewerId: 'test-reviewer', reviewId: 'test-ledger', reviewedAt: new Date().toISOString(), reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(baseLedger) } };
const base = { version: 'evidence-visual-manifest/v1' as const, id: 'visual-fixture', visualKind: 'chart' as const, surface: 'data_insert' as const, sources: [source],
  narrationAnchors: [{ id: 'anchor-output', sentenceId: 'sentence-output', spokenText: sentence, startSec: 0, endSec: 12, requiredAttribution: source.name, sourceIds: [source.id] },
    { id: 'anchor-other', sentenceId: 'sentence-other', spokenText: otherSentence, startSec: 20, endSec: 30, requiredAttribution: source.name, sourceIds: [source.id] }],
  values: [
    { id: 'value-before', role: 'series' as const, value: 2, display: '2%', unit: 'percent', label: 'Before', sourceId: source.id, narrationAnchorId: 'anchor-output' },
    { id: 'value-after', role: 'series' as const, value: 4, display: '4%', unit: 'percent', label: 'After', sourceId: source.id, narrationAnchorId: 'anchor-output' },
    { id: 'value-years', role: 'x' as const, value: 5, display: '5 years', unit: 'years', sourceId: source.id, narrationAnchorId: 'anchor-output' },
    { id: 'value-other', role: 'series' as const, value: 9, display: '9%', unit: 'percent', sourceId: source.id, narrationAnchorId: 'anchor-other' }],
  attribution: { visibleText: source.name, sourceIds: [source.id] } };
const manifest: EvidenceVisualManifest = { ...base, review: { decision: 'approved', reviewerId: 'test-reviewer', reviewId: 'test-visual', reviewedAt: new Date().toISOString(), reviewedManifestFingerprint: evidenceVisualManifestFingerprint(base) } };
const common = { sentenceIdx: 0, evidenceVisualId: manifest.id, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-before', 'value-after'] } };
const line: InsertPlanItem = { ...common, kind: 'line_chart', title: 'Output comparison' };
const bar: InsertPlanItem = { ...common, kind: 'bar_compare', title: 'Output comparison' };
const stat: InsertPlanItem = { ...common, kind: 'big_stat', evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-after'] } };
let plan: InsertPlanItem;
let rendered: Record<string, unknown>[] = [];
let stored: string[] = [];
let prompts: string[] = [];
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const original = loader._load;
loader._load = function(request, ...rest) {
  const actual = original.call(this, request, ...rest) as Record<string, unknown>;
  if (request.endsWith('/anthropic')) return { ...actual, hasAnthropicKey: () => true, claudeJson: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return { inserts: [plan] }; } };
  if (request.endsWith('/remotionRender')) return { ...actual, renderDataInsert: async (args: Record<string, unknown>) => { rendered.push(args); return args.outPath; } };
  if (request.endsWith('/files')) return { ...actual, makeRunTempDir: async () => '/tmp/insert-evidence-seam', readBytes: async () => Buffer.from('test-render') };
  if (request.endsWith('/storage')) return { ...actual, putObject: async (key: string) => { stored.push(key); } };
  return actual;
};

async function main() {
  const { visualInserts, numericPlanValues } = await import('../insertBlocks');
  const { bindDataInsertEvidence } = await import('@/engine/dataInsertEvidence');
  let cases = 0;
  let pilotContext: Record<string, unknown> | undefined;
  const acceptedRenderInputs: Record<string, unknown>[] = [];
  async function run(name: string, item: InsertPlanItem, expected: boolean, inputManifest = manifest, inputTimings = timings) {
    plan = item; rendered = []; stored = []; prompts = [];
    const logs: string[] = [];
    const context = { ownerId: 'fixture-owner', runId: 'fixture-binding', channelId: 'fixture-channel', keyPrefix: 'fixture/evidence/',
      params: { insertTypes: ['big_stat', 'bar_compare', 'line_chart', 'annotated_line'], maxInserts: 1, minGapSec: 0,
        dataStoryContract: DATA_STORY_CONTRACT_VERSION, requireNamedSource: true, requireSpokenNumericAnchor: true },
      store: { sentenceTimings: inputTimings, dataStorySourceLedger, evidenceVisualManifests: [inputManifest], palette: ['#13252d', '#58c9b0', '#eef5f4'] }, log: (message: string) => logs.push(message) };
    if (cases === 0) pilotContext = context;
    const result = await visualInserts.run(context as never);
    assert.equal(prompts.length, 1, name);
    assert.ok(prompts[0].includes('evidenceBindings') && prompts[0].includes('anchor anchor-output; source source-fixture'), 'Planner must receive selectable source/anchor identities');
    assert.ok(!prompts[0].includes('8-16 numbers') && !prompts[0].includes('compounding curves bow upward'), 'Strict planning must not inherit ordinary interpolation instructions');
    assert.equal(rendered.length, Number(expected), `${name}: ${logs.join('\n')}`);
    assert.equal(stored.length, Number(expected), `${name}: rejected work must not write assets`);
    assert.equal((result.insertOverlays as unknown[]).length, Number(expected));
    if (expected) {
      assert.equal(rendered[0].sourceAttribution, source.name);
      assert.deepEqual(rendered[0].palette, ['#13252d', '#58c9b0', '#eef5f4']);
    } else assert.ok(logs.some((log) => log.includes('DROPPED')), `${name}: actionable failure required`);
    cases++;
    return rendered[0];
  }
  acceptedRenderInputs.push(await run('ID-only line', line, true));
  assert.deepEqual(rendered[0].series, [2, 4]);
  assert.deepEqual(rendered[0].seriesDisplays, ['2%', '4%']);
  assert.equal(rendered[0].seriesUnit, 'percent');
  acceptedRenderInputs.push(await run('ID-only bars', bar, true));
  assert.deepEqual(rendered[0].bars, [{ label: 'Before', value: 2, display: '2%' }, { label: 'After', value: 4, display: '4%' }]);
  acceptedRenderInputs.push(await run('ID-only stat', stat, true));
  assert.equal(rendered[0].value, '4%'); assert.equal(rendered[0].label, 'After');
  await run('matching explicit copies', { ...stat, value: '4%', label: 'After' }, true);
  await run('whitespace-only display normalization', { ...stat, value: ' 4% ' }, true);
  const capturedPilot = JSON.parse(readFileSync('test-fixtures/insert-evidence-binding/planner-after.json', 'utf8'));
  const capturedPlan = JSON.parse(capturedPilot.transport[0].response.choices[0].message.content).inserts[0];
  await run('unchanged successful live-planner response', capturedPlan, true);
  for (const title of ['Output increased by 4 dollars', '4% growth and 4 dollars', 'Output increased by four dollars', '$4%', '4%%', '4% million']) await run('title quantity laundering', { ...stat, title }, false);
  for (const item of [null, 4, { ...stat, title: { claim: 'garbage' } }, { ...stat, title: 4 }]) await run('malformed top-level entry or title', item as unknown as InsertPlanItem, false);
  // The former membership oracle accepts all these numbers. Prove its blind
  // spot before requiring the real block to reject the changed meaning.
  for (const [name, item] of [
    ['years repackaged as percent', { ...stat, value: '5%', anchorValues: [5], evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-years'] } }],
    ['approved percent turned into currency', { ...stat, value: '$4', anchorValues: [4] }],
    ['same number relabeled', { ...stat, value: '4%', label: 'Inflation', anchorValues: [4] }],
    ['bar categories swapped', { ...bar, anchorValues: [2, 4], bars: [{ label: 'After', value: 2, display: '2%' }, { label: 'Before', value: 4, display: '4%' }] }],
    ['bar display divorced from geometry', { ...bar, anchorValues: [2, 4], bars: [{ label: 'Before', value: 2, display: '4%' }, { label: 'After', value: 4, display: '2%' }] }],
    ['line reordered', { ...line, series: [4, 2], anchorValues: [4, 2] }],
  ] as [string, InsertPlanItem][]) {
    assert.equal(evidenceVisualManifestAllowsNumbers(manifest, numericPlanValues(item)), true, `${name}: old numeric gate cannot detect this`);
    await run(name, item, false);
  }
  await run('missing bindings', { ...stat, evidenceBindings: undefined, value: '4%', anchorValues: [4] }, false);
  for (const corrupt of [{ value: 4 }, { label: {} }, { series: '2,4' }, { bars: [null] }, { evidenceBindings: { anchorId: 'anchor-output', valueIds: 'value-after' } }]) {
    await run('malformed planner field', { ...stat, ...corrupt } as unknown as InsertPlanItem, false);
  }
  await run('unknown value', { ...stat, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['missing'] } }, false);
  await run('other narrated anchor', { ...stat, evidenceBindings: { anchorId: 'anchor-other', valueIds: ['value-other'] } }, false);
  await run('value from another anchor', { ...stat, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-other'] } }, false);
  await run('duplicate points', { ...line, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-before', 'value-before'] } }, false);
  await run('reversed IDs', { ...line, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['value-after', 'value-before'] } }, false);
  await run('axis role swapped', { ...line, evidenceBindings: { ...common.evidenceBindings, xValueIds: ['value-before', 'value-after'] } }, false);
  await run('live pilot duration mistaken for x endpoints', { ...line, title: 'Output Growth Over 5 Years', anchorValues: ['2%', '4%', '5 years'], evidenceBindings: { ...common.evidenceBindings, xValueIds: ['value-years'] } }, false);
  await run('unbound x labels', { ...line, xLabels: ['2', '4'] }, false);
  await run('unreviewed annotation', { ...line, kind: 'annotated_line', events: [{ idx: 1, label: 'Policy caused growth' }] }, false);
  await run('reviewed annotation', { ...line, kind: 'annotated_line', events: [{ idx: 1, label: 'After' }] }, true);
  const mixedBase = { ...base, values: base.values.map((value) => value.id === 'value-after' ? { ...value, unit: 'percentage points' } : value) };
  const mixed = { ...mixedBase, review: { ...manifest.review, reviewedManifestFingerprint: evidenceVisualManifestFingerprint(mixedBase) } };
  await run('different reviewed units on one scale', line, false, mixed);
  assert.equal(bindDataInsertEvidence(manifest, line, { text: sentence, start: 50, end: 60 }).ok, false, 'Identical sentence at a different time cannot borrow this anchor');
  assert.equal(bindDataInsertEvidence(manifest, line, { text: sentence, start: 8, end: 4 }).ok, false, 'Inverted overlapping timing is not a valid anchor');
  assert.equal(bindDataInsertEvidence(manifest, line, { text: 'output', start: 0, end: 12 }).ok, false, 'A short fragment must not match a longer approved sentence backwards');
  const hiddenSource = structuredClone(manifest); hiddenSource.attribution.sourceIds = [];
  assert.equal(bindDataInsertEvidence(hiddenSource, stat, timings[0]).ok, false, 'Binding refuses a value whose source is not visibly attributed');
  const axisSentence = 'According to the Example Statistics Office, output was 2% in 2020, 3% in 2021 and 4% in 2030.';
  const axisTimings = [{ ...timings[0], text: axisSentence }, ...timings.slice(1)];
  const axis = structuredClone(manifest);
  axis.narrationAnchors[0].spokenText = axisSentence;
  axis.values = [
    ...[2020, 2021, 2030].map((year, i) => ({ id: `y-${year}`, role: 'series' as const, value: i + 2, display: `${i + 2}%`, unit: 'percent', label: String(year), xValueId: `x-${year}`, sourceId: source.id, narrationAnchorId: 'anchor-output' })),
    ...[2020, 2021, 2030].map((year) => ({ id: `x-${year}`, role: 'x' as const, value: year, display: String(year), unit: 'year', sourceId: source.id, narrationAnchorId: 'anchor-output' })),
  ];
  axis.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(axis);
  const axisLine = { ...line, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['y-2020', 'y-2021', 'y-2030'] } };
  const axisRender = await run('paired irregular x observations', axisLine, true, axis, axisTimings);
  assert.deepEqual(axisRender.seriesX, [2020, 2021, 2030]);
  assert.deepEqual(axisRender.xLabels, ['2020', '2021', '2030']);
  await run('year repackaged as title currency', { ...axisLine, title: 'Revenue of $2020' }, false, axis, axisTimings);
  const power = structuredClone(manifest);
  power.narrationAnchors[0].spokenText = 'According to the Example Statistics Office, output moved from 2 mW to 4 mW.';
  power.values = power.values.slice(0, 2).map((value) => ({ ...value, unit: 'milliwatts', display: `${value.value} mW` }));
  power.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(power);
  assert.equal(bindDataInsertEvidence(power, { ...stat, title: 'Power reached 4 mW' }, { ...timings[0], text: power.narrationAnchors[0].spokenText }).ok, true);
  assert.equal(bindDataInsertEvidence(power, { ...stat, title: 'Power reached 4 MW' }, { ...timings[0], text: power.narrationAnchors[0].spokenText }).ok, false, 'Milli must not become mega in a case-folded title');
  const endpoints = { ...line, evidenceBindings: { anchorId: 'anchor-output', valueIds: ['y-2020', 'y-2030'], xValueIds: ['x-2020', 'x-2030'] } };
  await run('paired endpoint subset', endpoints, true, axis, axisTimings);
  await run('wrong year attached to first value', { ...endpoints, evidenceBindings: { ...endpoints.evidenceBindings, xValueIds: ['x-2021', 'x-2030'] } }, false, axis, axisTimings);
  const unlinked = structuredClone(axis); delete unlinked.values[0].xValueId;
  unlinked.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(unlinked);
  await run('partially linked x observations', axisLine, false, unlinked, axisTimings);
  const badLink = structuredClone(axis); badLink.values[0].xValueId = 'missing-x';
  badLink.review.reviewedManifestFingerprint = evidenceVisualManifestFingerprint(badLink);
  const { evaluateEvidenceVisualManifest } = await import('@/engine/evidenceVisualManifest');
  assert.ok(evaluateEvidenceVisualManifest(badLink).issues.some((issue) => issue.code === 'chart_coordinate_mismatch'));
  const proofPath = process.argv[2];
  if (proofPath) {
    assert.match(proofPath, /^\/tmp\/insert-binding-[\w-]+\.json$/);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(proofPath, JSON.stringify(acceptedRenderInputs, null, 2), { flag: 'wx' });
    await writeFile(`${proofPath}.context.json`, JSON.stringify(pilotContext, null, 2), { flag: 'wx' });
    await writeFile(proofPath.replace(/\.json$/, '-axis.json'), JSON.stringify([axisRender], null, 2), { flag: 'wx' });
  }
  console.log(`INSERT EVIDENCE BINDING PIPELINE PASS — ${cases} actual-block cases; 6 old numeric-gate false passes rejected; source/unit/display/category/order/timing/title/paired-coordinate checks; no live provider calls`);
}
main().finally(() => { loader._load = original; }).catch((error) => { console.error(error); process.exitCode = 1; });
