/** Real finishing function over contrasting local backgrounds; no provider calls. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyOverlaysAndCaptions } from '../src/lib/ffmpeg';

async function main() {
  const root = await mkdtemp('/tmp/insert-binding-composite-');
  const artifact = 'test-fixtures/insert-evidence-binding/media/irregular-axis.webm';
  const sha = createHash('sha256').update(await readFile(artifact)).digest('hex');
  if (sha !== '352f078e5f1fe52f74ad3a47fc09e6ae169d4e5bb8514e907d0e50bb82d89355') throw new Error('Reviewed native insert bytes changed');
  const base = join(root, 'background.mp4');
  const out = join(root, 'composite.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xf0ece2:s=1920x1080:r=30:d=32',
    '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=0x132538:t=fill:enable='gte(t,16)'",
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', base]);
  const overlays = [1, 17].map(startSec => ({ path: artifact, startSec, durSec: 13, width: 1920, height: 1080 }));
  await applyOverlaysAndCaptions(base, overlays, null, out, { blurSigma: 20 });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'format=duration:stream=codec_name,width,height,nb_read_frames', '-of', 'json', out], { encoding: 'utf8' }));
  const video = probe.streams.find((s: { codec_name: string }) => s.codec_name === 'h264');
  if (Number(video?.nb_read_frames) !== 960 || video.width !== 1920 || video.height !== 1080 || Number(probe.format.duration) !== 32) throw new Error('Finishing changed geometry or frame count');
  const pixels = (path: string, frame: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `select=eq(n\\,${frame})`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 8_000_000 });
  const comparisons = [0, 120, 450, 480, 600, 930].map(frame => {
    const before = pixels(base, frame), after = pixels(out, frame);
    let differingBytes = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differingBytes++;
    const shouldContainInsert = frame === 120 || frame === 600;
    if (shouldContainInsert ? differingBytes < 10000 : differingBytes !== 0) throw new Error(`Overlay visibility/time-window mismatch at frame ${frame}: ${differingBytes}`);
    return { frame, differingBytes, shouldContainInsert };
  });
  const frames = [0, 45, 120, 390, 450, 480, 525, 600, 870, 930];
  const sheet = join(root, 'composite-frames.png');
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select='${frames.map(n => `eq(n,${n})`).join('+')}',scale=480:270,tile=5x2`, '-frames:v', '1', sheet]);
  const evidence = { scope: 'Actual production finishing function, reviewed native insert and synthetic contrasting backgrounds. Not a whole-channel, narration or R2 recovery qualification.',
    artifact, inputSha256: sha, out, sheet, probe, comparisons, sampleSeconds: frames.map(n => n / 30),
    sha256: createHash('sha256').update(await readFile(out)).digest('hex'), visualVerdict: 'pending independent frame inspection' };
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(evidence));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
