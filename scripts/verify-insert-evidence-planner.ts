/** One paid planner call through the real block, with no render/storage writes. */
import Module from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createModelUsageScope } from '../src/lib/modelUsage';

async function main() {
  const [inputPath, directory] = process.argv.slice(2);
  if (!/^\/tmp\/insert-binding-[\w-]+\.json\.context\.json$/.test(inputPath ?? '') || !/^\/tmp\/insert-binding-[\w-]+$/.test(directory ?? '')) throw new Error('Dedicated /tmp/insert-binding-* context and new directory required');
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Scoped vault OpenRouter key required');
  const context = JSON.parse(readFileSync(inputPath, 'utf8'));
  mkdirSync(directory, { recursive: false });
  const transport: unknown[] = [], renderInputs: unknown[] = [], logs: string[] = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  const scope = createModelUsageScope();
  const save = () => {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ purpose: 'Real planner and block on synthetic reviewed evidence; not source truth or channel qualification', calls, transport, renderInputs, logs, usage: scope.snapshot() }, null, 2));
    writeFileSync(join(directory, 'render-inputs.json'), JSON.stringify(renderInputs, null, 2));
  };
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://openrouter.ai/api/v1/chat/completions' || calls >= 1) throw new Error('Pilot permits one OpenRouter request only; no retries or other network');
    const request = JSON.parse(String(init?.body));
    if (request.max_tokens > 2500 || String(init?.body).length > 20000) throw new Error('Pilot request exceeds inspected input/output envelope');
    calls++;
    const started = Date.now();
    try {
      const response = await originalFetch(input, init);
      transport.push({ request, status: response.status, response: JSON.parse(await response.clone().text()), elapsedMs: Date.now() - started });
      save();
      return response;
    } catch (error) { transport.push({ request, error: String(error), elapsedMs: Date.now() - started }); save(); throw error; }
  };
  loader._load = function(request, ...rest) {
    const actual = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
    if (request.endsWith('/remotionRender')) return { ...actual, renderDataInsert: async (args: Record<string, unknown>) => { renderInputs.push(args); return args.outPath; } };
    if (request.endsWith('/files')) return { ...actual, makeRunTempDir: async () => directory, readBytes: async () => Buffer.from('no rendered media in planner-only pilot') };
    if (request.endsWith('/storage')) return { ...actual, putObject: async () => undefined };
    return actual;
  };
  try {
    const { visualInserts } = await import('../src/trigger/blocks/insertBlocks');
    await scope.run(() => visualInserts.run({ ...context, log: (message: string) => logs.push(message) }));
    save();
    console.log(JSON.stringify({ calls, admitted: renderInputs.length, costUsd: scope.snapshot().costUsd, logs, directory }));
    if (!renderInputs.length) process.exitCode = 1;
  } finally { loader._load = originalLoad; globalThis.fetch = originalFetch; save(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
