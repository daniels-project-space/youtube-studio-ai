import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import type { InsertPlanItem } from '../insertBlocks';

// Actual block and every production gate. Only planner, renderer and storage
// are controlled external seams; this does not claim a rendered artifact.
let plan: InsertPlanItem[] = [];
let prompts: string[] = [];
let rendered: Record<string, unknown>[] = [];
let stored: string[] = [];
let plannerError: Error | undefined;
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const original = loader._load;
loader._load = function(request, ...rest) {
  const resolved = original.call(this, request, ...rest) as Record<string, unknown>;
  if (request.endsWith('/anthropic')) return { ...resolved, hasAnthropicKey: () => true,
    claudeJson: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); if (plannerError) throw plannerError; return { inserts: plan }; } };
  if (request.endsWith('/remotionRender')) return { ...resolved,
    renderDataInsert: async (args: Record<string, unknown>) => { rendered.push(args); return args.outPath; } };
  if (request.endsWith('/files')) return { ...resolved, makeRunTempDir: async () => '/tmp/insert-exact-seam', readBytes: async () => Buffer.from('controlled-render-seam') };
  if (request.endsWith('/storage')) return { ...resolved,
    putObject: async (key: string, _bytes: unknown, options: { contentType: string }) => {
      assert.equal(options.contentType, 'video/webm'); stored.push(key);
    } };
  return resolved;
};

