/** Challenge the captured production judge with old and new real outputs.
 * Source/identity/instructions are unchanged; labels never reveal the arm.
 * No generation, packaging, uploads, or production database mutations.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { claudeJson } from '../src/lib/anthropic';
import { createModelUsageScope } from '../src/lib/modelUsage';
import { validateTitleJudgeResponse } from '../src/lib/metacraft';

async function main() {
  const [beforePath, afterPath, outputPath] = process.argv.slice(2);
  if (![beforePath, afterPath, outputPath].every((path) => path?.startsWith('/tmp/'))) throw new Error('Provide three /tmp evidence paths');
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const evidence: unknown[] = [];
  const scope = createModelUsageScope();
  try {
    await scope.run(async () => {
      for (const previous of before.results) {
        const current = after.results.find((r: { runId: string }) => r.runId === previous.runId);
        if (!previous.result || !current?.result) throw new Error('Both arms must have finished');
        const titleSet = new Set([previous.result.title, previous.result.titleAlternate, current.result.title, current.result.titleAlternate].filter(Boolean) as string[]);
        const titles = [...titleSet].sort((a, b) => createHash('sha256').update(a).digest('hex').localeCompare(createHash('sha256').update(b).digest('hex')));
        const captured = after.transport.find((row: { request: { messages: { content: string }[] } }) => {
          const content = row.request.messages[0].content;
          return content.startsWith('You are a YouTube CTR strategist') && content.includes(JSON.stringify(current.result.title));
        }) ?? after.transport.find((row: { request: { messages: { content: string }[] } }) => {
          const content = row.request.messages[0].content;
          return content.startsWith('You are a YouTube CTR strategist') && content.includes(current.result.title);
        });
        if (!captured) throw new Error('Captured judge request missing');
        const originalPrompt = captured.request.messages[0].content as string;
        const prompt = originalPrompt.replace(/CANDIDATES:\n[\s\S]*?(?=\n\n)/, `CANDIDATES:\n${titles.map((t, idx) => `${idx}. [candidate] ${t}`).join('\n')}`);
        const response = await claudeJson({ prompt, maxTokens: captured.request.max_tokens, temperature: captured.request.temperature });
        const admission = validateTitleJudgeResponse(response, titles.length);
        evidence.push({ channel: previous.channel, titles, prompt, response, admission });
        console.log(JSON.stringify({ channel: previous.channel, pass: admission.pass, rankings: admission.rankings?.map((r) => ({ title: titles[r.idx], grounding: r.grounding, click: r.clickScore, reason: r.reason })) }));
        const usage = scope.snapshot();
        if (usage.unpricedCalls || usage.costUsd > 0.20) throw new Error('Challenge cost evidence stop');
      }
    });
  } finally {
    writeFileSync(outputPath, JSON.stringify({ purpose: 'Blind-arm challenge of production judge; same-model critic, not an independent audience oracle', evidence, usage: scope.snapshot() }, null, 2), { flag: 'wx' });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
