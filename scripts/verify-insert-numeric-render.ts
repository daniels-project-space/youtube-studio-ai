/** Local real-render proof; no planner, storage, paid provider or publishing calls. */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderDataInsert } from '../src/lib/remotionRender';

async function main() {
  const [directory, ...selected] = process.argv.slice(2);
  if (!directory?.startsWith('/tmp/') || directory.includes('..')) throw new Error('A new /tmp/ proof directory is required');
  await mkdir(directory, { recursive: false });
  const cases: { id: string; props: Parameters<typeof renderDataInsert>[0] }[] = [
    { id: 'exact-precision', props: { kind: 'big_stat', value: '10.2345%', label: 'Exact admitted value', outPath: '' , durationSec: 7 } },
    { id: 'magnitude-spacing', props: { kind: 'big_stat', value: '$1.2 million', label: 'Magnitude stays attached', outPath: '', durationSec: 7 } },
    { id: 'signed-comparison', props: { kind: 'bar_compare', title: 'Change from baseline', bars: [{ label: 'Before', value: -2, display: '-2%' }, { label: 'After', value: 5, display: '5%' }], outPath: '', durationSec: 7 } },
  ];
  if (selected.some((id) => !cases.some((entry) => entry.id === id))) throw new Error('Unknown proof case');
  const receipts: unknown[] = [];
  for (const { id, props } of cases.filter((entry) => !selected.length || selected.includes(entry.id))) {
    const outPath = join(directory, `${id}.webm`);
    await renderDataInsert({ ...props, outPath, width: 1920, height: 1080,
      palette: ['#13252d', '#58c9b0', '#eef5f4'], presentation: 'clean_editorial' });
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', outPath], { encoding: 'utf8' }));
    const durationSec = Number(probe.format.duration);
    if (!Number.isFinite(durationSec) || Math.abs(durationSec - 7) > 0.1 || !probe.streams.some((s: { width: number; height: number }) => s.width === 1920 && s.height === 1080)) throw new Error('Rendered dimensions/duration mismatch');
    const sheet = join(directory, `${id}-frames.png`);
    const receipt = { id, outPath, sheet, bytes: (await stat(outPath)).size, probe,
      sampleSeconds: [0, 0.5, 1, 1.6, 2.3, 4, 6, 200 / 30, 209 / 30],
      previewBackground: '#33424d (diagnostic only; not channel footage)',
      source: 'Declared renderer regression inputs, not a newly generated channel video', visualVerdict: 'pending independent frame inspection' };
    receipts.push(receipt);
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(receipts, null, 2));
    // Native decoding can discard WebM alpha and make a correctly fading
    // overlay look opaque. Decode alpha explicitly and inspect a composite.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x33424d:s=1920x1080:r=30:d=7',
      '-c:v', 'libvpx', '-i', outPath, '-filter_complex',
      "[0:v][1:v]overlay=shortest=1,select='eq(n,0)+eq(n,15)+eq(n,30)+eq(n,48)+eq(n,69)+eq(n,120)+eq(n,180)+eq(n,200)+eq(n,209)',scale=640:360,tile=3x3",
      '-frames:v', '1', sheet]);
    console.log(JSON.stringify(receipt));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