async function main() {
  const { visualInserts, numericPlanValues } = await import('../insertBlocks');
  let numericCases = 0;
  assert.deepEqual(numericPlanValues({ sentenceIdx: 0, kind: 'big_stat', value: '-2.5 million', anchorValues: ['minus two point five million'] }), [-2500000, -2500000], 'Strict manifest must see the same sign and scale as the ordinary gate');
  assert.ok(Number.isNaN(numericPlanValues({ sentenceIdx: 0, kind: 'big_stat', value: '1/2' })[0]), 'Unsupported literal cannot disappear from strict evidence review');
  async function run(sentence: string, item: Partial<InsertPlanItem>, expected: boolean) {
    prompts = []; rendered = []; stored = [];
    plan = [{ sentenceIdx: 0, kind: 'big_stat', ...item } as InsertPlanItem];
    const logs: string[] = [];
    const result = await visualInserts.run({ ownerId: 'fixture-owner', runId: 'fixture-run', channelId: 'fixture-channel',
      keyPrefix: 'fixture/insert-exact/', params: { insertTypes: ['big_stat', 'line_chart', 'bar_compare', 'lower_third'], maxInserts: 1, minGapSec: 0 },
      store: { sentenceTimings: [{ text: sentence, start: 0, end: 12 }], topic: 'Retained numeric evidence', niche: 'educational', palette: ['#13252d', '#58c9b0', '#eef5f4'] },
      log: (message: string) => logs.push(message),
    } as never);
    assert.equal(prompts.length, 1, `Spoken quantities must reach the director: ${sentence}`);
    assert.ok(prompts[0].includes(sentence));
    assert.equal(rendered.length, expected ? 1 : 0, `${JSON.stringify(item)} / ${sentence}\n${logs.join('\n')}`);
    assert.equal(stored.length, rendered.length, 'Rejected values must never reach storage');
    const overlays = result.insertOverlays as { key: string; startSec: number; durSec: number }[];
    assert.equal(overlays.length, rendered.length);
    if (expected) {
      assert.equal(overlays[0].key, 'fixture/insert-exact/runs/fixture-run/insert_0.webm');
      assert.ok(overlays[0].startSec >= 0 && overlays[0].startSec + overlays[0].durSec <= 12.5);
      assert.deepEqual(rendered[0].palette, ['#13252d', '#58c9b0', '#eef5f4']);
    } else assert.ok(logs.some((log) => log.includes('DROPPED')), 'A rejected plan needs an actionable reason');
    numericCases++;
  }
  const manifest = JSON.parse(readFileSync('test-fixtures/title-baseline/manifest.json', 'utf8'));
  const sourceRow = manifest.cases.find((row: { channelName: string; narration: unknown[] }) => row.channelName === 'Investory' && row.narration.length);
  const source = JSON.parse(readFileSync(sourceRow.file, 'utf8')).source;
  const narration: string = source.stages.find((stage: { outputs: { narrationText?: string } }) => stage.outputs.narrationText)?.outputs.narrationText;
  const rows: [string, string, string][] = [
    ['Both invest two hundred', '$200', '$2.9'],
    ['The first starts at age', '25', '20'],
    ['Both earn a consistent', '7%', '-7%'],
    ['They have less than two hundred', '$200,000', '$200.9'],
    ['A weekly transfer of', '$25', '$25.9'],
    ['According to a 2023 analysis by Charles Schwab, the average', '10.2%', '10.9%'],
  ];
  for (const [prefix, good, bad] of rows) {
    const sentence = narration.split(/(?<=[.!?])\s+/).find((text) => text.startsWith(prefix));
    assert.ok(sentence, `Exact source missing: ${prefix}`);
    await run(sentence, { value: good, anchorValues: [good] }, true);
    await run(sentence, { value: bad, anchorValues: [good] }, false);
    await run(sentence, { value: good, anchorValues: [bad] }, false);
  }
  await run('The bank held two million dollars.', { value: '$2M', anchorValues: ['two million'] }, true);
  await run('The bank held two million dollars.', { value: '$2.9M', anchorValues: ['2M'] }, false);
  // Preserve all magnitude aliases supported by the former insert parser.
  // An unrecognised suffix must not disguise a financial scalar as an ID.
  for (const [suffix, word] of [['MM', 'million'], ['mn', 'million'], ['T', 'trillion']]) {
    const sentence = `The total was two ${word} dollars.`;
    await run(sentence, { value: `$2${suffix}`, anchorValues: [`two ${word}`] }, true);
    await run(sentence, { value: `$2.9${suffix}`, anchorValues: [`two ${word}`] }, false);
  }
  await run('The bank held two million dollars.', { value: '$0', anchorValues: ['2M'] }, false);
  await run('The bank held zero dollars.', { value: '$0', anchorValues: [0] }, true);
  await run('The change went from minus ten to minus two percent.', { kind: 'line_chart', series: [-10, -6, -2], anchorValues: [-10, -2] }, true);
  await run('The change went from minus ten to minus two percent.', { kind: 'line_chart', series: [2, 6, 10], anchorValues: [-10, -2] }, false);
  await run('There were one hundred records.', { kind: 'line_chart', series: [50, 900], anchorValues: [100] }, false);
  await run('Output grew from two to five units over five years.', { kind: 'line_chart', series: [2, 3, 5], anchorValues: [2, 5], xLabels: ['Year 0', 'Year 5'] }, true);
  await run('The two changes were minus two and five percent.', { kind: 'bar_compare', bars: [{ label: 'Before', value: -2, display: '-2%' }, { label: 'After', value: 5, display: '5%' }], anchorValues: [-2, 5] }, true);
  for (const [citation, sentence, expected] of [
    ['IMF', 'According to the IMF, output rose by two percent.', true],
    ['UN', 'According to the U.N., output rose by two percent.', true],
    ['G7', 'According to the G7, output rose by two percent.', true],
    ['World Bank', 'The world of bankers reported two percent.', false],
    ['IMF, 2023', 'According to the IMF in 2023, output rose by two percent.', true],
    ['IMF, 2023', 'According to the IMF in 2024, output rose by two percent.', false],
  ] as const) await run(sentence, { kind: 'lower_third', value: citation, title: 'Source' }, expected);
  const { OpenRouterGenerationOutcomeUnknownError } = await import('../../../lib/openRouter');
  const { classifyExecutionError } = await import('../../../engine/executionErrors');
  plannerError = new OpenRouterGenerationOutcomeUnknownError('HTTP 503 after paid dispatch', { status: 503 });
  await assert.rejects(() => run('Returns are ten point two percent.', { value: '10.2%', anchorValues: [10.2] }, false), (error) => {
    assert.equal(error, plannerError, 'Actual block must not turn a possibly billed outcome into empty success');
    assert.equal(classifyExecutionError(error).retryable, false);
    return true;
  });
  assert.equal(prompts.length, 1);
  assert.equal(rendered.length, 0);
  assert.equal(stored.length, 0);
  assert.equal(numericCases, 39);
  console.log(`INSERT EXACT NUMERIC PIPELINE PASS — ${numericCases} real-block numeric/citation cases plus ambiguous-paid-outcome preservation; retained spoken-source rows, value/anchor mutations, sign, magnitude aliases, zero policy, namespace and timing`);
}
main().finally(() => { loader._load = original; }).catch((error) => { console.error(error); process.exitCode = 1; });
