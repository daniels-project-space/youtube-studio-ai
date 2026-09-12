/** Real production renderer, fed by the actual-block test's accepted arguments. */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderDataInsert } from '../src/lib/remotionRender';

async function main() {
  const [inputPath, directory] = process.argv.slice(2);
  if (!/^\/tmp\/insert-binding-[\w-]+\.json$/.test(inputPath ?? '') || !/^\/tmp\/insert-binding-[\w-]+$/.test(directory ?? '')) throw new Error('Expected dedicated /tmp/insert-binding-* input and new directory');
  const inputBytes = await readFile(inputPath);
  const inputs = JSON.parse(inputBytes.toString()) as Parameters<typeof renderDataInsert>[0][];
  if (inputs.length < 1 || inputs.length > 3 || inputs.some((props) => !props.sourceAttribution || props.width !== 1920 || props.height !== 1080)) throw new Error('Expected one to three attributed actual-block inputs at production dimensions');
  await mkdir(directory, { recursive: false });
  await writeFile(join(directory, 'accepted-module-inputs.json'), inputBytes);
  const receipts: unknown[] = [];
  for (const props of inputs) {
    const outPath = join(directory, `${props.kind}.webm`);
    await renderDataInsert({ ...props, outPath });
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', outPath], { encoding: 'utf8' }));
    const duration = Number(probe.format.duration);
    if (Math.abs(duration - props.durationSec) > 0.1) throw new Error('Duration differs from module output');
    const lastFrame = Math.round(props.durationSec * 30) - 1;
    const frames = [0, 15, 30, 48, 69, Math.round(lastFrame / 2), lastFrame - 30, lastFrame - 10, lastFrame];
    const sheet = join(directory, `${props.kind}-frames.png`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x33424d:s=1920x1080:r=30:d=${duration}`,
      '-c:v', 'libvpx', '-i', outPath, '-filter_complex', `[0:v][1:v]overlay=shortest=1,select='${frames.map((n) => `eq(n,${n})`).join('+')}',scale=640:360,tile=3x3`, '-frames:v', '1', sheet]);
    receipts.push({ kind: props.kind, outPath, sheet, probe, bytes: (await stat(outPath)).size,
      sha256: createHash('sha256').update(await readFile(outPath)).digest('hex'), sampleSeconds: frames.map((n) => n / 30),
      source: 'Actual visual_inserts block arguments; synthetic reviewed source evidence. Planner provenance is recorded separately in the review report.',
      background: '#33424d diagnostic alpha composite', visualVerdict: 'pending independent frame inspection' });
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify(receipts.at(-1)));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
