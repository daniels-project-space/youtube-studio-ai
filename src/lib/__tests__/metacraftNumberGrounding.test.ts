import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintTitle, titleOpeningSignal } from '../metacraft';

// The same assertions exercise both production callers, not just a new helper.
function matches(claim: string, source: string): boolean {
  const title = `The Record Shows ${claim} Clearly`;
  const lint = !lintTitle(title, { grounding: source }).issues.some((issue) => issue.startsWith('ungrounded number'));
  assert.equal(titleOpeningSignal(title, source).numbersMatch, lint, `Opening/source mismatch: ${claim} / ${source}`);
  return lint;
}
const cases: [string, string, boolean][] = [
  ['10.2', 'one hundred two', false], ['10.2', 'ten point two', true],
  ['1', '1.5', false], ['1', 'one hundred', false], ['2', 'two million', false],
  ['2', '2 million', false], ['2000000', 'two million', true], ['2 million', 'two', false],
  ['2 million', '2,000,000', true], ['2500', 'two thousand five hundred', true],
  ['100', 'a hundred', true], ['1001', 'one thousand and one', true],
  ['102', 'one hundred and two', true], ['1', 'one thousand and one', false],
  ['37', 'thirty-seven', true], ['30', 'thirty-seven', false],
  ['476', 'four seventy-six', true], ['1917', 'nineteen-seventeen', true],
  ['2005', 'twenty oh five', true], ['2023', 'two thousand twenty-three', true],
  ['10.20', 'ten point two', true], ['10.02', 'ten point zero two', true],
  ['10.2', 'ten point zero two', false], ['0.2', 'point two', true],
  ['-10.2', 'minus ten point two', true], ['10.2', 'minus ten point two', false],
  ['-1', 'one', false], ['1', '-1', false], ['1.0000000000000001', '1', false],
  ['1,234.5', '1234.50', true], ['12345', '1,234.5', false],
  ['10,2', '10,2', true], ['10,2', '102', false], ['102', '10,2', false],
  ['1.2 million', 'one million two hundred thousand', true],
  ['2500000', '2 million 500 thousand', true], ['2 million', '2 million 500 thousand', false],
  ['500', 'four hundred thousand', false], ['400000', 'four hundred thousand', true],
  ['1', 'someone', false], ['10', 'intense', false], ['1', 'WW1', false],
  ['47', 'Forty-seven records', true], ['47', '47. The record follows.', true],
  ['50', 'his 50th birthday', true], ['20', 'a twenty-year period', true],
  ['1', '1/2', false], ['1', '1:30', false], ['1/2', '1/2', true], ['1/2', '1 and 2', false],
  ['.2', 'zero point two', true], ['0.2', '.20', true], ['2', '.20', false],
  ['$-10.2', 'minus ten point two dollars', true], ['10.2', '$-10.2', false],
  ['-$10.2', 'ten point two dollars', false], ['10.2', '-$10.2', false],
  ['2 million', '2million', true], ['2000', '2k', true],
  ['1', 'one constructor', true], ['2', 'two toString', true],
];
const failures: string[] = [];
for (const [claim, source, expected] of cases) {
  if (matches(claim, source) !== expected) failures.push(`${claim} / ${source}: expected ${expected}`);
}
// Independent runtime formatter: preserve grouping, sign and exact decimal
// value while rejecting an extra nonzero decimal digit (no rounding tolerance).
const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 16 });
const formattedValues = [-1234567.125, -10.2, -0.02, 0, 0.02, 1, 10.2, 100.03, 1234.5, 1234567.125];
for (const value of formattedValues) {
  const formatted = formatter.format(value), literal = String(value);
  if (!matches(formatted, literal)) failures.push(`Formatter false rejection: ${formatted} / ${literal}`);
  const corrupt = `${literal}${literal.includes('.') ? '' : '.'}00001`;
  if (matches(formatted, corrupt)) failures.push(`Formatter rounding credit: ${formatted} / ${corrupt}`);
}

// Exact retained narration spans, manually annotated for numeric presence.
// This is NOT endorsement of the historical finance claims' factual accuracy.
const manifest = JSON.parse(readFileSync('test-fixtures/title-baseline/manifest.json', 'utf8'));
const realCases: [string, string, string[], string[]][] = [
  ['Inked Histories', 'When the trench walls collapsed', ['1917'], ['19', '17', '1918']],
  ['Inked Histories', 'Yet in the suffocating embrace', ['100', '1'], ['101', '1000']],
  ['Gratitude Springs', 'If you have carried the friction', ['100'], ['1', '1000']],
  ['The Quiet Stoic', 'When Epictetus taught', ['2000'], ['2', '200']],
  ['Investory', 'You might feel you need', ['10000', '50000', '100000'], ['10', '50', '100']],
  ['Investory', 'According to a 2023 survey', ['2023', '70'], ['202', '7', '700']],
  ['Investory', 'It’s why, according to', ['2023', '100', '30'], ['10', '3', '300']],
  ['Investory', 'According to a 2023 analysis by Charles Schwab, the average', ['2023', '500', '50', '10.2'], ['10', '102', '10.02', '5']],
  ['Investory', 'One waits, saving', ['1', '10000'], ['10', '1000']],
  ['Investory', 'Both invest two hundred', ['200'], ['2', '20']],
  ['Investory', 'The first starts at age', ['25'], ['20', '5']],
  ['Investory', 'Both earn a consistent', ['7'], ['70']],
  ['Investory', 'According to financial models', ['65', '400000'], ['60', '4', '400']],
  ['Investory', 'They have less than two hundred', ['200000'], ['2', '200']],
  ['Investory', 'A weekly transfer of', ['25'], ['20', '5']],
  ['Investory', 'According to a 2017 study', ['2017', '99', '50'], ['201', '9', '5']],
];
let realPositive = 0, realNegative = 0;
for (const [channelName, prefix, good, bad] of realCases) {
  const row = manifest.cases.find((row: { channelName: string; narration: unknown[] }) => row.channelName === channelName && row.narration.length);
  assert.ok(row, channelName);
  const source = JSON.parse(readFileSync(row.file, 'utf8')).source;
  const narration: string = source.stages.find((stage: { outputs: { narrationText?: string } }) => stage.outputs.narrationText)?.outputs.narrationText;
  const sentence = narration.split(/(?<=[.!?])\s+/).find((sentence) => sentence.startsWith(prefix));
  assert.ok(sentence, `Missing exact source span: ${channelName} / ${prefix}`);
  for (const claim of good) {
    realPositive++;
    if (!matches(claim, sentence)) failures.push(`${channelName} false rejection: ${claim} / ${sentence}`);
  }
  for (const claim of bad) {
    realNegative++;
    if (matches(claim, sentence)) failures.push(`${channelName} false admission: ${claim} / ${sentence}`);
  }
}
assert.deepEqual(failures, [], `Numeric grounding failures (${failures.length}):\n${failures.join('\n')}`);
console.log(`METACRAFT NUMBERS PASS — ${cases.length} edge cases, ${formattedValues.length * 2} formatter pairs; ${realPositive} legitimate and ${realNegative} corrupted claims on 16 exact retained narration spans`);
